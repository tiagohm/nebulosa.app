import { memo } from 'react'
import moonWebp from '@/assets/moon.webp'

export interface MoonProps {}

export const Moon = memo((props: MoonProps) => {
	return (
		<span className='relative'>
			<img className='pt-8 select-none' draggable={false} height={246} src={moonWebp} width={220} />
		</span>
	)
})
