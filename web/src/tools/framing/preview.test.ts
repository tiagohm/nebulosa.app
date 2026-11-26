import { expect, test } from 'bun:test'
import { deg } from 'nebulosa/src/math/units/angle'
import { canvasAngle, canvasPoint, CUTOUT_DETAIL_SLACK, cutoutCovers, cutoutCrop, cutoutQuery, cutoutSuffices, cutoutView, HANDLE_OFFSET, type LabelBox, MAX_CUTOUT_SIZE, placeLabel, positionAngleAt, PREVIEW_MARGIN, previewLayout, projectPosition, rotationHandle, skyPosition, snapRotation, starRadius } from './preview'

const SURVEY = 'CDS/P/DSS2/color'
const CENTER = { rightAscension: deg(83.8), declination: deg(-5.4) }

test('the largest turned frame fits with its margin, within the scales of every rotation', () => {
	const frames = [
		{ width: deg(2), height: deg(1), rotation: 0 },
		{ width: deg(1), height: deg(0.5), rotation: deg(90) },
	]
	const layout = previewLayout(800, 400, frames)
	// The 2° × 1° frame limits both axes: half the width over tan(1°), half the height over tan(0.5°), with the margin.
	expect(layout.scale).toBeCloseTo(Math.min(400 / (Math.tan(deg(1)) * PREVIEW_MARGIN), 200 / (Math.tan(deg(0.5)) * PREVIEW_MARGIN)), 9)
	// Every rotation is covered by the half diagonal on the shorter side, and needs at most the detail of the smaller half side.
	expect(layout.coverScale).toBeCloseTo(200 / (Math.hypot(Math.tan(deg(1)), Math.tan(deg(0.5))) * PREVIEW_MARGIN), 9)
	expect(layout.detailScale).toBeCloseTo(200 / (Math.tan(deg(0.5)) * PREVIEW_MARGIN), 9)
	expect(Math.tan(layout.radius) * layout.coverScale).toBeCloseTo(Math.hypot(400, 200), 9)

	const turned = previewLayout(400, 400, [{ width: deg(2), height: deg(1), rotation: deg(45) }])
	const half = (Math.tan(deg(1)) + Math.tan(deg(0.5))) * Math.SQRT1_2
	expect(turned.scale).toBeCloseTo(200 / (half * PREVIEW_MARGIN), 9)

	for (let rotation = 0; rotation < 180; rotation += 7.5) {
		const each = previewLayout(800, 400, [{ ...frames[0], rotation: deg(rotation) }])
		expect(each.coverScale).toBe(layout.coverScale)
		expect(each.detailScale).toBe(layout.detailScale)
		expect(each.scale).toBeGreaterThanOrEqual(each.coverScale)
		expect(each.scale).toBeLessThanOrEqual(each.detailScale)
	}

	const empty = previewLayout(400, 300, [])
	expect(empty.coverScale).toBe(empty.scale)
	expect(empty.detailScale).toBe(empty.scale)
})

test('one cutout serves every rotation of a frame, cropped to its view', () => {
	const frame = { width: deg(1.5), height: deg(1), rotation: 0 }
	const wanted = cutoutView(SURVEY, CENTER, previewLayout(800, 450, [frame]), 1)
	// hips2fits spans the larger side with the tangent-plane extent 2·tan(fov/2).
	expect(Math.tan(wanted.request.fov / 2)).toBeCloseTo(wanted.halfXi, 12)
	expect(wanted.request.width / wanted.request.height).toBeCloseTo(800 / 450, 2)
	expect(Math.max(wanted.request.width, wanted.request.height)).toBeLessThanOrEqual(MAX_CUTOUT_SIZE)

	for (let rotation = 0; rotation < 360; rotation += 5) {
		const layout = previewLayout(800, 450, [{ ...frame, rotation: deg(rotation) }])
		expect(cutoutView(SURVEY, CENTER, layout, 1)).toEqual(wanted)
		expect(cutoutCovers(wanted, wanted.origin, layout)).toBeTrue()
		const crop = cutoutCrop(wanted, layout)
		expect(crop.x).toBeGreaterThanOrEqual(-1e-6)
		expect(crop.y).toBeGreaterThanOrEqual(-1e-6)
		expect(crop.x + crop.width).toBeLessThanOrEqual(wanted.request.width + 1e-6)
		expect(crop.y + crop.height).toBeLessThanOrEqual(wanted.request.height + 1e-6)
		// The crop keeps the scale of the view: image pixels over canvas pixels is the cutout's over the view's scale.
		expect(crop.width / 800).toBeCloseTo(wanted.pixelScale / layout.scale, 12)
	}
})

test('a cutout read before serves a view of the same origin until it lacks its extent or detail', () => {
	const frame = { width: deg(1.5), height: deg(1), rotation: deg(30) }
	const read = cutoutView(SURVEY, CENTER, previewLayout(400, 225, [frame]), 1)
	expect(Math.max(read.request.width, read.request.height) / CUTOUT_DETAIL_SLACK).toBeLessThan(MAX_CUTOUT_SIZE)
	expect(cutoutSuffices(read, read)).toBeTrue()
	// A canvas grown by 10 %: the same sky at a little more detail.
	expect(cutoutSuffices(read, cutoutView(SURVEY, CENTER, previewLayout(440, 247.5, [frame]), 1))).toBeTrue()
	// A canvas grown beyond the slack, a sharper screen, another survey, center, or a larger frame asks again.
	expect(cutoutSuffices(read, cutoutView(SURVEY, CENTER, previewLayout(400 / CUTOUT_DETAIL_SLACK + 20, 225 / CUTOUT_DETAIL_SLACK + 11.25, [frame]), 1))).toBeFalse()
	expect(cutoutSuffices(read, cutoutView(SURVEY, CENTER, previewLayout(400, 225, [frame]), 2))).toBeFalse()
	expect(cutoutSuffices(read, cutoutView('CDS/P/2MASS/color', CENTER, previewLayout(400, 225, [frame]), 1))).toBeFalse()
	expect(cutoutSuffices(read, cutoutView(SURVEY, { ...CENTER, declination: deg(-5) }, previewLayout(400, 225, [frame]), 1))).toBeFalse()
	expect(cutoutSuffices(read, cutoutView(SURVEY, CENTER, previewLayout(400, 225, [{ ...frame, width: deg(3) }]), 1))).toBeFalse()
	// A canvas made wider shows sky the cutout does not hold.
	expect(cutoutCovers(read, read.origin, previewLayout(600, 225, [frame]))).toBeFalse()
})

test('the view is north up with east on the left', () => {
	const layout = previewLayout(400, 400, [{ width: deg(2), height: deg(2), rotation: 0 }])
	const center = { rightAscension: deg(83.8), declination: deg(-5.4) }
	expect(projectPosition(layout, center, center)).toEqual({ x: 200, y: 200 })
	const east = projectPosition(layout, center, { rightAscension: center.rightAscension + deg(0.5), declination: center.declination })!
	expect(east.x).toBeLessThan(200)
	const north = projectPosition(layout, center, { rightAscension: center.rightAscension, declination: center.declination + deg(0.5) })!
	expect(north.y).toBeLessThan(200)
	expect(north.x).toBeCloseTo(200, 9)
	expect(canvasPoint(layout, { xi: 0, eta: 0 })).toEqual({ x: 200, y: 200 })
})

test('a position angle turns from north (up) through east (left) on the canvas', () => {
	expect(Math.cos(canvasAngle(0))).toBeCloseTo(0, 12)
	expect(Math.sin(canvasAngle(0))).toBeCloseTo(-1, 12)
	expect(Math.cos(canvasAngle(deg(90)))).toBeCloseTo(-1, 12)
	expect(Math.sin(canvasAngle(deg(90)))).toBeCloseTo(0, 12)
})

test('stars, cutout sizes, and the cutout query', () => {
	expect(starRadius(10, 10)).toBeCloseTo(0.6, 12)
	expect(starRadius(-5, 10)).toBe(6)
	const large = cutoutView(SURVEY, CENTER, previewLayout(1600, 800, [{ width: deg(2), height: deg(1), rotation: 0 }]), 2)
	expect(large.request.width).toBe(MAX_CUTOUT_SIZE)
	expect(large.request.height).toBe(MAX_CUTOUT_SIZE / 2)
	const tall = cutoutView(SURVEY, CENTER, previewLayout(300, 400, []), 1)
	expect(tall.request).toMatchObject({ width: 300, height: 400 })
	expect(new URLSearchParams(cutoutQuery({ survey: SURVEY, rightAscension: 1, declination: -0.5, fov: 0.02, width: 400, height: 300 })).get('survey')).toBe(SURVEY)
})

test('a canvas point goes back to the sky position it shows', () => {
	const layout = previewLayout(600, 400, [{ width: deg(2), height: deg(1.5), rotation: deg(20) }])
	const center = { rightAscension: deg(83.8), declination: deg(-5.4) }
	const position = { rightAscension: deg(84.2), declination: deg(-5.1) }
	const point = projectPosition(layout, center, position)
	expect(point).toBeDefined()
	const back = skyPosition(layout, center, point?.x ?? 0, point?.y ?? 0)
	expect(back.rightAscension).toBeCloseTo(position.rightAscension, 12)
	expect(back.declination).toBeCloseTo(position.declination, 12)
	const middle = skyPosition(layout, center, 300, 200)
	expect(middle.rightAscension).toBeCloseTo(center.rightAscension, 12)
	expect(middle.declination).toBeCloseTo(center.declination, 12)
})

test('the position angle of a canvas point runs from north through east, and the handle sits along it', () => {
	const layout = { width: 400, height: 300, scale: 1000 }
	expect(positionAngleAt(layout, 200, 50)).toBeCloseTo(0, 12)
	expect(positionAngleAt(layout, 50, 150)).toBeCloseTo(90, 12)
	expect(positionAngleAt(layout, 200, 290)).toBeCloseTo(180, 12)
	expect(positionAngleAt(layout, 350, 150)).toBeCloseTo(270, 12)
	expect(positionAngleAt(layout, 200, 150)).toBe(0)

	const height = deg(4)
	const handle = rotationHandle(layout, height, deg(90))
	expect(handle.x).toBeCloseTo(200 - (Math.tan(height / 2) * 1000 + HANDLE_OFFSET), 9)
	expect(handle.y).toBeCloseTo(150, 9)
	expect(positionAngleAt(layout, handle.x, handle.y)).toBeCloseTo(90, 9)
})

test('rotations snap to their step within a turn', () => {
	expect(snapRotation(12.26, 0.5)).toBe(12.5)
	expect(snapRotation(359.8, 0.5)).toBe(0)
	expect(snapRotation(-0.6, 0.5)).toBe(359.5)
})

test('a label is placed only where it overlaps none and stays on the canvas', () => {
	const placed: LabelBox[] = []
	expect(placeLabel(placed, { x: 10, y: 10, width: 50, height: 12 }, 200, 100)).toBeTrue()
	expect(placeLabel(placed, { x: 40, y: 15, width: 50, height: 12 }, 200, 100)).toBeFalse()
	expect(placeLabel(placed, { x: 60, y: 10, width: 50, height: 12 }, 200, 100)).toBeTrue()
	expect(placeLabel(placed, { x: 180, y: 50, width: 50, height: 12 }, 200, 100)).toBeFalse()
	expect(placed).toHaveLength(2)
})
