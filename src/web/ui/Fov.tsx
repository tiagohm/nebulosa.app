import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { ImageFovMolecule } from '@/molecules/image/fov'

export const Fov = memo(() => {
	const fov = useMolecule(ImageFovMolecule)
	const { computed, items } = useSnapshot(fov.state)

	return (
		<svg className='fov absolute left-0 top-0 pointer-events-none h-full w-full' overflow='visible'>
			{computed.map(({ focalRatio, svg: { width, height } }, index) => {
				const { id, visible, color, rotation } = items[index]
				const x = 50 - width / 2
				const y = 50 - height / 2

				return <rect fill='none' height={`${height}%`} key={id} stroke={color} strokeWidth='1' style={{ transformOrigin: '50% 50%', transform: `rotate(${rotation}deg)`, display: focalRatio && visible ? 'inline' : 'none' }} width={`${width}%`} x={`${x}%`} y={`${y}%`} />
			})}
		</svg>
	)
})
