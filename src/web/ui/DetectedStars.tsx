import { ImageViewerMolecule } from '@/shared/molecules'
import { useMolecule } from 'bunshi/react'
import type { DetectedStar } from 'nebulosa/src/stardetector'

export interface DetectedStarsProps {
	readonly rotation: number
	readonly stars: readonly DetectedStar[]
}

export function DetectedStars({ rotation, stars }: DetectedStarsProps) {
	const viewer = useMolecule(ImageViewerMolecule)

	return (
		<>
			<svg className='pointer-events-none absolute top-0 left-0 h-full w-full select-none'>
				{stars.map((s) => (
					<g key={`${s.x}-${s.y}`} className='pointer-events-auto cursor-pointer' onPointerUp={() => viewer.selectDetectedStar(s)}>
						<circle cx={s.x - 0.5} cy={s.y - 0.5} r={4} stroke='#FDD835' strokeWidth={1} fill='transparent'></circle>
						<text x={s.x} y={s.y + 0.5} fill='#00897B' className='text-xs font-bold' style={{ textAnchor: 'middle', alignmentBaseline: 'before-edge', transform: `rotate(${rotation}deg)` }}>
							{s.hfd.toFixed(1)}
						</text>
					</g>
				))}
			</svg>
		</>
	)
}
