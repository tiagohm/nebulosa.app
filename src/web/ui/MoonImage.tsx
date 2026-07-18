import moonWebp from '@assets/moon.real.webp'
import { memo } from 'react'

export const MoonImage = memo(() => (
	<span className="relative">
		<img className="h-auto w-full max-w-48 pt-8 select-none" draggable={false} src={moonWebp} />
	</span>
))
