import { memo } from 'react'
import moonWebp from '@/assets/moon.webp'

export interface MoonProps {}

export const Moon = memo((props: MoonProps) => {
	return (
		<span className='relative'>
			<img className='pt-8 select-none max-w-50 w-full h-auto' draggable={false} src={moonWebp} />
		</span>
	)
})
