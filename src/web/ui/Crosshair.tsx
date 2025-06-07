export interface CrosshairProps {
	readonly angle?: number
}

export function Crosshair({ angle = 0 }: CrosshairProps) {
	return (
		<svg className='absolute left-0 top-0 pointer-events-none h-full w-full' stroke='#E53935' strokeWidth={3}>
			<line x1='0' y1='50%' x2='100%' y2='50%'></line>
			<line x1='50%' y1='0' x2='50%' y2='100%'></line>
			<circle cx='50%' cy='50%' r='1%' fill='transparent'></circle>
			<circle cx='50%' cy='50%' r='5%' fill='transparent'></circle>
			<circle cx='50%' cy='50%' r='15%' fill='transparent'></circle>
			<circle cx='50%' cy='50%' r='30%' fill='transparent'></circle>
		</svg>
	)
}
