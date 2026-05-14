import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { ImageFovMolecule } from '@/molecules/image/fov'

export const Fov = memo(() => {
	const fov = useMolecule(ImageFovMolecule)
	const { computed, items } = useSnapshot(fov.state)

	return (
		<svg className="fov pointer-events-none absolute top-0 left-0 h-full w-full" overflow="visible">
			{items.map(({ id, visible, color, rotation }, index) => {
				const item = computed[index]

				if (!visible || !item || !isDrawableFov(item.focalRatio, item.svg.width, item.svg.height)) return null

				const { width, height } = item.svg
				const x = FOV_CENTER - width / 2
				const y = FOV_CENTER - height / 2
				const safeRotation = Number.isFinite(rotation) ? rotation : 0

				return <rect fill="none" height={`${height}%`} key={id} stroke={color} strokeWidth="1" style={{ transformOrigin: '50% 50%', transform: `rotate(${safeRotation}deg)` }} width={`${width}%`} x={`${x}%`} y={`${y}%`} />
			})}
		</svg>
	)
})

const FOV_CENTER = 50

function isDrawableFov(focalRatio: number, width: number, height: number) {
	return focalRatio > 0 && Number.isFinite(focalRatio) && width > 0 && Number.isFinite(width) && height > 0 && Number.isFinite(height)
}
