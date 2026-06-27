import type { DetectedStar } from 'nebulosa/src/imaging/stars/detector'
import { type CSSProperties, memo, useContext } from 'react'
import { useSnapshot } from 'valtio'
import { ImageViewerStoreContext } from '../shared/context'

const STAR_RADIUS = 4
const SELECTED_STAR_RADIUS = 6
const STAR_STROKE = 'var(--warning)'
const SELECTED_STAR_STROKE = 'var(--success)'
const STAR_LABEL_FILL = 'var(--secondary)'
const TEXT_STYLE = { textAnchor: 'middle', alignmentBaseline: 'text-before-edge', transform: 'rotate(0deg)' } satisfies CSSProperties

function starKey(star: DetectedStar) {
	return `${star.x}:${star.y}:${star.hfd}`
}

function isSameStar(a: DetectedStar | undefined, b: DetectedStar) {
	return a !== undefined && a.x === b.x && a.y === b.y && a.hfd === b.hfd
}

export const DetectedStars = memo(() => {
	const viewer = useContext(ImageViewerStoreContext)
	const { starDetection } = viewer
	const { selected, stars } = useSnapshot(starDetection.state)

	if (stars.length === 0) return null

	function handleClick(event: React.UIEvent<SVGGElement>) {
		const index = Number(event.currentTarget.dataset.index)
		const star = Number.isInteger(index) ? stars[index] : undefined

		if (star) {
			starDetection.select(star)
		}
	}

	return (
		<svg className="detected-stars pointer-events-none absolute top-0 left-0 h-full w-full select-none" fill="none">
			{stars.map((star, index) => {
				const isSelected = isSameStar(selected, star)

				return (
					<g className="pointer-events-auto cursor-pointer" data-index={index} key={starKey(star)} onClick={handleClick}>
						<circle cx={star.x} cy={star.y} r={isSelected ? SELECTED_STAR_RADIUS : STAR_RADIUS} stroke={isSelected ? SELECTED_STAR_STROKE : STAR_STROKE} strokeWidth={isSelected ? 2 : 1} />
						<text className="text-xs font-bold" fill={STAR_LABEL_FILL} style={TEXT_STYLE} x={star.x} y={star.y + (isSelected ? 4 : 1)}>
							{star.hfd.toFixed(1)}
						</text>
					</g>
				)
			})}
		</svg>
	)
})
