import { useMolecule } from 'bunshi/react'
import { type CSSProperties, memo } from 'react'
import type { AnnotatedSkyObject } from 'src/shared/types'
import { useSnapshot } from 'valtio'
import { ImageAnnotationMolecule } from '@/molecules/image/annotation'
import { skyObjectName } from '@/shared/util'

const TEXT_STYLE: CSSProperties = { textAnchor: 'middle', alignmentBaseline: 'text-before-edge', transform: 'rotate(0deg)' }

const Star = (s: AnnotatedSkyObject) => (
	<g className='pointer-events-auto cursor-pointer' key={s.id}>
		<circle cx={s.x - 0.5} cy={s.y - 0.5} fill='none' r={4} stroke='#FDD835' strokeWidth={1} />
		<text className='text-xs font-bold' fill='#00897B' style={TEXT_STYLE} x={s.x} y={s.y + 1.5}>
			{skyObjectName(s.name, s.constellation)}
		</text>
	</g>
)

export const AnnotatedStars = memo(() => {
	const annotation = useMolecule(ImageAnnotationMolecule)
	const { stars } = useSnapshot(annotation.state)

	if (stars.length === 0) return null

	return <svg className='annotated-stars pointer-events-none absolute top-0 left-0 h-full w-full select-none'>{stars.map(Star)}</svg>
})
