import { deg, hour } from 'nebulosa/src/angle'
import { DEG2RAD, PI } from 'nebulosa/src/constants'
import { mulberry32 } from 'nebulosa/src/random'
import { memo, useCallback, useRef, useState } from 'react'
import type { Celestial, ConstellationData, ConstellationLine, DeepSkyObject, ShapeRenderState, Star } from 'src/lib/celestial/celestial'
import { toast } from '../shared/toast'
import { Badge } from './components/Badge'
import { Breadcrumbs } from './components/Breadcrumbs'
import { Button } from './components/Button'
import { ButtonGroup, ButtonGroupItem } from './components/ButtonGroup'
import { Calendar } from './components/Calendar'
import { Checkbox } from './components/Checkbox'
import { Chip } from './components/Chip'
import { DateTimeInput } from './components/DateTimeInput'
import { Dropdown, DropdownItem } from './components/Dropdown'
import { List } from './components/List'
import { MultiSelect } from './components/MultiSelect'
import { NumberInput } from './components/NumberInput'
import { Popover, type PopoverMethods } from './components/Popover'
import { ProgressBar } from './components/ProgressBar'
import { Radio } from './components/Radio'
import { SearchTextInput } from './components/SearchTextInput'
import { Select } from './components/Select'
import { Slider } from './components/Slider'
import { Switch } from './components/Switch'
import { Table } from './components/Table'
import { Tab, TabPanel, Tabs } from './components/Tabs'
import { TextInput } from './components/TextInput'
import { Icons } from './Icon'
import { SkyMap } from './SkyMap'

export function Demo() {
	return (
		<Tabs defaultValue='18' color="primary" className="h-full p-4" classNames={{ panel: 'h-full' }}>
			<Tab id="18">Sky Map</Tab>
			<Tab id="0">Buttons</Tab>
			<Tab id="13">Button Groups</Tab>
			<Tab id="16">Breadcrumbs</Tab>
			<Tab id="1">Chips</Tab>
			<Tab id="2">Text Inputs</Tab>
			<Tab id="14">Date Time Inputs</Tab>
			<Tab id="3">Number Inputs</Tab>
			<Tab id="4">Checkboxes</Tab>
			<Tab id="5">Radios</Tab>
			<Tab id="6">Switches</Tab>
			<Tab id="7">Sliders</Tab>
			<Tab id="8">Calendars</Tab>
			<Tab id="9">Lists</Tab>
			<Tab id="10">Selects</Tab>
			<Tab id="15">Multi Selects</Tab>
			<Tab id="11">Dropdowns</Tab>
			<Tab id="12">Progress Bars</Tab>
			<Tab id="17">Tables</Tab>
			<TabPanel id="0" className="flex w-full flex-row flex-wrap content-start items-center gap-2 p-4">
				<Buttons />
			</TabPanel>
			<TabPanel id="1" className="flex w-full flex-row flex-wrap content-start items-center gap-2 p-4">
				<Chips />
			</TabPanel>
			<TabPanel id="2" className="flex w-full flex-row flex-wrap content-start items-center gap-2 p-4">
				<TextInputs />
			</TabPanel>
			<TabPanel id="3" className="flex w-full flex-row flex-wrap content-start items-center gap-2 p-4">
				<NumberInputs />
			</TabPanel>
			<TabPanel id="4" className="flex w-full flex-row flex-wrap content-start items-center gap-2 p-4">
				<Checkboxes />
			</TabPanel>
			<TabPanel id="5" className="flex w-full flex-row flex-wrap content-start items-center gap-2 p-4">
				<Radios />
			</TabPanel>
			<TabPanel id="6" className="flex w-full flex-row flex-wrap content-start items-center gap-2 p-4">
				<Switches />
			</TabPanel>
			<TabPanel id="7" className="flex w-full flex-row flex-wrap content-start items-center gap-2 p-4">
				<Sliders />
			</TabPanel>
			<TabPanel id="8" className="flex w-full flex-row flex-wrap content-start items-center gap-2 p-4">
				<Calendars />
			</TabPanel>
			<TabPanel id="9" className="flex w-full flex-row flex-wrap content-start items-center gap-2 p-4">
				<Lists />
			</TabPanel>
			<TabPanel id="10" className="flex w-full flex-row flex-wrap content-start items-center gap-2 p-4">
				<Selects />
			</TabPanel>
			<TabPanel id="11" className="flex w-full flex-row flex-wrap content-start items-center gap-2 p-4">
				<Dropdowns />
			</TabPanel>
			<TabPanel id="12" className="flex w-full flex-row flex-wrap content-start items-center gap-2 p-4">
				<ProgressBars />
			</TabPanel>
			<TabPanel id="13" className="flex w-full flex-row flex-wrap content-start items-center gap-2 p-4">
				<ButtonGroups />
			</TabPanel>
			<TabPanel id="14" className="flex w-full flex-row flex-wrap content-start items-center gap-2 p-4">
				<DateTimeInputs />
			</TabPanel>
			<TabPanel id="15" className="flex w-full flex-row flex-wrap content-start items-center gap-2 p-4">
				<MultiSelects />
			</TabPanel>
			<TabPanel id="16" className="flex w-full flex-col gap-3 p-4">
				<BreadCrumbs />
			</TabPanel>
			<TabPanel id="17" className="flex w-full flex-col gap-3 p-4">
				<Tables />
			</TabPanel>
			<TabPanel id="18" className="flex w-full flex-col gap-3 p-4">
				<SkyMaps />
			</TabPanel>
		</Tabs>
	)
}

const HeartIcon = <Icons.Heart />
const GalaxyIcon = <Icons.Galaxy />
const SearchIcon = <Icons.Search />

const HOUR_TO_RAD = PI / 12
const COLORS = ['default', 'primary', 'secondary', 'success', 'danger', 'warning'] as const
const SIZES = ['sm', 'md', 'lg'] as const

const SKY_MAP_OBSERVER = {
	latitude: -22,
	longitude: -45,
	elevation: 900,
}

const SKY_MAP_STARS = [
	star('Sirius', 6.752477, -16.716116, -1.46, 0),
	star('Canopus', 6.399199, -52.695661, -0.74, 0.15),
	star('Arcturus', 14.261021, 19.182417, -0.05, 1.23),
	star('Vega', 18.615649, 38.783689, 0.03, 0),
	star('Capella', 5.278155, 45.997991, 0.08, 0.8),
	star('Rigel', 5.242298, -8.20164, 0.13, -0.03),
	star('Procyon', 7.655033, 5.224993, 0.34, 0.42),
	star('Betelgeuse', 5.919529, 7.407064, 0.42, 1.85),
	star('Achernar', 1.628571, -57.236753, 0.46, -0.16),
	star('Hadar', 14.063729, -60.373039, 0.61, -0.23),
	star('Acrux', 12.443304, -63.099092, 0.77, -0.24),
]

const SKY_MAP_CONSTELLATIONS = {
	lines: [line(5.919529, 7.407064, 5.603559, -1.201919), line(5.603559, -1.201919, 5.679312, -1.942572), line(5.679312, -1.942572, 5.242298, -8.20164)],
	labels: [{ name: 'Orion', rightAscension: 5.58 * HOUR_TO_RAD, declination: 0 }],
} satisfies ConstellationData

const SKY_MAP_DEEP_SKY_OBJECTS = [
	{
		id: 'M42',
		name: 'Orion Nebula',
		type: 'nebula',
		rightAscension: 5.588139 * HOUR_TO_RAD,
		declination: -5.391111 * DEG2RAD,
		mag: 4,
		sizeArcMin: 65,
	},
] satisfies DeepSkyObject[]

// Builds a demo star from right ascension in hours and declination in degrees.
function star(name: string, raHours: number, decDegrees: number, mag: number, bv: number): Star {
	return { name, rightAscension: raHours * HOUR_TO_RAD, declination: decDegrees * DEG2RAD, mag, bv }
}

// Builds a demo constellation segment from right ascension in hours and declination in degrees.
function line(fromRaHours: number, fromDecDegrees: number, toRaHours: number, toDecDegrees: number): ConstellationLine {
	return {
		from: { rightAscension: fromRaHours * HOUR_TO_RAD, declination: fromDecDegrees * DEG2RAD },
		to: { rightAscension: toRaHours * HOUR_TO_RAD, declination: toDecDegrees * DEG2RAD },
	}
}

const SkyMaps = memo(() => {
	function renderTelescope(celestial: Celestial, ctx: CanvasRenderingContext2D, state: ShapeRenderState) {
		ctx.fillStyle = 'red'
		ctx.beginPath()
		ctx.rect(state.x - 2, state.y - 2, 4, 4)
		ctx.fill()
	}

	function handleSkyMapReady(celestial: Celestial) {
		celestial.loadConstellations(SKY_MAP_CONSTELLATIONS)
		celestial.loadDeepSkyObjects(SKY_MAP_DEEP_SKY_OBJECTS)
		celestial.loadStars(SKY_MAP_STARS)
		celestial.setObserver(SKY_MAP_OBSERVER)
		celestial.setMagnitudeLimit(6)
		celestial.startAutoUpdate({ mode: 'realtime', interval: 15000 })
		celestial.on('click', (event) => console.info(event.x, event.y, event.coordinate))
		celestial.addShape({ id: 'telescopio', visible: true, selectable: false, coordinate: { rightAscension: hour(14), declination: deg(-5) }, render: renderTelescope })
	}

	return <SkyMap onReady={handleSkyMapReady} className="w-full" height="100%" />
})

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
				const tooltipPlacementHit = tooltipContent !== undefined ? random() : 0
				const tooltipPlacement = tooltipPlacementHit >= 0.75 ? 'start' : tooltipPlacementHit >= 0.5 ? 'top' : tooltipPlacementHit >= 0.25 ? 'end' : 'bottom'
				const disabled = random() < 0.1
				const loading = random() < 0.02
				const label = key.toFixed(0)

				function handleClick() {
					toast({ title: 'Hello!', onClick: () => alert(label), description: 'Description', color, size, startContent, endContent, onClose: (autoDismiss) => !autoDismiss && alert('Hello!') })
				}

				elements.push(
					<Badge color={color} size={size} label={disabled ? undefined : label} placement="top-end" visible={!loading}>
						<Button color={color} disabled={disabled} endContent={endContent} key={key++} label={label} loading={loading} onClick={handleClick} size={size} startContent={startContent} tooltipContent={tooltipContent} tooltipPlacement={tooltipPlacement} variant={variant} />
					</Badge>,
				)
			}
		}
	}

	return elements
})

const ButtonGroups = memo(() => {
	const [value, setValue] = useState('A')
	const random = mulberry32(0)
	const elements: React.ReactNode[] = []
	let key = 0

	for (const size of SIZES) {
		for (const color of COLORS) {
			const disabled = random() < 0.1
			const readOnly = random() < 0.1

			elements.push(
				<ButtonGroup color={color} disabled={disabled} key={key++} onValueChange={setValue} readOnly={readOnly} size={size} value={value}>
					<ButtonGroupItem id="A" label="A" />
					<ButtonGroupItem id="B" label="B" />
					<ButtonGroupItem id="C" label="C" />
				</ButtonGroup>,
			)
		}
	}

	return elements
})

const BreadCrumbs = memo(() => (
	<>
		<Breadcrumbs>
			<Button color="default" label="Home" size="sm" variant="ghost" />
			<Button color="primary" label="Capture" size="sm" variant="ghost" />
			<Chip color="secondary" label="Sequence" size="sm" />
		</Breadcrumbs>

		<Breadcrumbs maxItems={3}>
			<Button color="default" label="Home" size="sm" variant="ghost" />
			<Button color="default" label="Profile" size="sm" variant="ghost" />
			<Button color="default" label="Capture" size="sm" variant="ghost" />
			<Button color="primary" label="Sequences" size="sm" variant="ghost" />
			<Chip color="secondary" label="M42" size="sm" />
		</Breadcrumbs>

		<Breadcrumbs ellipsis={<Chip color="default" label="More" size="sm" />} maxItems={2} separator={<span>/</span>}>
			<Button color="default" label="Home" size="sm" variant="ghost" />
			<Button color="default" label="Equipment" size="sm" variant="ghost" />
			<Button color="primary" label="Camera" size="sm" variant="ghost" />
			<Chip color="success" label="Connected" size="sm" />
		</Breadcrumbs>

		<Breadcrumbs disabled>
			<Button color="default" label="Home" size="sm" variant="ghost" />
			<Button color="default" label="Settings" size="sm" variant="ghost" />
			<span>Disabled</span>
		</Breadcrumbs>
	</>
))

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

const DateTimeInputs = memo(() => {
	const [value, setValue] = useState(() => Temporal.Now.plainDateTimeISO())
	const formats = [
		{ format: 'YMD', granularity: 'none' },
		{ format: 'DMY', granularity: 'hour' },
		{ format: 'YMD', granularity: 'minute' },
		{ format: 'DMY', granularity: 'second' },
	] as const

	const random = mulberry32(0)
	const elements: React.ReactNode[] = []
	let key = 0

	for (const { format, granularity } of formats) {
		for (const color of COLORS) {
			for (const size of ['md', 'lg'] as const) {
				const startContent = random() < 0.5 ? HeartIcon : undefined
				const endContent = random() < 0.5 ? GalaxyIcon : undefined
				const disabled = random() < 0.1
				const readOnly = random() < 0.1
				const label = key.toFixed(0)

				elements.push(<DateTimeInput color={color} disabled={disabled} endContent={endContent} format={format} granularity={granularity} key={key++} label={label} onValueChange={setValue} readOnly={readOnly} size={size} startContent={startContent} value={value} />)
			}
		}
	}

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
	const popoverRef = useRef<PopoverMethods | null>(null)
	const [value, setValue] = useState(Temporal.Now.plainDateISO())

	return (
		<>
			<Popover ref={popoverRef} placement="end" trigger={<Button label="Calendar" />}>
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
	const render = useCallback((i: number) => i, [])

	return (
		<List className="min-w-80" itemHeight={20} itemCount={100000} onAction={alert} classNames={{ item: 'text-center' }} overscan={8}>
			{render}
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
				<Select color={color} items={items} headerContent={headerContent} key={key++} size={size} disabled={disabled} readOnly={readOnly} startContent={startContent} endContent={endContent} label={label} description="Select an item" className="min-w-80" itemHeight={32} value={value} onValueChange={setValue}>
					{(i) => <span className="flex h-full w-full items-center justify-center">{i}</span>}
				</Select>,
			)
		}
	}

	return <div className="grid grid-cols-3 items-center gap-2">{elements}</div>
})

const Dropdowns = memo(() => {
	const [value, setValue] = useState('A')
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

			elements.push(
				<Dropdown color={color} onAction={(index) => setValue(String.fromCodePoint(65 + index))} headerContent={headerContent} key={key++} size={size} disabled={disabled} readOnly={readOnly} startContent={startContent} endContent={endContent} label={value} className="min-w-80" itemHeight={32}>
					<DropdownItem startContent={HeartIcon}>A</DropdownItem>
					<DropdownItem disabled startContent={GalaxyIcon}>
						B
					</DropdownItem>
					<DropdownItem className="bg-red-700 text-white" startContent={<Icons.Trash />}>
						C
					</DropdownItem>
				</Dropdown>,
			)
		}
	}

	return <div className="grid grid-cols-3 items-center gap-2">{elements}</div>
})

const ProgressBars = memo(() => {
	const random = mulberry32(0)
	const elements: React.ReactNode[] = []
	let key = 0

	for (const size of SIZES) {
		for (const color of COLORS) {
			const startContent = random() < 0.5 ? HeartIcon : undefined
			const endContent = random() < 0.5 ? GalaxyIcon : undefined
			const disabled = random() < 0.1
			const readOnly = random() < 0.1
			const indeterminate = random() < 0.1
			const value = 1 + random() * 99

			elements.push(<ProgressBar startContent={startContent} endContent={endContent} size={size} color={color} disabled={disabled} readOnly={readOnly} indeterminate={indeterminate} value={value} key={key++} />)
		}
	}

	return <div className="grid grid-cols-3 items-center gap-3">{elements}</div>
})

const MultiSelects = memo(() => {
	const [value, setValue] = useState(['A'])
	const items = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M'] as const

	const random = mulberry32(0)
	const elements: React.ReactNode[] = []
	let key = 0

	for (const size of SIZES) {
		for (const color of COLORS) {
			const startContent = random() < 0.5 ? HeartIcon : undefined
			const endContent = random() < 0.5 ? GalaxyIcon : undefined
			const disabled = random() < 0.05
			const readOnly = random() < 0.05
			const disallowEmptySelection = random() < 0.05
			const label = key.toFixed(0)

			elements.push(
				<MultiSelect
					clearable
					color={color}
					items={items}
					disallowEmptySelection={disallowEmptySelection}
					key={key++}
					size={size}
					disabled={disabled}
					readOnly={readOnly}
					startContent={startContent}
					endContent={endContent}
					label={label}
					description="Select an item"
					className="w-100"
					itemHeight={32}
					value={value}
					onValueChange={setValue}>
					{(i) => <span className="flex h-full w-full items-center justify-center">{i}</span>}
				</MultiSelect>,
			)
		}
	}

	return <div className="grid grid-cols-3 items-center gap-2">{elements}</div>
})

const Tables = memo(() => (
	<Table className="min-w-80" rowHeight={28} columnCount={3} rowCount={2} onAction={(row, col) => alert(`row: ${row}, col: ${col}`)} overscan={8}>
		<span>Name</span>
		<span>Magnitude</span>
		<span>Type</span>
		<span>M1</span>
		<span>8.4</span>
		<span>Supernova Remnant</span>
		<span>M2</span>
		<span>6.3</span>
		<span>Globular Cluster</span>
	</Table>
))
