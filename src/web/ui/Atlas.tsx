import { tw } from '@shared/util'
import { atlasStore, type TagItem } from '@stores/atlas.store'
import { BodyCoordinateInfo } from '@ui/BodyCoordinateInfo'
import { Chip } from '@ui/components/Chip'
import { IconButton } from '@ui/components/IconButton'
import { MountDropdown } from '@ui/DeviceDropdown'
import { type Icon, Icons } from '@ui/Icon'
import { formatTemporal } from 'nebulosa/src/astronomy/time/temporal'
import { RAD2DEG } from 'nebulosa/src/core/constants'
import type { Mount } from 'nebulosa/src/devices/indi/device'
import React, { createContext, memo, useContext, useDeferredValue, useMemo } from 'react'
import { Area, type AreaProps, CartesianGrid, Tooltip as ChartTooltip, ComposedChart, Line, type TooltipContentProps, XAxis, YAxis } from 'recharts'
import { EMPTY_TWILIGHT, type BodyPosition, type Twilight } from 'src/shared/types'
import { useSnapshot } from 'valtio'

export interface EphemerisPositionContextParameters {
	readonly state: {
		readonly favorite?: boolean
		readonly position: BodyPosition
		readonly tags: readonly TagItem[]
		readonly chart: readonly number[]
	}
	readonly sync: (mount?: Mount) => void
	readonly goTo: (mount?: Mount) => void
	readonly frame: () => void
	readonly handleFavorite?: (favorite: boolean) => void
}

export const EphemerisPositionContext = createContext<EphemerisPositionContextParameters>(null as never)

export interface AstronomicalEventProps extends Omit<React.ComponentProps<'div'>, 'children'> {
	readonly icon: Icon
	readonly label: string
	readonly time: number
	readonly offset?: number
	readonly format: string
}

export const AstronomicalEvent = memo(({ icon: Icon, label, time, offset, format, className, ...props }: AstronomicalEventProps) => (
	<div className={tw('flex flex-row items-center gap-1 hover:bg-neutral-700 rounded-md p-2 cursor-pointer', className)} {...props}>
		<Icon />
		<div className="flex flex-col items-start justify-center gap-0 font-bold">
			{label}
			<span>{formatTemporal(time, format, offset)}</span>
		</div>
	</div>
))

export const EphemerisAndChart = memo(() => (
	<div className="@container col-span-full flex flex-col items-center justify-start gap-1">
		<span className="flex w-full flex-col gap-2 @[750px]:flex-row">
			<EphemerisPosition />
			<EphemerisChart />
		</span>
	</div>
))

const EphemerisPosition = memo(() => {
	const context = useContext(EphemerisPositionContext)
	const { position, favorite, tags } = useSnapshot(context.state)
	const { handleFavorite } = context

	return (
		<div className="flex flex-1 flex-col gap-2 p-0">
			<div className="flex flex-row gap-2 p-1 text-start text-sm font-bold">
				<div className="flex flex-1 items-center justify-center gap-1 overflow-hidden text-sm font-bold">{tags.map(TagChipItem)}</div>
				{handleFavorite && <IconButton color={favorite ? 'danger' : 'warning'} disabled={favorite === undefined || tags.length === 0} icon={favorite ? Icons.BookmarkRemove : Icons.BookmarkPlus} onClick={() => handleFavorite(!favorite)} tooltipContent={favorite ? 'Remove bookmark' : 'Add bookmark'} />}
			</div>
			<BodyCoordinateInfo position={position} hideLst />
			<EphemerisPositionCommand />
		</div>
	)
})

function TagChipItem(tag: TagItem) {
	return <Chip color={tag.color} key={tag.label} label={tag.label} size="sm" />
}

const EphemerisPositionCommand = memo(() => {
	const context = useContext(EphemerisPositionContext)

	return (
		<div className="flex items-center justify-center gap-2">
			<MountDropdown color="primary" disallowNoneSelection icon={Icons.Sync} onValueChange={context.sync} tooltipContent="Sync" variant="flat" />
			<MountDropdown color="success" disallowNoneSelection onValueChange={context.goTo} tooltipContent="Go" variant="flat" />
			<IconButton color="secondary" icon={Icons.Image} onClick={context.frame} tooltipContent="Frame" variant="flat" />
		</div>
	)
})

interface EphemerisChartData {
	readonly name: string | number
	readonly value: number | null
	readonly civilDawn: number | null
	readonly nauticalDawn: number | null
	readonly astronomicalDawn: number | null
	readonly civilDusk: number | null
	readonly nauticalDusk: number | null
	readonly astronomicalDusk: number | null
	readonly dayFirst: number | null
	readonly dayLast: number | null
	readonly night: number | null
}

const DEFAULT_AREA_PROPS: Partial<AreaProps<keyof EphemerisChartData, number>> = { dot: false, connectNulls: true, activeDot: false, fillOpacity: 0.3, isAnimationActive: false, stroke: 'transparent', type: 'monotone' }

const EphemerisChart = memo(() => {
	const context = useContext(EphemerisPositionContext)
	const { chart } = useSnapshot(context.state)
	const { twilight } = useSnapshot(atlasStore.state)
	const deferredChart = useDeferredValue(chart, [])
	const data = useMemo(() => makeEphemerisChart(deferredChart, twilight), [deferredChart, twilight])
	const deferredData = useDeferredValue(data, [])

	return (
		<ComposedChart data={deferredData} height={200} margin={{ top: 0, right: 8, left: 0, bottom: 0 }} responsive className="max-h-[200px] min-h-[200px] flex-1">
			<XAxis dataKey="name" domain={[0, 1440]} fontSize={10} interval={59} tickFormatter={ChartTickFormatter} tickMargin={6} />
			<YAxis domain={[0, 90]} width={25} />
			<Area dataKey="dayFirst" fill="#FFF176" {...DEFAULT_AREA_PROPS} />
			<Area dataKey="civilDusk" fill="#7986CB" {...DEFAULT_AREA_PROPS} />
			<Area dataKey="nauticalDusk" fill="#3F51B5" {...DEFAULT_AREA_PROPS} />
			<Area dataKey="astronomicalDusk" fill="#303F9F" {...DEFAULT_AREA_PROPS} />
			<Area dataKey="night" fill="#1A237E" {...DEFAULT_AREA_PROPS} />
			<Area dataKey="astronomicalDawn" fill="#303F9F" {...DEFAULT_AREA_PROPS} />
			<Area dataKey="nauticalDawn" fill="#3F51B5" {...DEFAULT_AREA_PROPS} />
			<Area dataKey="civilDawn" fill="#7986CB" {...DEFAULT_AREA_PROPS} />
			<Area dataKey="dayLast" fill="#FFF176" {...DEFAULT_AREA_PROPS} />
			<CartesianGrid stroke="#FFFFFF10" strokeDasharray="3 3" />
			<ChartTooltip content={ChartTooltipContent} />
			<Line dataKey="value" dot={false} isAnimationActive={false} stroke="#F44336" strokeWidth={2} type="monotone" />
		</ComposedChart>
	)
})

function ChartTooltipContent({ active, payload }: TooltipContentProps) {
	if (!active || !payload?.length || payload[0].name !== 'value') return null

	const item = payload[0].payload as EphemerisChartData
	const time = (+item.name + 720) % 1440
	const hour = Math.trunc(time / 60)
	const minute = Math.trunc(time % 60)

	return (
		<div className="text-small shadow-small bg-default-100 rounded-small inline-flex flex-col px-1.5 py-0.5 font-normal">
			<span className="font-bold">
				{hour.toFixed(0).padStart(2, '0')}:{minute.toFixed(0).padStart(2, '0')}
			</span>
			<span className="text-foreground-600">{item.value?.toFixed(3)}°</span>
		</div>
	)
}

function ChartTickFormatter(value: unknown, i: number) {
	return ((i + 12) % 24).toFixed(0).padStart(2, '0')
}

function makeEphemerisChart(data: readonly number[], twilight: Twilight = EMPTY_TWILIGHT): EphemerisChartData[] {
	const chart = new Array<EphemerisChartData>(1441)

	// Combine data and twilight into a single array of objects
	for (let i = 0; i <= 1440; i++) {
		chart[i] = {
			name: i,
			value: data[i] >= 0 ? Math.max(0, data[i] * RAD2DEG) : null,
			dayFirst: i === 0 || i === twilight.dusk.civil[1] - 1 ? 90 : null,
			civilDusk: i === twilight.dusk.civil[1] || i === twilight.dusk.nautical[1] - 1 ? 90 : null,
			nauticalDusk: i === twilight.dusk.nautical[1] || i === twilight.dusk.astronomical[1] - 1 ? 90 : null,
			astronomicalDusk: i === twilight.dusk.astronomical[1] || i === twilight.night[1] - 1 ? 90 : null,
			night: i === twilight.night[1] || i === twilight.dawn.astronomical[1] - 1 ? 90 : null,
			astronomicalDawn: i === twilight.dawn.astronomical[1] || i === twilight.dawn.nautical[1] - 1 ? 90 : null,
			nauticalDawn: i === twilight.dawn.nautical[1] || i === twilight.dawn.civil[1] - 1 ? 90 : null,
			civilDawn: i === twilight.dawn.civil[1] || i === twilight.day[1] - 1 ? 90 : null,
			dayLast: i === twilight.day[1] || i === 1440 ? 90 : null,
		}
	}

	return chart
}
