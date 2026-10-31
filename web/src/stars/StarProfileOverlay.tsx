import type { ImageStarProfileState } from '../images/images'
import type { OverlayView } from '../viewer/transform'
import { measuredStar, profileEllipse } from './starprofile'
import type { StarProfileSettings } from './starprofile.settings'

// Marker of the Star Profile Inspector over the shared image viewer: the point asked about until a star answers, then
// the cross at its centroid, its half-flux circle, and the ellipse of its FWHM axes. It is a pure function of the state
// and draws in image pixel coordinates, so the viewer's zoom and pan move it; the caller shows it only over the image
// the state measured.

// Half the length of the arms of the cross, in screen pixels.
const CROSS_SIZE = 8

// Radius of the marker of the point asked about, in screen pixels.
const POINT_RADIUS = 6

interface StarProfileOverlayProps {
	// Measurement drawn.
	readonly state: ImageStarProfileState
	// Zoom of the viewer.
	readonly view: Pick<OverlayView, 'scale'>
	// What is drawn.
	readonly settings: Pick<StarProfileSettings, 'ellipse' | 'halfFlux'>
}

// Marker of a measurement.
export function StarProfileOverlay({ state, view, settings }: StarProfileOverlayProps) {
	const measured = measuredStar(state)

	if (!measured) {
		const { x, y } = state.request
		return <circle cx={x + 0.5} cy={y + 0.5} r={POINT_RADIUS / view.scale} fill="none" stroke="var(--color-ink-300)" strokeWidth={1} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
	}

	const { profile } = measured
	const cx = profile.x + 0.5
	const cy = profile.y + 0.5
	const arm = CROSS_SIZE / view.scale
	const ellipse = settings.ellipse ? profileEllipse(profile) : undefined
	const stroke = profile.valid ? 'var(--color-success)' : 'var(--color-danger)'

	return (
		<g fill="none" stroke={stroke} strokeWidth={1}>
			<line x1={cx - arm} x2={cx + arm} y1={cy} y2={cy} vectorEffect="non-scaling-stroke" />
			<line x1={cx} x2={cx} y1={cy - arm} y2={cy + arm} vectorEffect="non-scaling-stroke" />
			{settings.halfFlux && profile.hfd !== undefined && <circle cx={cx} cy={cy} r={profile.hfd / 2} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />}
			{ellipse && <ellipse cx={cx} cy={cy} rx={ellipse.rx} ry={ellipse.ry} transform={`rotate(${ellipse.rotation} ${cx} ${cy})`} vectorEffect="non-scaling-stroke" />}
		</g>
	)
}
