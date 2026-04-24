import { memo } from 'react'
import moonWebp from '@/assets/moon.webp'

export interface MoonProps {}

export const Moon = memo((props: MoonProps) => {
	return (
		<span className="relative">
			<img className="h-auto w-full max-w-48 pt-8 select-none" draggable={false} src={moonWebp} />
		</span>
	)
})
