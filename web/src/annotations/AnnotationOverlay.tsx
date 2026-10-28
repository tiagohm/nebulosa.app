import type { AnnotationLayer, AnnotationObject } from 'api'
import type { ImageAnnotationState } from '../images/images'
import type { OverlayView } from '../viewer/transform'
import { type AnnotationProjection, type LabelCandidate, layoutLabels, type ProjectedAnnotation } from './geometry'

// Annotation of an image over the shared image viewer: the constellation figures and names, the outline or marker of
// each deep-sky object, a marker for each star and solar-system body with the predicted motion of a body during the
// exposure, and the labels the layout places, with the selected object highlighted. It is a pure function of a
// projection computed once per result and of the document's annotation state, and draws in image pixel coordinates, so
// the viewer's zoom and pan move it while strokes, markers, and labels keep their size on screen; only the objects in
// view are drawn, and only the labels are laid out again when the view changes. The caller shows it only over the image
// the result annotated, with the WCS it was computed with.

// Size of the labels, in screen pixels.
const LABEL_SIZE = 11

// Size of the constellation names, in screen pixels.
const CONSTELLATION_LABEL_SIZE = 13

// Radius of a star or body marker, in screen pixels.
const MARKER_RADIUS = 5

// Smallest outline drawn, in screen pixels along the major axis; a smaller object gets a marker.
const MIN_OUTLINE = 10

// Largest distance from an outlined object a label keeps, in screen pixels.
const MAX_CLEARANCE = 24

// Labels placed at most for each density.
export const LABEL_BUDGETS = { minimal: 15, balanced: 40, detailed: 150 } as const

// Color of each group.
const COLORS: Readonly<Record<AnnotationLayer, string>> = { star: 'var(--color-ink-200)', deepSky: 'var(--color-accent)', solarSystem: 'var(--color-success)' }

// Order in which the labels of each group are placed.
const LAYER_PRIORITY: Readonly<Record<AnnotationLayer, number>> = { solarSystem: 0, deepSky: 1, star: 2 }

// Magnitude a label of an object without one is placed with, after the fainter ones of its group.
const UNKNOWN_MAGNITUDE = 99

export interface AnnotationOverlayProps {
	// Projection of the result drawn.
	readonly projection: AnnotationProjection
	// Zoom and visible region of the viewer.
	readonly view: OverlayView
	// Annotation state of the document: groups, appearance, and magnitude limit.
	readonly state: ImageAnnotationState
	// Id of the selected object, if any.
	readonly selected?: string
}

// Returns whether an object is drawn and listed for an annotation state: its group is shown and it is no fainter than
// the magnitude limit.
export function isAnnotationShown(state: Pick<ImageAnnotationState, 'layers' | 'magnitudeLimit'>, object: Pick<AnnotationObject, 'layer' | 'magnitude'>): boolean {
	const layer = object.layer === 'star' ? state.layers.stars : object.layer === 'deepSky' ? state.layers.deepSky : state.layers.solarSystem
	return layer && (object.magnitude === undefined || object.magnitude <= state.magnitudeLimit)
}

// Returns the objects of a projection drawn for an annotation state.
export function shownAnnotations(projection: AnnotationProjection, state: ImageAnnotationState): ProjectedAnnotation[] {
	return projection.objects.filter(({ object }) => isAnnotationShown(state, object))
}

// Annotation of a result.
export function AnnotationOverlay({ projection, view, state, selected }: AnnotationOverlayProps) {
	const unit = 1 / view.scale
	const { visible } = view
	const shown = shownAnnotations(projection, state).filter(({ anchor, extent }) => {
		const margin = extent / 2 + MAX_CLEARANCE * unit
		return anchor.x + margin >= visible.x && anchor.x - margin <= visible.x + visible.width && anchor.y + margin >= visible.y && anchor.y - margin <= visible.y + visible.height
	})
	const outlined = (projected: ProjectedAnnotation) => state.outlines && projected.outline !== undefined && projected.extent * view.scale >= MIN_OUTLINE
	const candidates: LabelCandidate[] = shown.map((projected) => ({
		key: projected.object.id,
		anchor: projected.anchor,
		text: projected.object.name,
		priority: LAYER_PRIORITY[projected.object.layer] * 1000 + (projected.object.magnitude ?? UNKNOWN_MAGNITUDE),
		clearance: outlined(projected) ? Math.min(MAX_CLEARANCE, (projected.extent * view.scale) / 2) : MARKER_RADIUS,
	}))
	const labels = state.labels ? layoutLabels(candidates, view, LABEL_SIZE, LABEL_BUDGETS[state.density], selected) : []

	return (
		<g fill="none">
			{state.layers.constellations && (
				<g stroke="var(--color-ink-300)" strokeOpacity={0.6} strokeWidth={1}>
					{projection.constellations.map((path, index) => (
						<path key={index} d={path} vectorEffect="non-scaling-stroke" />
					))}
				</g>
			)}
			{state.layers.constellationLabels &&
				projection.labels.map(({ name, point }) => (
					<text key={name} x={point.x} y={point.y} fill="var(--color-ink-300)" fillOpacity={0.8} fontSize={CONSTELLATION_LABEL_SIZE * unit} textAnchor="middle" dominantBaseline="central" letterSpacing={2 * unit}>
						{name.toUpperCase()}
					</text>
				))}
			{shown.map((projected) => {
				const { object, anchor, outline, approximate, motion } = projected
				const isSelected = object.id === selected
				const color = isSelected ? 'var(--color-ink-100)' : COLORS[object.layer]
				const width = isSelected ? 2.5 : 1.5

				return (
					<g key={object.id} stroke={color}>
						{state.motion && motion && <line x1={motion[0].x} y1={motion[0].y} x2={motion[1].x} y2={motion[1].y} strokeWidth={width} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />}
						{outlined(projected) ? (
							<path d={outline} strokeWidth={width} strokeDasharray={approximate ? '6 4' : undefined} vectorEffect="non-scaling-stroke" />
						) : object.layer === 'solarSystem' ? (
							<path d={`M${anchor.x} ${anchor.y - MARKER_RADIUS * unit}L${anchor.x + MARKER_RADIUS * unit} ${anchor.y}L${anchor.x} ${anchor.y + MARKER_RADIUS * unit}L${anchor.x - MARKER_RADIUS * unit} ${anchor.y}Z`} strokeWidth={width} vectorEffect="non-scaling-stroke" />
						) : (
							<circle cx={anchor.x} cy={anchor.y} r={MARKER_RADIUS * unit} strokeWidth={width} vectorEffect="non-scaling-stroke" />
						)}
					</g>
				)
			})}
			{labels.map((label) => (
				<text
					key={label.key}
					x={label.x}
					y={label.y}
					fill={label.key === selected ? 'var(--color-ink-100)' : 'var(--color-ink-200)'}
					stroke="var(--color-base-000)"
					strokeWidth={3}
					strokeOpacity={0.7}
					paintOrder="stroke"
					fontSize={LABEL_SIZE * unit}
					textAnchor={label.textAnchor}
					dominantBaseline={label.baseline}
					vectorEffect="non-scaling-stroke"
				>
					{label.text}
				</text>
			))}
		</g>
	)
}
