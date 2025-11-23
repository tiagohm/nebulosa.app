import { useMolecule } from 'bunshi/react'
import { type CSSProperties, memo } from 'react'
import { useSnapshot } from 'valtio'
import { StarDetectionMolecule } from '@/molecules/image/stardetection'

const TEXT_STYLE: CSSProperties = { textAnchor: 'middle', alignmentBaseline: 'text-before-edge', transform: 'rotate(0deg)' }

export const DetectedStars = memo(() => {
	const starDetection = useMolecule(StarDetectionMolecule)
	const { stars } = useSnapshot(starDetection.state)

	if (stars.length === 0) return null

	return (
		<svg className='pointer-events-none absolute top-0 left-0 h-full w-full select-none'>
			{stars.map((s) => (
				<g className='pointer-events-auto cursor-pointer' key={`${s.x}-${s.y}`} onPointerUp={() => starDetection.select(s)}>
					<circle cx={s.x - 0.5} cy={s.y - 0.5} fill='transparent' r={4} stroke='#FDD835' strokeWidth={1}></circle>
					<text className='text-xs font-bold' fill='#00897B' style={TEXT_STYLE} x={s.x} y={s.y + 0.5}>
						{s.hfd.toFixed(1)}
					</text>
				</g>
			))}
		</svg>
	)
})
