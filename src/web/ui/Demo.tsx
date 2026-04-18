import { mulberry32 } from 'nebulosa/src/random'
import { memo, useState } from 'react'
import { Button } from './components/Button'
import { Checkbox } from './components/Checkbox'
import { NumberInput } from './components/NumberInput'
import { TextInput } from './components/TextInput'
import { Icons } from './Icon'

export function Demo() {
	return (
		<div className='w-full flex flex-row flex-wrap items-center gap-2 p-4'>
			<Buttons />
			<TextInputs />
			<NumberInputs />
			<Checkboxes />
		</div>
	)
}

const HeartIcon = <Icons.Heart />
const GalaxyIcon = <Icons.Galaxy />

const Buttons = memo(() => {
	const random = mulberry32(0)
	const elements: React.ReactNode[] = []
	let key = 0

	for (const variant of ['ghost', 'outline', 'solid', 'flat'] as const) {
		for (const size of ['sm', 'md', 'lg'] as const) {
			for (const color of ['primary', 'secondary', 'success', 'danger', 'warning'] as const) {
				const startContent = random() < 0.5 ? HeartIcon : undefined
				const endContent = random() < 0.5 ? GalaxyIcon : undefined
				const tooltipContent = random() < 0.2 ? 'This button has a tooltip!' : undefined
				const toltipPlacementHit = tooltipContent !== undefined ? random() : 0
				const toltipPlacement = toltipPlacementHit >= 0.75 ? 'start' : toltipPlacementHit >= 0.5 ? 'top' : toltipPlacementHit >= 0.25 ? 'end' : 'bottom'
				const disabled = random() < 0.1
				const loading = random() < 0.02
				const label = key.toFixed(0)

				elements.push(<Button color={color} disabled={disabled} endContent={endContent} key={key++} label={label} loading={loading} size={size} startContent={startContent} tooltipContent={tooltipContent} tooltipPlacement={toltipPlacement} variant={variant} />)
			}
		}
	}

	return elements
})

const TextInputs = memo(() => {
	const [value, setValue] = useState('A')
	const random = mulberry32(0)
	const elements: React.ReactNode[] = []
	let key = 0

	for (let i = 0; i < 8; i++) {
		for (const size of ['md', 'lg'] as const) {
			const startContent = random() < 0.5 ? HeartIcon : undefined
			const endContent = random() < 0.5 ? GalaxyIcon : undefined
			const disabled = random() < 0.1
			const readOnly = random() < 0.1
			const label = key.toFixed(0)

			elements.push(<TextInput disabled={disabled} endContent={endContent} key={key++} label={label} onValueChange={setValue} readOnly={readOnly} size={size} startContent={startContent} value={value} />)
		}
	}

	return elements
})

const NumberInputs = memo(() => {
	const [value, setValue] = useState(30)
	const random = mulberry32(0)
	const elements: React.ReactNode[] = []
	let key = 0

	for (let i = 1; i <= 8; i++) {
		for (const size of ['md', 'lg'] as const) {
			const startContent = random() < 0.5 ? HeartIcon : undefined
			const endContent = random() < 0.5 ? GalaxyIcon : undefined
			const disabled = random() < 0.1
			const readOnly = random() < 0.1
			const step = i / 4
			const fractionDigits = Math.trunc(random() * 8)
			const label = key.toFixed(0)

			elements.push(<NumberInput disabled={disabled} endContent={endContent} fractionDigits={fractionDigits} key={key++} label={label} maxValue={60} minValue={15} onValueChange={setValue} readOnly={readOnly} size={size} startContent={startContent} step={step} value={value} />)
		}
	}

	return elements
})

const Checkboxes = memo(() => {
	const [value, setValue] = useState(false)
	const random = mulberry32(0)
	const elements: React.ReactNode[] = []
	let key = 0

	for (let i = 1; i <= 8; i++) {
		for (const size of ['sm', 'md', 'lg'] as const) {
			const disabled = random() < 0.2
			const readOnly = random() < 0.1
			const label = key.toFixed(0)

			elements.push(<Checkbox disabled={disabled} key={key++} label={label} onValueChange={setValue} readOnly={readOnly} size={size} value={value} />)
		}
	}

	return elements
})
