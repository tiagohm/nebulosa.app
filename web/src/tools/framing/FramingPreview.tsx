import type { FramingField } from 'api'
import { type KeyboardEvent, type PointerEvent, useEffect, useRef, useState } from 'react'
import { type FramePoint, frameOutline, isFraming } from '../../framing/geometry'
import { frameColor } from '../../framing/palette'
import { isSetupFraming, type ResolvedFraming } from '../../framing/resolve'
import { aborted, ApiResponseError } from '../../http'
import { skyMapPalette } from '../../sky/palette'
import { createRequestGuard } from '../../sky/selection'
import { Button } from '../../ui/Button'
import type { PreviewFit, PreviewSource } from './framing'
import {
	canvasAngle,
	canvasPoint,
	cutoutCovers,
	cutoutCrop,
	type CutoutCrop,
	cutoutOrigin,
	cutoutSuffices,
	cutoutView,
	type CutoutView,
	fetchCutout,
	fetchField,
	type LabelBox,
	placeLabel,
	positionAngleAt,
	previewLayout,
	type PreviewLayout,
	projectPosition,
	rotationHandle,
	skyPosition,
	snapRotation,
	starRadius,
} from './preview'

// Preview of the Framing tool, the canvas the framings are planned on: one north-up gnomonic view around a J2000 center,
// east on the left, with the outline of every framing that has a field in its own colour and a mark at the middle of its
// top edge, the one shown in the panel drawn bolder with its rotation handle. Dragging the handle turns that framing, the
// arrow keys turn it while the canvas has the focus, and a click (or tap) elsewhere centers the view there. The view is
// scaled to fit every framing or only the one shown. The Mini-Sky (the stars and deep-sky objects of the server's
// catalog, drawn offline) is always read and drawn; the Survey background draws a hips2fits cutout over it, cropped to
// the view, once one that covers it has downloaded, so a slow or failed download never leaves the view blank and never
// locks anything: it shows its progress with Cancel, and a failure says why with Try Again and Show Mini-Sky. Both are
// asked for every rotation of the fitted framings at once (see ./preview), so turning a framing reads nothing, and a
// cutout that still serves the view, such as after a small resize, is kept.

// Delay between the last change of the view and the request of its background, in milliseconds, so a resize or a typed
// center asks once.
const REQUEST_DELAY_MS = 300

// Deep-sky objects named on the Mini-Sky, the brightest ones that find room.
const NAMED_DEEP_SKY = 24

// Size of the canvas text, in CSS pixels.
const LABEL_SIZE = 11

// Distance in CSS pixels within which a press grabs the rotation handle, by a mouse or a pen and by touch.
const HANDLE_REACH = { fine: 12, touch: 24 } as const

// Movement in CSS pixels under which a press and release is a click that centers the view.
const CLICK_SLOP = 5

// Steps of a rotation by the keyboard and by dragging, in degrees: the arrow keys, with Shift, and the handle.
const ROTATION_STEP = { key: 0.5, coarse: 5, drag: 0.5 } as const

// Props of the preview.
export interface FramingPreviewProps {
	// Framings in list order, the Equipment Setup's first, each with its colour.
	readonly framings: readonly ResolvedFraming[]
	// Id of the framing shown in the panel, drawn bolder with its rotation handle.
	readonly selectedId: string
	// J2000 center of the view.
	readonly center: FramePoint
	// Background.
	readonly source: PreviewSource
	// Survey id of the Survey background.
	readonly survey: string
	// What the scale fits.
	readonly fit: PreviewFit
	// Centers the view on a J2000 position (radians), from a click.
	readonly onCenter: (center: FramePoint) => void
	// Sets the rotation, in degrees in [0, 360), of the framing shown; absent when it has none to set.
	readonly onRotate?: (rotation: number) => void
	// Switches the background to the Mini-Sky, cancelling a download or after a failed one.
	readonly onShowMiniSky: () => void
}

// Survey image of a view.
interface Cutout {
	// What it was asked for and the part of the sky it holds.
	readonly view: CutoutView
	// Decoded image.
	readonly image: HTMLImageElement
}

// Survey image drawn over a view: the image and the rectangle of it the canvas shows.
interface Backdrop {
	// Decoded image.
	readonly image: HTMLImageElement
	// Part of the image drawn over the whole canvas, in image pixels.
	readonly crop: CutoutCrop
}

// Catalog objects of a view.
interface Field {
	// Key of the view they were read for.
	readonly key: string
	// Objects of the cone.
	readonly field: FramingField
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

// Returns what to say of a failed cutout: the likely cause of a service that did not answer, else the server's reason.
function cutoutFailure(error: unknown) {
	if (error instanceof ApiResponseError && error.status === 502) return 'hips2fits did not answer, most likely because there is no internet here. The Mini-Sky stays drawn underneath.'
	return error instanceof Error ? error.message : String(error)
}

// Returns the angular size and rotation (radians) of a framing that has a field.
function frameOf(framing: ResolvedFraming) {
	return isFraming(framing.field) ? { width: framing.field.width, height: framing.field.height, rotation: (framing.optics.rotation * Math.PI) / 180 } : undefined
}

// Preview canvas of the framings.
export function FramingPreview({ framings, selectedId, center, source, survey, fit, onCenter, onRotate, onShowMiniSky }: FramingPreviewProps) {
	const host = useRef<HTMLDivElement>(null)
	const canvas = useRef<HTMLCanvasElement>(null)
	const [size, setSize] = useState<{ readonly width: number; readonly height: number }>()
	const [field, setField] = useState<Field>()
	const [fieldFailed, setFieldFailed] = useState(false)
	const [cutout, setCutout] = useState<Cutout>()
	const [downloading, setDownloading] = useState(false)
	const [cutoutError, setCutoutError] = useState<string>()
	const [attempt, setAttempt] = useState(0)
	// Press in progress on the canvas: dragging the handle, or a possible click from where it started.
	const press = useRef<{ readonly kind: 'rotate' } | { readonly kind: 'click'; readonly x: number; readonly y: number; moved: boolean }>(undefined)
	const drawn = framings.filter((framing) => isFraming(framing.field))
	const selected = drawn.find((framing) => framing.id === selectedId)
	const selectedFrame = selected && frameOf(selected)
	const fitted = fit === 'selected' && selectedFrame ? [selectedFrame] : drawn.flatMap((framing) => frameOf(framing) ?? [])
	const layout = size && previewLayout(size.width, size.height, fitted)
	// The view the catalog field is asked for: its center, the scale that covers every rotation, and its size, rounded so
	// a small change asks nothing.
	const viewKey = layout && `${center.rightAscension.toFixed(7)}:${center.declination.toFixed(7)}:${layout.coverScale.toPrecision(5)}:${Math.round(layout.width)}x${Math.round(layout.height)}`
	// The cutout the view asks for, the same for every rotation, and the key of its request.
	const wanted = layout && cutoutView(survey, center, layout, window.devicePixelRatio || 1)
	const wantedKey = wanted && `${wanted.origin}:${wanted.request.fov.toPrecision(5)}:${wanted.request.width}x${wanted.request.height}`
	const rotatable = onRotate !== undefined && selectedFrame !== undefined && !isSetupFraming(selectedId)
	const backdrop: Backdrop | undefined = source === 'survey' && layout && cutout && cutoutCovers(cutout.view, cutoutOrigin(survey, center), layout) ? { image: cutout.image, crop: cutoutCrop(cutout.view, layout) } : undefined
	const readingField = !backdrop && !fieldFailed && field?.key !== viewKey

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

	// Reads the catalog objects of the view, drawn on their own or under a cutout until it arrives.
	const fieldGuard = useRef(createRequestGuard())
	useEffect(() => {
		if (!layout || !viewKey) return
		const timer = setTimeout(() => {
			const request = fieldGuard.current.begin()
			void (async () => {
				try {
					const next = await fetchField({ rightAscension: center.rightAscension, declination: center.declination, radius: layout.radius }, request.signal)
					if (request.current()) {
						setField({ key: viewKey, field: next })
						setFieldFailed(false)
					}
				} catch (error) {
					if (request.current() && !aborted(error)) setFieldFailed(true)
				}
			})()
		}, REQUEST_DELAY_MS)
		return () => clearTimeout(timer)
	}, [viewKey])

	// Downloads the survey cutout of the view unless the one read still serves it, again after Try Again.
	const cutoutGuard = useRef(createRequestGuard())
	useEffect(() => {
		if (source !== 'survey' || !wanted || (cutout && cutoutSuffices(cutout.view, wanted))) {
			cutoutGuard.current.cancel()
			setDownloading(false)
			setCutoutError(undefined)
			return
		}
		setCutoutError(undefined)
		const timer = setTimeout(() => {
			const request = cutoutGuard.current.begin()
			setDownloading(true)
			void (async () => {
				try {
					const next = await decodeImage(await fetchCutout(wanted.request, request.signal))
					if (request.current()) setCutout({ view: wanted, image: next })
				} catch (error) {
					if (request.current() && !aborted(error)) setCutoutError(cutoutFailure(error))
				} finally {
					if (request.current()) setDownloading(false)
				}
			})()
		}, REQUEST_DELAY_MS)
		return () => clearTimeout(timer)
	}, [source, wantedKey, attempt])

	useEffect(
		() => () => {
			fieldGuard.current.cancel()
			cutoutGuard.current.cancel()
		},
		[],
	)

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
		draw(context, layout, center, backdrop ? undefined : field?.field, backdrop, drawn, selectedId, rotatable)
	})

	// Returns the canvas point of a pointer event.
	function pointOf(event: PointerEvent<HTMLCanvasElement>) {
		const box = event.currentTarget.getBoundingClientRect()
		return { x: event.clientX - box.left, y: event.clientY - box.top }
	}

	// Whether a canvas point is within reach of the rotation handle of the framing shown.
	function onHandle(x: number, y: number, pointerType: string) {
		if (!layout || !rotatable || !selectedFrame) return false
		const handle = rotationHandle(layout, selectedFrame.height, selectedFrame.rotation)
		return Math.hypot(x - handle.x, y - handle.y) <= (pointerType === 'touch' ? HANDLE_REACH.touch : HANDLE_REACH.fine)
	}

	function handlePointerDown(event: PointerEvent<HTMLCanvasElement>) {
		if (!layout || event.button !== 0) return

		const { x, y } = pointOf(event)

		try {
			event.currentTarget.setPointerCapture(event.pointerId)
		} catch {
			// A pointer the browser no longer tracks is followed without capture.
		}

		if (onHandle(x, y, event.pointerType)) {
			press.current = { kind: 'rotate' }
			event.currentTarget.style.cursor = 'grabbing'
		} else {
			press.current = { kind: 'click', x, y, moved: false }
		}
	}

	function handlePointerMove(event: PointerEvent<HTMLCanvasElement>) {
		if (!layout) return

		const { x, y } = pointOf(event)
		const current = press.current

		if (current?.kind === 'rotate') {
			onRotate?.(snapRotation(positionAngleAt(layout, x, y), ROTATION_STEP.drag))
		} else if (current?.kind === 'click') {
			if (Math.hypot(x - current.x, y - current.y) > CLICK_SLOP) current.moved = true
		} else {
			event.currentTarget.style.cursor = onHandle(x, y, event.pointerType) ? 'grab' : 'crosshair'
		}
	}

	function handlePointerUp(event: PointerEvent<HTMLCanvasElement>) {
		if (!layout) return
		const current = press.current
		press.current = undefined
		const { x, y } = pointOf(event)
		event.currentTarget.style.cursor = onHandle(x, y, event.pointerType) ? 'grab' : 'crosshair'
		if (current?.kind === 'rotate') onRotate?.(snapRotation(positionAngleAt(layout, x, y), ROTATION_STEP.drag))
		else if (current?.kind === 'click' && !current.moved) onCenter(skyPosition(layout, center, x, y))
	}

	// Turns the framing shown with the arrow keys: left counterclockwise (east of north), right clockwise.
	function handleKeyDown(event: KeyboardEvent<HTMLCanvasElement>) {
		if (!rotatable || !selected || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return
		event.preventDefault()
		const step = event.shiftKey ? ROTATION_STEP.coarse : ROTATION_STEP.key
		onRotate?.(snapRotation(selected.optics.rotation + (event.key === 'ArrowLeft' ? step : -step), ROTATION_STEP.key))
	}

	const title = rotatable ? `Click the sky to center it there. Drag the ring above the top edge of ${selected?.name}, or press ← and → (with Shift for ${ROTATION_STEP.coarse}°), to turn it.` : 'Click the sky to center it there.'

	return (
		<div ref={host} className="relative h-full min-h-64 w-full overflow-hidden rounded-sm border border-line-100 bg-base-000">
			<canvas
				ref={canvas}
				tabIndex={0}
				title={title}
				onPointerDown={handlePointerDown}
				onPointerMove={handlePointerMove}
				onPointerUp={handlePointerUp}
				onPointerCancel={() => (press.current = undefined)}
				onKeyDown={handleKeyDown}
				className="absolute inset-0 size-full cursor-crosshair touch-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
			/>
			<div className="pointer-events-none absolute inset-x-0 top-0 flex flex-col items-start gap-2 p-2">
				{source === 'survey' && downloading && (
					<div className="pointer-events-auto flex flex-wrap items-center gap-3 rounded-sm border border-line-100 bg-base-100/90 py-1.5 pr-1.5 pl-3">
						<span className="text-sm leading-5 text-ink-200">Downloading the survey image from hips2fits…</span>
						<Button variant="secondary" onClick={onShowMiniSky}>
							Cancel
						</Button>
					</div>
				)}
				{source === 'survey' && cutoutError && (
					<div className="pointer-events-auto flex max-w-full flex-wrap items-center gap-3 rounded-sm border border-line-100 bg-base-100/90 py-1.5 pr-1.5 pl-3">
						<p className="m-0 min-w-0 flex-1 basis-64 text-sm leading-5 text-danger">{cutoutError}</p>
						<div className="flex flex-wrap gap-2">
							<Button variant="secondary" onClick={() => setAttempt((count) => count + 1)}>
								Try Again
							</Button>
							<Button variant="secondary" onClick={onShowMiniSky}>
								Show Mini-Sky
							</Button>
						</div>
					</div>
				)}
				{readingField && <span className="rounded-sm bg-base-100/80 px-2 py-1 text-xs leading-4 text-ink-300">Reading the sky catalog…</span>}
				{fieldFailed && !backdrop && <span className="rounded-sm bg-base-100/80 px-2 py-1 text-xs leading-4 text-danger">The sky catalog could not be read for this view.</span>}
			</div>
		</div>
	)
}

// Draws the background, the framings, and the orientation of a view.
function draw(context: CanvasRenderingContext2D, layout: PreviewLayout, center: FramePoint, field: FramingField | undefined, backdrop: Backdrop | undefined, framings: readonly ResolvedFraming[], selectedId: string, rotatable: boolean) {
	const palette = skyMapPalette()
	const { width, height } = layout
	const labels: LabelBox[] = []
	context.clearRect(0, 0, width, height)
	context.font = `${LABEL_SIZE}px ${palette.font}`
	context.textBaseline = 'top'

	if (backdrop) context.drawImage(backdrop.image, backdrop.crop.x, backdrop.crop.y, backdrop.crop.width, backdrop.crop.height, 0, 0, width, height)

	// The framing shown last, so it is drawn over the others; its name is placed first, so it always finds room.
	const ordered = [...framings.filter((framing) => framing.id !== selectedId), ...framings.filter((framing) => framing.id === selectedId)].flatMap((framing) => {
		if (!isFraming(framing.field)) return []
		const rotation = (framing.optics.rotation * Math.PI) / 180
		const outline = frameOutline(framing.field.width, framing.field.height, rotation, 1).map((point) => canvasPoint(layout, point))
		return [{ framing, field: framing.field, rotation, outline, label: { x: outline[0].x + 4, y: outline[0].y + 4, width: context.measureText(framing.name).width, height: LABEL_SIZE + 2 } }]
	})
	const named = new Set(ordered.toReversed().flatMap((each) => (placeLabel(labels, each.label, width, height) || each.framing.id === selectedId ? [each.framing.id] : [])))

	// The catalog under the outlines, its names where the framings left room.
	if (!backdrop && field) drawField(context, layout, center, field, labels)

	for (const { framing, field: frame, rotation, outline, label } of ordered) {
		const selected = framing.id === selectedId
		const color = frameColor(framing.color)
		context.strokeStyle = color
		context.fillStyle = color
		context.lineWidth = selected ? 2.25 : 1.25
		context.beginPath()
		for (const [i, { x, y }] of outline.entries()) {
			if (i === 0) context.moveTo(x, y)
			else context.lineTo(x, y)
		}
		context.closePath()
		context.stroke()
		drawTopMark(context, outline[0], outline[1], selected ? 7 : 5)
		if (selected && rotatable) drawHandle(context, rotationHandle(layout, frame.height, rotation), color)
		if (named.has(framing.id)) context.fillText(framing.name, label.x, label.y)
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

// Draws the mark of the top edge of a sensor: a triangle of a size (CSS pixels) at the middle of the edge from a to b,
// pointing out of the outline, in the current fill colour.
function drawTopMark(context: CanvasRenderingContext2D, a: { readonly x: number; readonly y: number }, b: { readonly x: number; readonly y: number }, size: number) {
	const length = Math.hypot(b.x - a.x, b.y - a.y)
	if (length < size * 3) return
	const ux = (b.x - a.x) / length
	const uy = (b.y - a.y) / length
	// Outward normal of the top edge: the outline runs clockwise on the canvas from the top-left corner.
	const nx = uy
	const ny = -ux
	const mx = (a.x + b.x) / 2
	const my = (a.y + b.y) / 2
	context.beginPath()
	context.moveTo(mx - ux * size, my - uy * size)
	context.lineTo(mx + ux * size, my + uy * size)
	context.lineTo(mx + nx * size, my + ny * size)
	context.closePath()
	context.fill()
}

// Draws the rotation handle of the framing shown: a ring in its colour, joined to its top edge.
function drawHandle(context: CanvasRenderingContext2D, handle: { readonly x: number; readonly y: number }, color: string) {
	context.strokeStyle = color
	context.lineWidth = 1.5
	context.beginPath()
	context.arc(handle.x, handle.y, 5.5, 0, 2 * Math.PI)
	context.stroke()
}

// Draws the catalog objects of a view: the stars as discs whose size follows their magnitude, then the deep-sky objects
// as ellipses of their axes, the brightest named where their name finds room among the labels already placed.
function drawField(context: CanvasRenderingContext2D, layout: PreviewLayout, center: FramePoint, field: FramingField, labels: LabelBox[]) {
	const palette = skyMapPalette()
	context.fillStyle = palette.ink100

	for (const star of field.stars) {
		const point = projectPosition(layout, center, star)
		if (!point || point.x < -8 || point.y < -8 || point.x > layout.width + 8 || point.y > layout.height + 8) continue
		context.beginPath()
		context.arc(point.x, point.y, starRadius(star.magnitude ?? field.magnitudeLimit, field.magnitudeLimit), 0, 2 * Math.PI)
		context.fill()
	}

	context.strokeStyle = palette.deepSky
	context.fillStyle = palette.deepSky
	context.lineWidth = 1
	// Names drawn, so an object listed twice by the catalog, such as under two designations, is named once.
	const names = new Set<string>()

	for (const object of field.deepSky) {
		const point = projectPosition(layout, center, object)
		if (!point) continue
		const major = Math.max(3, ((object.majorAxis ?? 0) * layout.scale) / 2)
		const minor = Math.max(3, ((object.minorAxis ?? object.majorAxis ?? 0) * layout.scale) / 2)
		context.beginPath()
		context.ellipse(point.x, point.y, major, minor, canvasAngle(object.orientation ?? 0), 0, 2 * Math.PI)
		context.stroke()
		if (names.size >= NAMED_DEEP_SKY || names.has(object.name)) continue
		const label = { x: point.x + major + 2, y: point.y - 5, width: context.measureText(object.name).width, height: LABEL_SIZE + 2 }
		if (!placeLabel(labels, label, layout.width, layout.height)) continue
		context.fillText(object.name, label.x, label.y)
		names.add(object.name)
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
