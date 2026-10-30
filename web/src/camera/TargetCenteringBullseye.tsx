import type { TargetCenteringAttempt } from 'api'
import { toArcsec } from 'nebulosa/src/math/units/angle'
import { BULLSEYE_RINGS, bullseyeRing } from './targetcentering'

// Pointing error of each solved attempt of a session around the target at the center: north up and east to the left, as the
// sky looks, which is not how the frames of the camera may be turned. Offsets are those of the solved center from the target,
// drawn to the scale its rings state, so nothing is magnified without saying so.

// Radius of the outer ring, in drawing units.
const RADIUS = 100

// Margin around the outer ring, for the labels of the axes, in drawing units.
const MARGIN = 16

export interface TargetCenteringBullseyeProps {
	// Attempts of the session.
	readonly attempts: readonly TargetCenteringAttempt[]
	// Accepted distance from the target, in radians.
	readonly tolerance: number
}

// Solved attempts around the target, joined in order, the tolerance dashed.
export function TargetCenteringBullseye({ attempts, tolerance }: TargetCenteringBullseyeProps) {
	const offsets = attempts.flatMap(({ attempt, dx, dy }) => (dx === undefined || dy === undefined ? [] : [{ attempt, east: toArcsec(dx), north: toArcsec(dy) }]))
	const limit = toArcsec(tolerance)
	const ring = bullseyeRing(Math.max(limit, ...offsets.map(({ east, north }) => Math.hypot(east, north))))
	const scale = RADIUS / (ring * BULLSEYE_RINGS)
	const points = offsets.map(({ attempt, east, north }) => ({ attempt, x: -east * scale, y: -north * scale }))

	return (
		<figure className="m-0 flex flex-col items-center gap-1">
			<svg viewBox={`${-RADIUS - MARGIN} ${-RADIUS - MARGIN} ${2 * (RADIUS + MARGIN)} ${2 * (RADIUS + MARGIN)}`} className="w-full max-w-64">
				<g fill="none" stroke="var(--color-line-100)">
					{Array.from({ length: BULLSEYE_RINGS }, (_, index) => (
						<circle key={index} r={((index + 1) * RADIUS) / BULLSEYE_RINGS} vectorEffect="non-scaling-stroke" />
					))}
					<path d={`M${-RADIUS} 0H${RADIUS}M0 ${-RADIUS}V${RADIUS}`} vectorEffect="non-scaling-stroke" />
				</g>
				<circle r={limit * scale} fill="none" stroke="var(--color-accent)" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
				<g fill="var(--color-ink-300)" fontSize={11} textAnchor="middle" dominantBaseline="central">
					<text y={-RADIUS - 8}>N</text>
					<text x={-RADIUS - 8}>E</text>
				</g>
				{points.length > 1 && <polyline points={points.map(({ x, y }) => `${x},${y}`).join(' ')} fill="none" stroke="var(--color-ink-200)" strokeOpacity={0.7} vectorEffect="non-scaling-stroke" />}
				{points.map(({ attempt, x, y }, index) => (
					<circle key={attempt} cx={x} cy={y} r={index === points.length - 1 ? 4 : 2.5} fill={index === points.length - 1 ? 'var(--color-accent)' : 'var(--color-ink-200)'}>
						<title>{`Attempt ${attempt}`}</title>
					</circle>
				))}
			</svg>
			<figcaption className="text-xs text-ink-300 tabular-nums">{`Ring ${ring}″ · tolerance ${limit.toFixed(0)}″ dashed`}</figcaption>
		</figure>
	)
}
