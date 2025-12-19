import { memo } from 'react'

export const Crosshair = memo(() => {
	return (
		<svg className='crosshair absolute left-0 top-0 pointer-events-none h-full w-full' stroke='#E53935' strokeWidth={3}>
			<line x1='0' x2='100%' y1='50%' y2='50%' />
			<line x1='50%' x2='50%' y1='0' y2='100%' />
			<circle cx='50%' cy='50%' fill='none' r='1%' />
			<circle cx='50%' cy='50%' fill='none' r='5%' />
			<circle cx='50%' cy='50%' fill='none' r='15%' />
			<circle cx='50%' cy='50%' fill='none' r='30%' />
		</svg>
	)
})
