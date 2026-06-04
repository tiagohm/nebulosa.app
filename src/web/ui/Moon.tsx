import { memo } from 'react'
import moonWebp from '@/assets/moon.webp'

export const Moon = memo(() => (
	<span className="relative">
		<img className="h-auto w-full max-w-48 pt-8 select-none" draggable={false} src={moonWebp} />
	</span>
))
