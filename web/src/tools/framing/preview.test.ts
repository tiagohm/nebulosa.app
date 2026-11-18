import { expect, test } from 'bun:test'
import { deg } from 'nebulosa/src/math/units/angle'
import { canvasAngle, canvasPoint, cutoutQuery, cutoutSize, MAX_CUTOUT_SIZE, PREVIEW_MARGIN, previewLayout, projectPosition, starRadius } from './preview'

test('the largest turned frame fits with its margin, and the cutout field spans the larger side', () => {
	const frames = [
		{ width: deg(2), height: deg(1), rotation: 0 },
		{ width: deg(1), height: deg(0.5), rotation: deg(90) },
	]
	const layout = previewLayout(800, 400, frames)
	// The 2° × 1° frame limits both axes: half the width over tan(1°), half the height over tan(0.5°), with the margin.
	expect(layout.scale).toBeCloseTo(Math.min(400 / (Math.tan(deg(1)) * PREVIEW_MARGIN), 200 / (Math.tan(deg(0.5)) * PREVIEW_MARGIN)), 9)
	// hips2fits spans the larger side with the tangent-plane extent 2·tan(fov/2).
	expect(2 * Math.tan(layout.fov / 2) * layout.scale).toBeCloseTo(800, 9)
	expect(Math.tan(layout.radius) * layout.scale).toBeCloseTo(Math.hypot(400, 200), 9)

	const turned = previewLayout(400, 400, [{ width: deg(2), height: deg(1), rotation: deg(45) }])
	const half = (Math.tan(deg(1)) + Math.tan(deg(0.5))) * Math.SQRT1_2
	expect(turned.scale).toBeCloseTo(200 / (half * PREVIEW_MARGIN), 9)
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
	expect(cutoutSize(800, 400, 2)).toEqual({ width: MAX_CUTOUT_SIZE, height: MAX_CUTOUT_SIZE / 2 })
	expect(cutoutSize(400, 300, 1)).toEqual({ width: 400, height: 300 })
	expect(new URLSearchParams(cutoutQuery({ survey: 'CDS/P/DSS2/color', rightAscension: 1, declination: -0.5, fov: 0.02, width: 400, height: 300 })).get('survey')).toBe('CDS/P/DSS2/color')
})
