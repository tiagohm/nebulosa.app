import { memo, useContext } from 'react'
import { useSnapshot } from 'valtio'
import { ImageViewerStoreContext } from '../shared/context'

const CROSSHAIR_RADII = ['1%', '5%', '15%', '30%'] as const
const CROSSHAIR_STROKE = 'var(--danger)'

function Circle(radius: string) {
	return <circle cx="50%" cy="50%" key={radius} r={radius} />
}

const CROSSHAIR = (
	<svg className="crosshair pointer-events-none absolute top-0 left-0 h-full w-full select-none" fill="none" stroke={CROSSHAIR_STROKE} strokeWidth={3}>
		<line x1="0" x2="100%" y1="50%" y2="50%" />
		<line x1="50%" x2="50%" y1="0" y2="100%" />
		{CROSSHAIR_RADII.map(Circle)}
	</svg>
)

export const Crosshair = memo(() => {
	const viewer = useContext(ImageViewerStoreContext)
	const { crosshair } = useSnapshot(viewer.state)
	return crosshair ? CROSSHAIR : undefined
})
