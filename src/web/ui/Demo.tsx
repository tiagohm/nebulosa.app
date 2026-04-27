import { mulberry32 } from 'nebulosa/src/random'
import { memo, useState } from 'react'
import { toast } from '../shared/toast'
import { Button } from './components/Button'
import { Calendar } from './components/Calendar'
import { Checkbox } from './components/Checkbox'
import { Chip } from './components/Chip'
import { List } from './components/List'
import { NumberInput } from './components/NumberInput'
import { Popover } from './components/Popover'
import { Radio } from './components/Radio'
import { SearchTextInput } from './components/SearchTextInput'
import { Select } from './components/Select'
import { Slider } from './components/Slider'
import { Switch } from './components/Switch'
import { TextInput } from './components/TextInput'
import { Icons } from './Icon'

export function Demo() {
	return (
		<div className="flex w-full flex-row flex-wrap items-center gap-2 p-4">
			<Buttons />
			<Chips />
			<TextInputs />
			<NumberInputs />
			<Checkboxes />
			<Radios />
			<Switches />
			<Sliders />
			<Calendars />
			<Lists />
			<Selects />
		</div>
	)
}

const HeartIcon = <Icons.Heart />
const GalaxyIcon = <Icons.Galaxy />
const SearchIcon = <Icons.Search />

const COLORS = ['default', 'primary', 'secondary', 'success', 'danger', 'warning'] as const
const SIZES = ['sm', 'md', 'lg'] as const

const Buttons = memo(() => {
	const random = mulberry32(0)
	const elements: React.ReactNode[] = []
	let key = 0

	for (const variant of ['ghost', 'outline', 'solid', 'flat'] as const) {
		for (const size of SIZES) {
			for (const color of COLORS) {
				const startContent = random() < 0.5 ? HeartIcon : undefined
				const endContent = random() < 0.5 ? GalaxyIcon : undefined
				const tooltipContent = random() < 0.4 ? 'This button has a tooltip!' : undefined
				const toltipPlacementHit = tooltipContent !== undefined ? random() : 0
				const toltipPlacement = toltipPlacementHit >= 0.75 ? 'start' : toltipPlacementHit >= 0.5 ? 'top' : toltipPlacementHit >= 0.25 ? 'end' : 'bottom'
				const disabled = random() < 0.1
				const loading = random() < 0.02
				const label = key.toFixed(0)

				function handlePointer() {
					toast({ title: 'Hello!', onPointerUp: () => alert(label), description: 'Description', color, size, startContent, endContent, onClose: (autoDismiss) => !autoDismiss && alert('Hello!') })
				}

				elements.push(<Button color={color} disabled={disabled} endContent={endContent} key={key++} label={label} loading={loading} onPointerUp={handlePointer} size={size} startContent={startContent} tooltipContent={tooltipContent} tooltipPlacement={toltipPlacement} variant={variant} />)
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

	for (const color of COLORS) {
		for (const size of ['md', 'lg'] as const) {
			const startContent = random() < 0.5 ? HeartIcon : undefined
			const endContent = random() < 0.5 ? GalaxyIcon : undefined
			const disabled = random() < 0.1
			const readOnly = random() < 0.1
			const label = key.toFixed(0)

			elements.push(<TextInput color={color} disabled={disabled} endContent={endContent} key={key++} label={label} onValueChange={setValue} readOnly={readOnly} size={size} startContent={startContent} value={value} />)
		}
	}

	elements.push(<SearchTextInput onClear={() => alert('clear')} value={value} onValueChange={setValue} />)

	return elements
})

const NumberInputs = memo(() => {
	const [value, setValue] = useState(30)
	const random = mulberry32(0)
	const elements: React.ReactNode[] = []
	let key = 0

	for (const color of COLORS) {
		for (const size of ['md', 'lg'] as const) {
			const startContent = random() < 0.5 ? HeartIcon : undefined
			const endContent = random() < 0.5 ? GalaxyIcon : undefined
			const disabled = random() < 0.1
			const readOnly = random() < 0.1
			const step = key / 4
			const fractionDigits = Math.trunc(random() * 8)
			const label = key.toFixed(0)

			elements.push(<NumberInput color={color} disabled={disabled} endContent={endContent} fractionDigits={fractionDigits} key={key++} label={label} maxValue={60} minValue={15} onValueChange={setValue} readOnly={readOnly} size={size} startContent={startContent} step={step} value={value} />)
		}
	}

	return elements
})

const Checkboxes = memo(() => {
	const [value, setValue] = useState(false)
	const random = mulberry32(0)
	const elements: React.ReactNode[] = []
	let key = 0

	for (const color of COLORS) {
		for (const size of SIZES) {
			const disabled = random() < 0.3
			const readOnly = random() < 0.3
			const label = key.toFixed(0)

			elements.push(<Checkbox color={color} disabled={disabled} key={key++} label={label} onValueChange={setValue} readOnly={readOnly} size={size} value={value} />)
		}
	}

	return elements
})

const Radios = memo(() => {
	const [value, setValue] = useState(false)
	const random = mulberry32(0)
	const elements: React.ReactNode[] = []
	let key = 0

	for (const color of COLORS) {
		for (const size of SIZES) {
			const disabled = random() < 0.3
			const readOnly = random() < 0.3
			const label = key.toFixed(0)

			elements.push(<Radio color={color} disabled={disabled} key={key++} label={label} onValueChange={setValue} readOnly={readOnly} size={size} value={value} />)
		}
	}

	return elements
})

const Switches = memo(() => {
	const [value, setValue] = useState(false)
	const random = mulberry32(0)
	const elements: React.ReactNode[] = []
	let key = 0

	for (const color of COLORS) {
		for (const size of SIZES) {
			const disabled = random() < 0.3
			const readOnly = random() < 0.3
			const label = key.toFixed(0)

			elements.push(<Switch color={color} disabled={disabled} key={key++} label={label} onValueChange={setValue} readOnly={readOnly} size={size} value={value} />)
		}
	}

	return elements
})

const Sliders = memo(() => {
	const [value, setValue] = useState(0)
	const [range, setRange] = useState([0, 100] as const)
	const random = mulberry32(0)
	const elements: React.ReactNode[] = []
	let key = 0

	for (const color of COLORS) {
		for (const size of SIZES) {
			const disabled = random() < 0.3
			const readOnly = random() < 0.3
			const label = key.toFixed(0)
			const step = 1
			const isRange = random() < 0.5

			if (isRange) elements.push(<Slider color={color} disabled={disabled} key={key++} label={label} onValueChange={setRange} readOnly={readOnly} size={size} step={step} value={range} vertical />)
			else elements.push(<Slider color={color} disabled={disabled} key={key++} label={label} onValueChange={setValue} readOnly={readOnly} size={size} step={step} value={value} vertical />)
		}
	}

	return elements
})

const Calendars = memo(() => {
	const [value, setValue] = useState(Temporal.Now.plainDateISO())
	const [open, setOpen] = useState(true)

	return (
		<>
			<Popover onOpenChange={setOpen} open={open} placement="end" trigger={<Button label="Calendar" />}>
				<Calendar onValueChange={setValue} showWeekNumber value={value} color="default" />
			</Popover>

			<Calendar color="success" disabled onValueChange={setValue} value={value} />
			<Calendar onValueChange={setValue} readOnly value={value} />
		</>
	)
})

const Chips = memo(() => {
	const random = mulberry32(0)
	const elements: React.ReactNode[] = []
	let key = 0

	for (const size of SIZES) {
		for (const color of COLORS) {
			const startContent = random() < 0.5 ? HeartIcon : undefined
			const endContent = random() < 0.5 ? GalaxyIcon : undefined
			const disabled = random() < 0.1
			const readOnly = random() < 0.1
			const close = random() < 0.3
			const label = key.toFixed(0)

			elements.push(<Chip color={color} disabled={disabled} endContent={endContent} key={key++} label={label} onClose={close ? () => alert(label) : undefined} readOnly={readOnly} size={size} startContent={startContent} />)
		}
	}

	return elements
})

const Lists = memo(() => {
	return (
		<List className="min-w-80" itemHeight={20} itemCount={100000}>
			{(i) => <span className="flex h-full w-full items-center justify-center">{i}</span>}
		</List>
	)
})

const Selects = memo(() => {
	const [value, setValue] = useState('A')
	const items = ['A', 'B', 'C'] as const

	const random = mulberry32(0)
	const elements: React.ReactNode[] = []
	let key = 0

	for (const size of SIZES) {
		for (const color of COLORS) {
			const startContent = random() < 0.5 ? HeartIcon : undefined
			const endContent = random() < 0.5 ? GalaxyIcon : undefined
			const disabled = random() < 0.05
			const readOnly = random() < 0.05
			const headerContent = random() < 0.1 ? <TextInput placeholder="Search" fullWidth startContent={SearchIcon} /> : undefined
			const label = key.toFixed(0)

			elements.push(
				<Select color={color} items={items} headerContent={headerContent} size={size} disabled={disabled} readOnly={readOnly} startContent={startContent} endContent={endContent} label={label} description="Select an item" className="min-w-80" itemHeight={32} value={value} onValueChange={setValue}>
					{(i) => <span className="flex h-full w-full items-center justify-center">{i}</span>}
				</Select>,
			)
		}
	}

	return <div className="grid grid-cols-3 items-center gap-2">{elements}</div>
})
