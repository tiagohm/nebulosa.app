import { useMolecule } from 'bunshi/react'
import type { DetectedStar } from 'nebulosa/src/stardetector'
import { memo } from 'react'
import { StarDetectionMolecule } from '@/shared/molecules'

export interface DetectedStarsProps {
	readonly rotation: number
	readonly stars: readonly DetectedStar[]
}

export const DetectedStars = memo(({ rotation, stars }: DetectedStarsProps) => {
	const starDetection = useMolecule(StarDetectionMolecule)

	return (
		<>
			<svg className='pointer-events-none absolute top-0 left-0 h-full w-full select-none'>
				{stars.map((s) => (
					<g className='pointer-events-auto cursor-pointer' key={`${s.x}-${s.y}`} onPointerUp={() => starDetection.select(s)}>
						<circle cx={s.x - 0.5} cy={s.y - 0.5} fill='transparent' r={4} stroke='#FDD835' strokeWidth={1}></circle>
						<text className='text-xs font-bold' fill='#00897B' style={{ textAnchor: 'middle', alignmentBaseline: 'before-edge', transform: `rotate(${rotation}deg)` }} x={s.x} y={s.y + 0.5}>
							{s.hfd.toFixed(1)}
						</text>
					</g>
				))}
			</svg>
		</>
	)
})
