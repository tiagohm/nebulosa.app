import { identify } from 'nebulosa/src/adapters/orbits/sbd'
import type { PlateSolution } from 'nebulosa/src/astrometry/solvers/platesolver'
import { spaceMotion, star } from 'nebulosa/src/astronomy/bodies/star'
import { eraPvstar } from 'nebulosa/src/astronomy/coordinates/erfa/erfa'
import { timeUnix } from 'nebulosa/src/astronomy/time/time'
import { Wcs } from 'nebulosa/src/bindings/astrometry/libwcs'
import { DEG2RAD, PI, PIOVERTWO, RAD2DEG, TAU } from 'nebulosa/src/core/constants'
import type { Writable } from 'nebulosa/src/core/types'
import { histogram } from 'nebulosa/src/imaging/processing/computation'
import { numericKeyword, observationDateKeyword } from 'nebulosa/src/io/formats/fits/util'
import { sphericalDestination } from 'nebulosa/src/math/numerical/geometry'
import { deg, normalizeAngle, parseAngle } from 'nebulosa/src/math/units/angle'
import fovCameras from 'src/data/astrobin.cameras.json'
import fovTelescopes from 'src/data/astrobin.telescopes.json'
import nebulosa from 'src/data/nebulosa.sqlite' with { embed: 'true', type: 'sqlite' }
import { X_IMAGE_INFO_HEADER } from '#/image'
import type { CloseImage, OpenImage } from '#/image'
import type { AnnotateImage, AnnotatedSkyObject, ImageAnnotation } from '#/image.annotation'
import type { ImageCoordinateGridPoint, ImageCoordinateGridAxis, ImageCoordinateGridLine, ImageCoordinateGrid } from '#/image.coordinategrid'
import type { ImageCrosshairPolyline, ProjectImageCrosshair, ImageCrosshairProjection } from '#/image.crosshair'
import type { ImageCoordinateInterpolation } from '#/image.mousecoordinate'
import type { SaveImage } from '#/image.save'
import type { ImageHistogram, StatisticImage } from '#/image.statistics'
import { DEFAULT_HEADERS, INTERNAL_SERVER_ERROR_RESPONSE, response } from './http'
import type { Endpoints } from './http'
import type { ImageProcessor } from './image.processor'
import type { NotificationHandler } from './notification'

const COORDINATE_INTERPOLATION_DELTA = 24
const COORDINATE_GRID_TARGET_LINES = 7
const COORDINATE_GRID_BORDER_SAMPLES = 24
const COORDINATE_GRID_LINE_SAMPLES = 96
const COORDINATE_GRID_LABEL_MARGIN = 48
const CROSSHAIR_CURVE_SAMPLES = 96

interface CoordinateGridBounds {
	readonly rightAscension: readonly [number, number]
	readonly declination: readonly [number, number]
}

function unwrapAngleAround(angle: number, center: number) {
	while (angle - center > PI) angle -= TAU
	while (angle - center < -PI) angle += TAU
	return angle
}

function niceAngularStep(span: number) {
	const raw = Math.abs(span) / Math.max(1, COORDINATE_GRID_TARGET_LINES - 1)
	const rawDeg = raw * RAD2DEG

	if (!(rawDeg > 0) || !Number.isFinite(rawDeg)) return DEG2RAD

	const exponent = Math.floor(Math.log10(rawDeg))
	const scale = 10 ** exponent
	const fraction = rawDeg / scale
	const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10

	return nice * scale * DEG2RAD
}

function coordinateGridValues(min: number, max: number, step: number) {
	const values: number[] = []

	if (!(step > 0) || !Number.isFinite(step)) return values

	const first = Math.ceil(min / step) * step

	for (let value = first; value <= max + step * 0.25; value += step) {
		if (Number.isFinite(value)) values.push(value)
	}

	return values
}

function isFinitePoint(point: readonly [number, number] | undefined): point is readonly [number, number] {
	if (!point) return false
	const [x, y] = point
	return Number.isFinite(x) && Number.isFinite(y)
}

function clampCoordinateGridLabel(point: ImageCoordinateGridPoint, width: number, height: number): ImageCoordinateGridPoint {
	return {
		x: Math.min(Math.max(point.x, COORDINATE_GRID_LABEL_MARGIN), Math.max(width - COORDINATE_GRID_LABEL_MARGIN, COORDINATE_GRID_LABEL_MARGIN)),
		y: Math.min(Math.max(point.y, COORDINATE_GRID_LABEL_MARGIN), Math.max(height - COORDINATE_GRID_LABEL_MARGIN, COORDINATE_GRID_LABEL_MARGIN)),
	}
}

function clipCoordinateGridSegment(a: readonly [number, number], b: readonly [number, number], width: number, height: number): readonly [ImageCoordinateGridPoint, ImageCoordinateGridPoint] | undefined {
	const [x0, y0] = a
	const [x1, y1] = b
	const dx = x1 - x0
	const dy = y1 - y0
	let t0 = 0
	let t1 = 1

	function clip(p: number, q: number) {
		if (p === 0) return q >= 0

		const t = q / p

		if (p < 0) {
			if (t > t1) return false
			if (t > t0) t0 = t
		} else {
			if (t < t0) return false
			if (t < t1) t1 = t
		}

		return true
	}

	if (!clip(-dx, x0) || !clip(dx, width - x0) || !clip(-dy, y0) || !clip(dy, height - y0)) return undefined

	return [
		{ x: x0 + dx * t0, y: y0 + dy * t0 },
		{ x: x0 + dx * t1, y: y0 + dy * t1 },
	]
}

function isSameCoordinateGridPoint(a: ImageCoordinateGridPoint | undefined, b: ImageCoordinateGridPoint) {
	return !!a && Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6
}

function coordinateGridLabels(points: readonly ImageCoordinateGridPoint[], width: number, height: number) {
	const labels: ImageCoordinateGridPoint[] = []

	for (const point of [points[0], points.at(-1)]) {
		if (!point) continue

		const label = clampCoordinateGridLabel(point, width, height)

		if (!isSameCoordinateGridPoint(labels.at(-1), label)) {
			labels.push(label)
		}
	}

	return labels
}

function coordinateGridBounds(wcs: Wcs, solution: PlateSolution): CoordinateGridBounds | undefined {
	const { widthInPixels: width, heightInPixels: height, rightAscension: center } = solution
	let minRA = Number.POSITIVE_INFINITY
	let maxRA = Number.NEGATIVE_INFINITY
	let minDEC = Number.POSITIVE_INFINITY
	let maxDEC = Number.NEGATIVE_INFINITY

	function include(x: number, y: number) {
		const point = wcs.pixToSky(x, y)

		if (!point) return

		const rightAscension = unwrapAngleAround(point[0], center)
		const declination = point[1]

		if (!Number.isFinite(rightAscension) || !Number.isFinite(declination)) return

		minRA = Math.min(minRA, rightAscension)
		maxRA = Math.max(maxRA, rightAscension)
		minDEC = Math.min(minDEC, declination)
		maxDEC = Math.max(maxDEC, declination)
	}

	for (let i = 0; i <= COORDINATE_GRID_BORDER_SAMPLES; i++) {
		const x = (width * i) / COORDINATE_GRID_BORDER_SAMPLES
		const y = (height * i) / COORDINATE_GRID_BORDER_SAMPLES

		include(x, 0)
		include(x, height)
		include(0, y)
		include(width, y)
	}

	if (!Number.isFinite(minRA) || !Number.isFinite(maxRA) || !Number.isFinite(minDEC) || !Number.isFinite(maxDEC)) return undefined

	return { rightAscension: [minRA, maxRA], declination: [minDEC, maxDEC] }
}

function coordinateGridSegments(axis: ImageCoordinateGridAxis, value: number, width: number, height: number, project: (ratio: number) => readonly [number, number] | undefined) {
	const lines: ImageCoordinateGridLine[] = []
	let points: ImageCoordinateGridPoint[] = []
	let previous: readonly [number, number] | undefined

	function flush() {
		if (points.length >= 2) {
			const labels = coordinateGridLabels(points, width, height)
			lines.push({ axis, value: axis === 'rightAscension' ? normalizeAngle(value) : value, points, labels })
		}

		points = []
	}

	for (let i = 0; i <= COORDINATE_GRID_LINE_SAMPLES; i++) {
		const point = project(i / COORDINATE_GRID_LINE_SAMPLES)

		if (!isFinitePoint(point)) {
			flush()
			previous = undefined
			continue
		}

		if (previous) {
			const clipped = clipCoordinateGridSegment(previous, point, width, height)

			if (clipped) {
				const last = points.at(-1)

				if (!isSameCoordinateGridPoint(last, clipped[0])) {
					if (points.length > 0) flush()
					points.push(clipped[0])
				}

				if (!isSameCoordinateGridPoint(points.at(-1), clipped[1])) {
					points.push(clipped[1])
				}
			} else {
				flush()
			}
		}

		previous = point
	}

	flush()

	return lines
}

function niceAngularStepAtMost(value: number) {
	const exponent = Math.floor(Math.log10(value * RAD2DEG))
	const scale = 10 ** exponent
	const fraction = (value * RAD2DEG) / scale
	const nice = fraction >= 5 ? 5 : fraction >= 2 ? 2 : 1
	return nice * scale * DEG2RAD
}

export function effectiveCrosshairAngularSpacing(solution: PlateSolution, automatic: boolean, value: number) {
	const span = Math.min(solution.width, solution.height)
	const minimum = Math.max(solution.scale * 8, span / 128)
	const requested = automatic ? niceAngularStepAtMost(span / 8) : value
	return Math.min(Math.max(Number.isFinite(requested) ? requested : minimum, minimum), span)
}

function crosshairProjectedSegments(project: (ratio: number) => readonly [number, number] | undefined): ImageCrosshairPolyline[] {
	const lines: ImageCoordinateGridPoint[][] = []
	let points: ImageCoordinateGridPoint[] = []

	function flush() {
		if (points.length >= 2) lines.push(points)
		points = []
	}

	for (let i = 0; i <= CROSSHAIR_CURVE_SAMPLES; i++) {
		const point = project(i / CROSSHAIR_CURVE_SAMPLES)

		if (!isFinitePoint(point)) {
			flush()
			continue
		}

		const projected = { x: point[0], y: point[1] }
		if (!isSameCoordinateGridPoint(points.at(-1), projected)) points.push(projected)
	}

	flush()

	return lines
}

function normalizedDirection(center: readonly [number, number], point: readonly [number, number] | undefined) {
	if (!isFinitePoint(point)) return undefined
	const x = point[0] - center[0]
	const y = point[1] - center[1]
	const length = Math.hypot(x, y)
	return length > 0 && Number.isFinite(length) ? { x: x / length, y: y / length } : undefined
}

export class ImageHandler {
	constructor(
		readonly imageProcessor: ImageProcessor,
		readonly notification?: NotificationHandler,
	) {}

	open(req: OpenImage) {
		return this.imageProcessor.export(req.path, req.transformation, req.camera)
	}

	close(req: CloseImage) {
		return this.imageProcessor.close(req.path, req.camera)
	}

	ping(req: CloseImage) {
		return this.imageProcessor.ping(req.path, req.camera)
	}

	async save(req: SaveImage) {
		if (!req.saveAt) return
		await this.imageProcessor.export(req.path, req.transformation, req.camera, req.saveAt)
	}

	async annotate(req: AnnotateImage): Promise<ImageAnnotation> {
		const res: AnnotatedSkyObject[] = []

		if (!req.stars && !req.dsos && !req.minorPlanets) return res

		const { solution } = req
		const { rightAscension, declination, radius, widthInPixels: width, heightInPixels: height } = solution
		const date = observationDateKeyword(solution) || Date.now()
		using wcs = new Wcs(solution)

		if (req.stars || req.dsos) {
			const filterByType = req.stars && req.dsos ? '1=1' : req.stars ? 'd.type = 29' : 'd.type <> 29'
			const utc = timeUnix(date / 1000)
			const q = `SELECT d.id, d.type, d.rightAscension, d.declination, d.magnitude, d.pmRa, d.pmDec, d.distance, d.rv, d.constellation, (SELECT n.type || ':' || n.name FROM names n WHERE n.dsoId = d.id ORDER BY n.type ASC LIMIT 1) as name FROM dsos d WHERE ${filterByType} AND (acos(sin(d.declination) * ${Math.sin(declination)} + cos(d.declination) * ${Math.cos(declination)} * cos(d.rightAscension - ${rightAscension})) <= ${radius}) ORDER BY d.magnitude DESC LIMIT 100`

			for (const o of nebulosa.query<Writable<AnnotatedSkyObject>, []>(q)) {
				const sa = star(o.rightAscension, o.declination, o.pmRA, o.pmDEC, o.distance === 0 ? 0 : 1 / o.distance, o.rv)
				const sb = eraPvstar(...spaceMotion(sa, utc))

				if (sb) {
					const point = wcs.skyToPix(sb[0], sb[1])

					if (!point) continue

					const [x, y] = point

					if (x >= 0 && y >= 0 && x < width && y < height) {
						o.x = x
						o.y = y
						res.push(o)
					}
				}
			}
		}

		if (req.minorPlanets) {
			const longitude = numericKeyword(req.solution, 'SITELON', 0)
			const latitude = numericKeyword(req.solution, 'SITELAT', 0)

			const ident = await identify(date, deg(longitude), deg(latitude), 0, rightAscension, declination, radius, undefined, req.minorPlanetsMagnitudeLimit, req.includeMinorPlanetsWithoutMagnitude)

			if ('n_second_pass' in ident && ident.n_second_pass) {
				let i = 0

				for (const body of ident.data_second_pass) {
					const name = body[0]
					const rightAscension = parseAngle(body[1], true)
					const declination = parseAngle(body[2])
					const magnitude = +body[6]

					if (rightAscension === undefined || declination === undefined) continue

					const point = wcs.skyToPix(rightAscension, declination)

					if (!point) continue

					const [x, y] = point

					if (x >= 0 && y >= 0 && x < width && y < height) {
						res.push({ type: 'asteroid', id: 3000000 + i++, name, x, y, rightAscension, declination, magnitude, pmRA: 0, pmDEC: 0, rv: 0, distance: 0, constellation: 0 })
					}
				}
			} else if ('message' in ident) {
				console.warn('identify error:', ident.message)
			}
		}

		return res
	}

	coordinateInterpolation(solution: PlateSolution): ImageCoordinateInterpolation {
		using wcs = new Wcs(solution)
		const { widthInPixels, heightInPixels } = solution

		const delta = COORDINATE_INTERPOLATION_DELTA
		const width = Math.ceil(widthInPixels / delta)
		const height = Math.ceil(heightInPixels / delta)
		const md = new Array<number>(width * height)
		const ma = new Array<number>(md.length)

		for (let y = 0, i = 0; y < height; y++) {
			for (let x = 0; x < width; x++, i++) {
				const point = wcs.pixToSky(x * delta, y * delta)

				if (!point) throw new Error(`failed to interpolate image coordinate at ${x * delta},${y * delta}`)

				ma[i] = point[0]
				md[i] = point[1]
			}
		}

		return { ma, md, delta, width, height }
	}

	coordinateGrid(solution: PlateSolution): ImageCoordinateGrid {
		using wcs = new Wcs(solution)
		const bounds = coordinateGridBounds(wcs, solution)

		if (!bounds) return { lines: [] }

		const { widthInPixels: width, heightInPixels: height } = solution
		const [minRA, maxRA] = bounds.rightAscension
		const [minDEC, maxDEC] = bounds.declination
		const rightAscensionStep = niceAngularStep(maxRA - minRA)
		const declinationStep = niceAngularStep(maxDEC - minDEC)
		const lines: ImageCoordinateGridLine[] = []

		for (const rightAscension of coordinateGridValues(minRA, maxRA, rightAscensionStep)) {
			lines.push(
				...coordinateGridSegments('rightAscension', rightAscension, width, height, (ratio) => {
					const declination = minDEC - declinationStep + (maxDEC - minDEC + declinationStep * 2) * ratio
					return wcs.skyToPix(normalizeAngle(rightAscension), declination)
				}),
			)
		}

		for (const declination of coordinateGridValues(minDEC, maxDEC, declinationStep)) {
			lines.push(
				...coordinateGridSegments('declination', declination, width, height, (ratio) => {
					const rightAscension = minRA - rightAscensionStep + (maxRA - minRA + rightAscensionStep * 2) * ratio
					return wcs.skyToPix(normalizeAngle(rightAscension), declination)
				}),
			)
		}

		return { lines }
	}

	crosshairProjection(request: ProjectImageCrosshair): ImageCrosshairProjection {
		const { solution, anchor, preset, angularSpacing } = request
		const { widthInPixels: width, heightInPixels: height } = solution
		using wcs = new Wcs(solution)

		const centerInImage = anchor.space === 'image' ? ([anchor.point.x, anchor.point.y] as const) : wcs.skyToPix(anchor.coordinate.rightAscension, anchor.coordinate.declination)
		const centerInSky = anchor.space === 'sky' ? ([normalizeAngle(anchor.coordinate.rightAscension), anchor.coordinate.declination] as const) : wcs.pixToSky(anchor.point.x, anchor.point.y)

		if (centerInImage === undefined || centerInSky === undefined) return { status: 'unprojectable' }

		const [x, y] = centerInImage
		const [rightAscension, declination] = centerInSky
		const span = Math.min(solution.width, solution.height)
		const directionDistance = Math.max(solution.scale * 16, span / 1000)
		const northPoint = wcs.skyToPix(...sphericalDestination(rightAscension, declination, 0, directionDistance))
		const eastPoint = wcs.skyToPix(...sphericalDestination(rightAscension, declination, PIOVERTWO, directionDistance))
		const north = normalizedDirection(centerInImage, northPoint)
		const east = normalizedDirection(centerInImage, eastPoint)

		if (!north || !east) return { status: 'unprojectable' }

		const axes: ImageCrosshairPolyline[] = []
		const rings: ImageCrosshairPolyline[] = []
		const ringIntersections: (ImageCoordinateGridPoint & { radius: number })[] = []
		const cardinals: ImageCoordinateGridPoint[] = []
		const spacing = angularSpacing && effectiveCrosshairAngularSpacing(solution, angularSpacing.automatic, angularSpacing.value)

		if (spacing !== undefined) {
			const ringRadius = spacing * 4
			const axisLegs = [
				{ positionAngle: 0, length: preset === 'bullseye' ? ringRadius : solution.height },
				{ positionAngle: PIOVERTWO, length: preset === 'bullseye' ? ringRadius : solution.width },
				{ positionAngle: PI, length: preset === 'bullseye' ? ringRadius : solution.height },
				{ positionAngle: (PI * 3) / 2, length: preset === 'bullseye' ? ringRadius : solution.width },
			]

			for (const { positionAngle, length } of axisLegs) {
				const axisLength = Math.min(PI * 0.49, length)
				axes.push(...crosshairProjectedSegments((ratio) => wcs.skyToPix(...sphericalDestination(rightAscension, declination, positionAngle, axisLength * ratio))))
			}

			if (preset === 'bullseye') {
				for (const radius of [spacing, spacing * 2, spacing * 4]) {
					rings.push(...crosshairProjectedSegments((ratio) => wcs.skyToPix(...sphericalDestination(rightAscension, declination, ratio * TAU, radius))))
					const intersection = wcs.skyToPix(...sphericalDestination(rightAscension, declination, PI, radius))
					if (isFinitePoint(intersection)) ringIntersections.push({ x: intersection[0], y: intersection[1], radius })
				}

				for (const positionAngle of [0, PIOVERTWO, PI, (PI * 3) / 2]) {
					const point = wcs.skyToPix(...sphericalDestination(rightAscension, declination, positionAngle, spacing * 4))
					if (isFinitePoint(point)) cardinals.push({ x: point[0], y: point[1] })
				}
			}
		}

		return {
			status: 'ready',
			width,
			height,
			center: { x, y, rightAscension: normalizeAngle(rightAscension), declination, inside: x >= 0 && y >= 0 && x <= width && y <= height },
			spacing,
			directions: { north, east },
			axes,
			rings,
			ringIntersections,
			cardinals,
		}
	}

	async statistics(req: StatisticImage) {
		const transformation = { ...req.transformation, enabled: req.transformed }
		const image = await this.imageProcessor.transform(req.path, transformation, req.camera)

		if (image?.image) {
			const stats = new Array<ImageHistogram>(image.image.metadata.channels)
			const isMono = stats.length === 1
			const bits = new Int32Array(1 << Math.max(8, Math.min(req.bits ?? 16, 20)))
			const area = req.area && ('x' in req.area ? { top: req.area.y, left: req.area.x, bottom: req.area.y + req.area.height, right: req.area.x + req.area.width } : req.area)

			for (let i = 0; i < stats.length; i++) {
				const channel = isMono ? 'GRAY' : i === 0 ? 'RED' : i === 1 ? 'GREEN' : 'BLUE'
				const hist = histogram(image.image, { channel, area, bits })
				const { standardDeviation, variance, count, mean, median, maximum, minimum } = hist
				stats[i] = { standardDeviation, variance, count, mean, median, maximum, minimum, data: Array.from(bits) }
			}

			return stats
		} else {
			console.warn('invalid state. expected image, but got', image)
		}

		return []
	}
}

export function image(imageHandler: ImageHandler) {
	return {
		'/image/open': {
			POST: async (req) => {
				const item = await imageHandler.open(await req.json())

				if (item?.info && item.output) {
					return new Response(item.output as Buffer<ArrayBuffer>, {
						headers: {
							...DEFAULT_HEADERS,
							[X_IMAGE_INFO_HEADER]: encodeURIComponent(JSON.stringify(item.info)),
						},
					})
				} else {
					return INTERNAL_SERVER_ERROR_RESPONSE
				}
			},
		},
		'/image/close': { POST: async (req) => response(imageHandler.close(await req.json())) },
		'/image/ping': { POST: async (req) => response(imageHandler.ping(await req.json())) },
		'/image/save': { POST: async (req) => response(await imageHandler.save(await req.json())) },
		'/image/annotate': { POST: async (req) => response(await imageHandler.annotate(await req.json())) },
		'/image/coordinateinterpolation': { POST: async (req) => response(imageHandler.coordinateInterpolation(await req.json())) },
		'/image/coordinategrid': { POST: async (req) => response(imageHandler.coordinateGrid(await req.json())) },
		'/image/crosshairprojection': { POST: async (req) => response<ImageCrosshairProjection>(imageHandler.crosshairProjection(await req.json())) },
		'/image/statistics': { POST: async (req) => response(await imageHandler.statistics(await req.json())) },
		'/image/fovcameras': { GET: response(fovCameras) },
		'/image/fovtelescopes': { GET: response(fovTelescopes) },
	} as const satisfies Endpoints
}
