import { type CSSProperties, memo, useContext } from 'react'
import type { AnnotatedSkyObject } from 'src/shared/types'
import { useSnapshot } from 'valtio'
import { skyObjectName } from '@/shared/util'
import { ImageViewerStoreContext } from '../shared/context'

const TEXT_STYLE: CSSProperties = { textAnchor: 'middle', alignmentBaseline: 'text-before-edge', transform: 'rotate(0deg)' }

function Star(s: AnnotatedSkyObject) {
	const label = skyObjectName(s.name, s.constellation)

	return (
		<g key={`${s.type}-${s.id}`}>
			<circle cx={s.x - 0.5} cy={s.y - 0.5} fill="none" r={4} stroke="#FDD835" strokeWidth={1} />
			<text className="text-xs font-bold" fill="#00897B" style={TEXT_STYLE} x={s.x} y={s.y + 1.5}>
				{label}
			</text>
		</g>
	)
}

export const AnnotatedStars = memo(() => {
	const viewer = useContext(ImageViewerStoreContext)
	const { annotation } = viewer
	const { stars } = useSnapshot(annotation.state)

	if (stars.length === 0) return null

	return <svg className="annotated-stars pointer-events-none absolute top-0 left-0 h-full w-full select-none">{stars.map(Star)}</svg>
})
