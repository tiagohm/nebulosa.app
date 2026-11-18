import type { FramingField } from 'api'
import { useEffect, useRef, useState } from 'react'
import { type FramePoint, frameOutline, isFraming } from '../../framing/geometry'
import { frameColor } from '../../framing/palette'
import type { ResolvedFraming } from '../../framing/resolve'
import { aborted } from '../../http'
import { skyMapPalette } from '../../sky/palette'
import { createRequestGuard } from '../../sky/selection'
import { Button } from '../../ui/Button'
import type { PreviewSource } from './framing'
import { canvasAngle, canvasPoint, cutoutSize, fetchCutout, fetchField, previewLayout, type PreviewLayout, projectPosition, starRadius } from './preview'

// Preview of the Framing tool: one north-up canvas around a J2000 center, east on the left, with the outline of every
// framing that has a field of view in its own colour, the one shown in the panel drawn bolder, over either the stars and
// deep-sky objects of the catalog (the Mini-Sky, drawn offline from the server's catalog) or a hips2fits cutout of a
// survey. Both backgrounds use the same gnomonic view (preview.ts), so the outlines fit either. A cutout is asked only
// while the Survey background is chosen, a moment after the view settles; while it downloads the tool locks its inputs.

// Delay between the last change of the view and the request of its background, in milliseconds, so a resize or a typed
// center asks once.
const REQUEST_DELAY_MS = 300

// Deep-sky objects named on the Mini-Sky, the brightest ones.
const NAMED_DEEP_SKY = 24

// Framing drawn in the preview, with the place of its colour.
export interface PreviewFraming {
	// Framing resolved for the tab.
	readonly framing: ResolvedFraming
	// Place of the framing in the list, which gives its colour.
	readonly position: number
}

// Props of the preview.
export interface FramingPreviewProps {
	// Framings drawn, with their places.
	readonly framings: readonly PreviewFraming[]
	// Id of the framing shown in the panel, drawn bolder.
	readonly selectedId: string
	// J2000 center of the view.
	readonly center: FramePoint
	// Background.
	readonly source: PreviewSource
	// Survey id of the Survey background.
	readonly survey: string
	// Called when a survey cutout starts or stops downloading.
	readonly onDownloading: (downloading: boolean) => void
	// Switches the background back to the Mini-Sky after a failed cutout.
	readonly onShowMiniSky: () => void
}

// Survey image of a view, as an object URL of its JPEG.
interface Cutout {
	// Key of the view it was asked for.
	readonly key: string
	// Decoded image.
	readonly image: HTMLImageElement
}

// Returns the decoded image of a JPEG blob.
async function decodeImage(blob: Blob) {
	const url = URL.createObjectURL(blob)

	try {
		const image = new Image()
		image.src = url
		await image.decode()
		return image
	} finally {
		URL.revokeObjectURL(url)
	}
}

// Preview canvas of the framings.
export function FramingPreview({ framings, selectedId, center, source, survey, onDownloading, onShowMiniSky }: FramingPreviewProps) {
	const host = useRef<HTMLDivElement>(null)
	const canvas = useRef<HTMLCanvasElement>(null)
	const [size, setSize] = useState<{ readonly width: number; readonly height: number }>()
	const [field, setField] = useState<FramingField>()
	const [cutout, setCutout] = useState<Cutout>()
	const [cutoutError, setCutoutError] = useState<string>()
	const drawn = framings.filter(({ framing }) => isFraming(framing.field))
	const frames = drawn.map(({ framing }) => (isFraming(framing.field) ? { width: framing.field.width, height: framing.field.height, rotation: (framing.optics.rotation * Math.PI) / 180 } : { width: 0, height: 0, rotation: 0 }))
	const layout = size && previewLayout(size.width, size.height, frames)
	// The view a background is asked for: its center, its scale, and its size, rounded so a small change asks nothing.
	const viewKey = layout && `${center.rightAscension.toFixed(7)}:${center.declination.toFixed(7)}:${layout.fov.toPrecision(5)}:${Math.round(layout.width)}x${Math.round(layout.height)}`
	const surveyKey = viewKey && `${survey}:${viewKey}`

	// Follows the size of the host.
	useEffect(() => {
		const element = host.current
		if (!element) return
		const observer = new ResizeObserver(([entry]) => {
			const { width, height } = entry.contentRect
			if (width > 0 && height > 0) setSize({ width, height })
		})
		observer.observe(element)
		return () => observer.disconnect()
	}, [])

	// Reads the catalog objects of the view for the Mini-Sky.
	const fieldGuard = useRef(createRequestGuard())
	useEffect(() => {
		if (source !== 'sky' || !layout || !viewKey) return
		const timer = setTimeout(() => {
			const request = fieldGuard.current.begin()
			void (async () => {
				try {
					const next = await fetchField({ rightAscension: center.rightAscension, declination: center.declination, radius: layout.radius }, request.signal)
					if (request.current()) setField(next)
				} catch {
					if (request.current()) setField(undefined)
				}
			})()
		}, REQUEST_DELAY_MS)
		return () => clearTimeout(timer)
	}, [source, viewKey])

	// Downloads the survey cutout of the view.
	const cutoutGuard = useRef(createRequestGuard())
	useEffect(() => {
		if (source !== 'survey' || !layout || !surveyKey) return
		if (cutout?.key === surveyKey) return
		setCutoutError(undefined)
		const timer = setTimeout(() => {
			const request = cutoutGuard.current.begin()
			const pixels = cutoutSize(layout.width, layout.height, window.devicePixelRatio || 1)
			onDownloading(true)
			void (async () => {
				try {
					const image = await decodeImage(await fetchCutout({ survey, rightAscension: center.rightAscension, declination: center.declination, fov: layout.fov, ...pixels }, request.signal))
					if (request.current()) setCutout({ key: surveyKey, image })
				} catch (error) {
					if (request.current() && !aborted(error)) setCutoutError(error instanceof Error ? error.message : String(error))
				} finally {
					if (request.current()) onDownloading(false)
				}
			})()
		}, REQUEST_DELAY_MS)
		return () => clearTimeout(timer)
	}, [source, surveyKey])

	// Stops a download when the background changes or the preview goes away.
	useEffect(() => {
		if (source === 'survey') return
		cutoutGuard.current.cancel()
		onDownloading(false)
	}, [source, onDownloading])
	useEffect(() => () => cutoutGuard.current.cancel(), [])

	// Draws the view.
	useEffect(() => {
		const element = canvas.current
		if (!element || !layout) return
		const ratio = window.devicePixelRatio || 1
		element.width = Math.round(layout.width * ratio)
		element.height = Math.round(layout.height * ratio)
		const context = element.getContext('2d')
		if (!context) return
		context.setTransform(ratio, 0, 0, ratio, 0, 0)
		const image = source === 'survey' && cutout && cutout.key === surveyKey ? cutout.image : undefined
		draw(context, layout, center, source === 'sky' ? field : undefined, image, drawn, selectedId)
	})

	return (
		<div ref={host} className="relative h-full min-h-64 w-full overflow-hidden rounded-sm border border-line-100 bg-base-000">
			<canvas ref={canvas} className="absolute inset-0 size-full" />
			{source === 'survey' && cutoutError && (
				<div className="absolute inset-x-0 bottom-0 flex flex-wrap items-center gap-3 border-t border-line-100 bg-base-100/90 p-3">
					<p className="m-0 min-w-0 flex-1 text-sm leading-5 text-danger">{cutoutError}</p>
					<Button variant="secondary" onClick={onShowMiniSky}>
						Show Mini-Sky
					</Button>
				</div>
			)}
		</div>
	)
}

// Draws the background, the framings, and the orientation of a view.
function draw(context: CanvasRenderingContext2D, layout: PreviewLayout, center: FramePoint, field: FramingField | undefined, image: HTMLImageElement | undefined, framings: readonly PreviewFraming[], selectedId: string) {
	const palette = skyMapPalette()
	const { width, height } = layout
	context.clearRect(0, 0, width, height)
	context.font = `11px ${palette.font}`
	context.textBaseline = 'top'

	if (image) context.drawImage(image, 0, 0, width, height)
	else if (field) drawField(context, layout, center, field)

	for (const { framing, position } of framings) {
		if (!isFraming(framing.field)) continue
		const selected = framing.id === selectedId
		const outline = frameOutline(framing.field.width, framing.field.height, (framing.optics.rotation * Math.PI) / 180, 1).map((point) => canvasPoint(layout, point))
		context.strokeStyle = frameColor(position)
		context.lineWidth = selected ? 2.5 : 1.25
		context.beginPath()
		for (const [i, { x, y }] of outline.entries()) {
			if (i === 0) context.moveTo(x, y)
			else context.lineTo(x, y)
		}
		context.closePath()
		context.stroke()
		// The top edge, from the first corner, marks which way the sensor is up.
		context.lineWidth = selected ? 4 : 2.5
		context.beginPath()
		context.moveTo(outline[0].x, outline[0].y)
		context.lineTo(outline[1].x, outline[1].y)
		context.stroke()
		context.fillStyle = frameColor(position)
		context.fillText(framing.name, outline[0].x + 4, outline[0].y + 4)
	}

	// Center and orientation.
	context.strokeStyle = palette.ink200
	context.lineWidth = 1
	context.beginPath()
	context.moveTo(width / 2 - 6, height / 2)
	context.lineTo(width / 2 + 6, height / 2)
	context.moveTo(width / 2, height / 2 - 6)
	context.lineTo(width / 2, height / 2 + 6)
	context.stroke()
	drawCompass(context, palette.ink100, 32, height - 24)
}

// Draws the catalog objects of a view: the deep-sky objects as ellipses of their axes, the brightest named, and the stars
// as discs whose size follows their magnitude.
function drawField(context: CanvasRenderingContext2D, layout: PreviewLayout, center: FramePoint, field: FramingField) {
	const palette = skyMapPalette()
	context.strokeStyle = palette.deepSky
	context.fillStyle = palette.deepSky
	context.lineWidth = 1

	for (const [index, object] of field.deepSky.entries()) {
		const point = projectPosition(layout, center, object)
		if (!point) continue
		const major = Math.max(3, ((object.majorAxis ?? 0) * layout.scale) / 2)
		const minor = Math.max(3, ((object.minorAxis ?? object.majorAxis ?? 0) * layout.scale) / 2)
		context.beginPath()
		context.ellipse(point.x, point.y, major, minor, canvasAngle(object.orientation ?? 0), 0, 2 * Math.PI)
		context.stroke()
		if (index < NAMED_DEEP_SKY) context.fillText(object.name, point.x + major + 2, point.y - 5)
	}

	context.fillStyle = palette.ink100

	for (const star of field.stars) {
		const point = projectPosition(layout, center, star)
		if (!point || point.x < -8 || point.y < -8 || point.x > layout.width + 8 || point.y > layout.height + 8) continue
		context.beginPath()
		context.arc(point.x, point.y, starRadius(star.magnitude ?? field.magnitudeLimit, field.magnitudeLimit), 0, 2 * Math.PI)
		context.fill()
	}
}

// Draws the north and east arrows of a north-up view at a point: north up, east to the left.
function drawCompass(context: CanvasRenderingContext2D, color: string, x: number, y: number) {
	const length = 16
	context.strokeStyle = color
	context.fillStyle = color
	context.lineWidth = 1.25
	context.beginPath()
	context.moveTo(x, y)
	context.lineTo(x, y - length)
	context.moveTo(x, y)
	context.lineTo(x - length, y)
	context.stroke()
	context.textBaseline = 'middle'
	context.fillText('N', x - 3, y - length - 7)
	context.fillText('E', x - length - 10, y)
	context.textBaseline = 'top'
}
