import { useMolecule } from 'bunshi/react'
import { type CSSProperties, memo } from 'react'
import { useSnapshot } from 'valtio'
import { ImageAnnotationMolecule } from '@/molecules/image/annotation'

const TEXT_STYLE: CSSProperties = { textAnchor: 'middle', alignmentBaseline: 'before-edge', transform: 'rotate(0deg)' }

export const AnnotatedStars = memo(() => {
	const annotation = useMolecule(ImageAnnotationMolecule)
	const { stars } = useSnapshot(annotation.state)

	if (stars.length === 0) return null

	return (
		<svg className='pointer-events-none absolute top-0 left-0 h-full w-full select-none'>
			{stars.map((s) => (
				<g className='pointer-events-auto cursor-pointer' key={s.id}>
					<circle cx={s.x - 0.5} cy={s.y - 0.5} fill='transparent' r={4} stroke='#FDD835' strokeWidth={1}></circle>
					<text className='text-xs font-bold' fill='#00897B' style={TEXT_STYLE} x={s.x} y={s.y + 0.5}>
						{s.name}
					</text>
				</g>
			))}
		</svg>
	)
})
