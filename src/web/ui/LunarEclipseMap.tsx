import type { LocalLunarEclipseEvent, LocalLunarEclipseSvgShape } from 'nebulosa/src/astronomy/events/eclipse/lunar/local'
import type { LunarEclipseContactKind } from 'nebulosa/src/astronomy/events/eclipse/lunar/map'
import { formatTemporal, temporalFromTime } from 'nebulosa/src/astronomy/time/temporal'
import type { Point } from 'nebulosa/src/math/numerical/geometry'
import { formatAZ, toDeg } from 'nebulosa/src/math/units/angle'
import { Fragment, memo, type CSSProperties } from 'react'
import { useSnapshot } from 'valtio'
import { tw } from '../shared/util'
import { lunarEclipseStore } from '../stores/lunar.eclipse.store'
import { IconButton } from './components/IconButton'
import { Tab, TabPanel, Tabs } from './components/Tabs'
import { WorldMap, worldMapCoordinateToPoint } from './components/WorldMap'
import { Icons } from './Icon'
import { LocalViewOrientationModeButtonGroup } from './LocalViewOrientationModeButtonGroup'
import { LunarEclipseContactKindButtonGroup } from './LunarEclipseContactKindButtonGroup'
import { Modal } from './Modal'

export const LunarEclipseMap = memo(() => {
	const { show } = useSnapshot(lunarEclipseStore.state)

	if (!show) return null

	return (
		<Modal header={<Header />} id="lunar-eclipse-map" initialWidth="560px" onHide={lunarEclipseStore.hide}>
			<Body />
		</Modal>
	)
})

const Header = memo(() => {
	const { eclipse } = useSnapshot(lunarEclipseStore.state)

	return (
		<div className="grid w-full grid-cols-[2.5rem_1fr_2.5rem] items-center gap-2">
			<IconButton icon={Icons.ArrowLeft} onClick={lunarEclipseStore.prev} tooltipContent="Prev" />
			<span className="flex min-w-0 items-center justify-center gap-2 text-sm font-semibold text-neutral-100">
				<Icons.Moon className="text-warning" />
				<div className="flex flex-col items-center justify-center gap-0">
					<span className="truncate">Lunar Eclipse</span>
					{eclipse && <span className="truncate">{formatTemporal(temporalFromTime(eclipse.maximalTime), 'YYYY-MM-DD')}</span>}
				</div>
			</span>
			<IconButton icon={Icons.ArrowRight} onClick={lunarEclipseStore.next} tooltipContent="Next" />
		</div>
	)
})

const Body = memo(() => (
	<div className="flex w-full flex-col gap-3">
		<Info />
		<Map />
	</div>
))

const Info = memo(() => (
	<div className="flex w-full flex-col gap-2">
		<Tabs fullWidth>
			<Tab id="details">Details</Tab>
			<Tab id="contacts">Contacts</Tab>
			<Tab id="localCircumstances">Local Circumstances</Tab>
			<TabPanel id="details">
				<EclipseDetails />
			</TabPanel>
			<TabPanel id="contacts">
				<Contacts />
			</TabPanel>
			<TabPanel id="localCircumstances">
				<LocalCircumstances />
			</TabPanel>
		</Tabs>
	</div>
))

interface MetricCardProps {
	readonly label: React.ReactNode
	readonly value: React.ReactNode
	readonly className?: string
	readonly valueClassName?: string
}

function MetricCard({ className, label, value, valueClassName }: MetricCardProps) {
	return (
		<div className={tw('flex min-w-0 flex-col gap-0 rounded-lg bg-neutral-900/70 px-3 py-2', className)}>
			<span className="truncate text-xs font-bold text-neutral-500 uppercase">{label}</span>
			<span className={tw('min-w-0 truncate font-mono text-sm text-neutral-100', valueClassName)}>{value}</span>
		</div>
	)
}

const EclipseDetails = memo(() => {
	const { eclipse, map } = useSnapshot(lunarEclipseStore.state)

	if (map === undefined || eclipse === undefined) return null

	return (
		<div className="grid w-full grid-cols-2 gap-2 md:grid-cols-4">
			<MetricCard label="Type" value={eclipse.type} valueClassName="capitalize" />
			<MetricCard label="Lunation" value={eclipse.lunation.toFixed(0)} />
			<MetricCard label="Magnitude" value={eclipse.magnitude.toFixed(6)} />
			<MetricCard label="Gamma" value={eclipse.gamma.toFixed(6)} />
		</div>
	)
})

interface ContactPointProps {
	readonly name: string
	readonly point: Point
	readonly color: string
}

function ContactPoint({ point, name, color }: ContactPointProps) {
	return (
		<div className="flex min-w-0 flex-col gap-0 rounded-lg border border-neutral-800 bg-neutral-900/70 px-3 py-2 text-xs" style={{ borderLeftColor: color, borderLeftWidth: 3 }}>
			<div className="flex min-w-0 flex-row items-center justify-between gap-2">
				<span className="font-mono text-sm font-bold" style={{ color }}>
					{name}
				</span>
			</div>
			<div className="flex min-w-0 flex-row flex-wrap gap-x-3 gap-y-1 font-mono text-neutral-400">
				<span>
					<b className="text-neutral-500">LAT</b> {formatAZ(point.y, true)}
				</span>
				<span>
					<b className="text-neutral-500">LON</b> {formatAZ(point.x, true)}
				</span>
			</div>
		</div>
	)
}

const CONTACT_POINT_COLORS = {
	P1: '#FF9F1C',
	U1: '#FFE66D',
	U2: '#FFE66D',
	MAX: '#FFFFFF',
	U3: '#FFE66D',
	U4: '#FFE66D',
	P4: '#FF9F1C',
} as const

const Contacts = memo(() => {
	const { eclipse, map } = useSnapshot(lunarEclipseStore.state)

	if (map === undefined || eclipse === undefined) return null

	return (
		<div className="grid w-full grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
			{map.events.map((event) => {
				const point = event.sublunar
				return <ContactPoint color={CONTACT_POINT_COLORS[event.kind]} key={event.kind} point={point} name={event.kind} />
			})}
		</div>
	)
})

const LocalCircumstances = memo(() => (
	<div className="flex flex-col gap-2">
		<LocalHeader />
		<Tabs fullWidth>
			<Tab id="details">Details</Tab>
			<Tab id="instants">Instants</Tab>
			<Tab id="view">View</Tab>
			<TabPanel id="details">
				<LocalDetails />
			</TabPanel>
			<TabPanel id="instants">
				<LocalInstants />
			</TabPanel>
			<TabPanel id="view">
				<LocalView />
			</TabPanel>
		</Tabs>
	</div>
))

const LocalHeader = memo(() => {
	const { location, circumstances } = useSnapshot(lunarEclipseStore.state)
	const maximalMagnitude = circumstances?.details.maximalUmbralMagnitude ?? circumstances?.details.maximalPenumbralMagnitude

	return (
		<div className="flex min-w-0 flex-col gap-2 rounded-lg bg-neutral-900/70 px-3 py-2">
			<div className="flex min-w-0 flex-row flex-wrap gap-x-4 gap-y-1 font-mono text-sm text-neutral-400">
				<span>
					<b className="text-neutral-500">LAT</b> {formatAZ(location.latitude)}
				</span>
				<span>
					<b className="text-neutral-500">LON</b> {formatAZ(location.longitude)}
				</span>
			</div>
			<span className="flex min-w-0 flex-row flex-wrap items-center gap-x-2 gap-y-1 text-sm text-neutral-100">
				<span className="font-medium">{circumstances?.visibility.text ?? 'No local circumstances'}</span>
				{maximalMagnitude !== null && maximalMagnitude !== undefined && <span className="font-mono text-neutral-400">max {maximalMagnitude.toFixed(2)}</span>}
			</span>
		</div>
	)
})

function formatNullableNumber(value: number | null | undefined, fractionDigits: number) {
	return value === null || value === undefined || !Number.isFinite(value) ? '--' : value.toFixed(fractionDigits)
}

function formatDurationSeconds(value: number | null | undefined) {
	if (value === null || value === undefined || !Number.isFinite(value)) return '--'

	const seconds = Math.max(0, Math.round(value))
	const h = Math.floor(seconds / 3600)
	const m = Math.floor((seconds % 3600) / 60)
	const s = seconds % 60

	return `${padTime(h)}:${padTime(m)}:${padTime(s)}`
}

function padTime(value: number) {
	return value.toFixed(0).padStart(2, '0')
}

const LocalDetails = memo(() => {
	const { circumstances } = useSnapshot(lunarEclipseStore.state)

	if (circumstances === undefined) return null

	const { details } = circumstances

	return (
		<div className="grid w-full grid-cols-3 gap-2">
			<MetricCard label="Maximal penumbral magnitude" value={formatNullableNumber(details.maximalPenumbralMagnitude, 3)} />
			<MetricCard label="Maximal umbral magnitude" value={formatNullableNumber(details.maximalUmbralMagnitude, 3)} />
			<MetricCard label="Partial phase duration" value={formatDurationSeconds(details.partialPhaseDuration)} />
			<MetricCard label="Observable duration" value={formatDurationSeconds(details.observableDuration)} />
			<MetricCard label="Penumbral phase duration" value={formatDurationSeconds(details.penumbralPhaseDuration)} />
			<MetricCard label="Total phase duration" value={formatDurationSeconds(details.totalPhaseDuration)} />
		</div>
	)
})

function formatEventTime(event?: LocalLunarEclipseEvent | null) {
	return event === null || event === undefined ? '--' : formatTemporal(temporalFromTime(event.time), 'MM-DD HH:mm:ss')
}

function formatSignedDegrees(value?: number | null) {
	if (value === null || value === undefined) return '--'
	const degrees = toDeg(value)
	return `${degrees >= 0 ? '+' : ''}${degrees.toFixed(1)}°`
}

function formatDegrees(value?: number | null) {
	return value === null || value === undefined ? '--' : `${toDeg(value).toFixed(1)}°`
}

function eventLabel(kind: LunarEclipseContactKind) {
	switch (kind) {
		case 'P1':
			return 'P1: Penumbral begins'
		case 'U1':
			return 'U1: Partial begins'
		case 'U2':
			return 'U2: Total begins'
		case 'U3':
			return 'U3: Total ends'
		case 'U4':
			return 'U4: Partial ends'
		case 'P4':
			return 'P4: Penumbral ends'
		case 'MAX':
			return 'MAX: Greatest eclipse'
	}
}

const LOCAL_CONTACT_KINDS = ['P1', 'U1', 'U2', 'MAX', 'U3', 'U4', 'P4'] as const

const LocalInstants = memo(() => {
	const { circumstances } = useSnapshot(lunarEclipseStore.state)

	if (circumstances === undefined) return null

	return (
		<div className="overflow-x-auto rounded-lg bg-neutral-900/70 text-sm text-neutral-100">
			<div className="grid w-full grid-cols-[1.5fr_1fr_0.5fr_0.5fr_0.5fr]">
				<span className="bg-neutral-950/70 px-3 py-2 text-xs font-bold text-neutral-500 uppercase">Instant</span>
				<span className="bg-neutral-950/70 px-3 py-2 text-xs font-bold text-neutral-500 uppercase">Time</span>
				<span className="bg-neutral-950/70 px-3 py-2 text-xs font-bold text-neutral-500 uppercase">Alt</span>
				<span className="bg-neutral-950/70 px-3 py-2 text-xs font-bold text-neutral-500 uppercase">P</span>
				<span className="bg-neutral-950/70 px-3 py-2 text-xs font-bold text-neutral-500 uppercase">Z</span>
				{LOCAL_CONTACT_KINDS.map((kind) => {
					const event = circumstances.events[kind]
					const cellClassName = tw('min-h-10 border-t border-neutral-800 px-3 py-2 font-mono', event ? 'text-neutral-100' : 'text-neutral-500')

					return (
						<Fragment key={kind}>
							<span className={tw(cellClassName, 'whitespace-normal font-sans')}>{eventLabel(kind)}</span>
							<span className={cellClassName}>{formatEventTime(event)}</span>
							<span className={cellClassName}>{formatSignedDegrees(event?.altitude)}</span>
							<span className={cellClassName}>{formatDegrees(event?.positionAngle)}</span>
							<span className={cellClassName}>{formatDegrees(event?.zenithAngle)}</span>
						</Fragment>
					)
				})}
			</div>
		</div>
	)
})

const LOCAL_VIEW_SHAPE_STYLES: Record<LocalLunarEclipseSvgShape['role'], CSSProperties> = {
	penumbra: { fill: 'none', stroke: '#DDD', strokeWidth: 1, strokeDasharray: '4 4', opacity: 0.5 },
	umbra: { fill: 'none', stroke: '#EEE', strokeWidth: 1, strokeDasharray: '4 4', opacity: 0.4 },
	moonDisk: { fill: '#FFF', stroke: 'none' },
	ghostMoonDisk: { fill: 'none', stroke: '#EEE', strokeWidth: 1, opacity: 0.35 },
	horizonLine: { fill: 'none', stroke: 'none', strokeWidth: 1 },
	horizonBand: { fill: '#134E4A', stroke: 'none', opacity: 0.8 },
	trajectoryPath: { stroke: 'yellow', strokeWidth: 1, strokeDasharray: '4 4' },
}

interface LocalViewShapeProps {
	readonly shape: LocalLunarEclipseSvgShape
}

function LocalViewShape({ shape }: LocalViewShapeProps) {
	if (shape.role === 'trajectoryPath') return null

	if (shape.kind === 'circle') {
		return <circle cx={shape.cx} cy={shape.cy} r={shape.r} role={shape.role} style={LOCAL_VIEW_SHAPE_STYLES[shape.role]} />
	} else if (shape.kind === 'line') {
		return <line x1={shape.x1} y1={shape.y1} x2={shape.x2} y2={shape.y2} role={shape.role} style={LOCAL_VIEW_SHAPE_STYLES[shape.role]} />
	} else if (shape.kind === 'polygon') {
		const points = shape.points.map((p) => `${p.x},${p.y}`).join(' ')
		return <polygon points={points} role={shape.role} style={LOCAL_VIEW_SHAPE_STYLES[shape.role]} />
	}

	return null
}

function localViewShapeKey(shape: LocalLunarEclipseSvgShape, index: number) {
	return `${shape.kind}-${shape.role}-${'event' in shape ? (shape.event ?? '') : ''}-${index}`
}

const LocalView = memo(() => {
	const { localView } = useSnapshot(lunarEclipseStore.state)
	const { orientationMode, selectedEvent } = useSnapshot(lunarEclipseStore.state.localViewOptions)

	if (!localView) return null
	if (localView.shapes.length === 0) {
		return <div className="rounded-lg bg-neutral-900/70 px-3 py-6 text-center text-sm text-neutral-500">Eclipse is invisible</div>
	}

	return (
		<div className="flex flex-col gap-2">
			<div className="flex flex-row flex-wrap items-center justify-between gap-2">
				<LunarEclipseContactKindButtonGroup value={selectedEvent} onValueChange={(value) => lunarEclipseStore.updateLocalViewOptions('selectedEvent', value)} />
				<LocalViewOrientationModeButtonGroup value={orientationMode} onValueChange={(value) => lunarEclipseStore.updateLocalViewOptions('orientationMode', value)} />
			</div>
			<div className="overflow-hidden rounded-lg bg-neutral-950">
				<svg width="100%" height="100%" className="aspect-2/ block bg-[#05054f]" viewBox={`0 0 ${localView.width} ${localView.height}`}>
					{localView.shapes.map((shape, index) => (
						<LocalViewShape key={localViewShapeKey(shape, index)} shape={shape} />
					))}
				</svg>
			</div>
		</div>
	)
})

const Map = memo(() => (
	<WorldMap defaultScale={1} onCoordinateClick={lunarEclipseStore.handleCoordinateChange} onTransformChange={lunarEclipseStore.handleTransformChange}>
		<MapMarker />
		<MapGeometry />
	</WorldMap>
))

const MAP_MARKER_STYLE: CSSProperties = { fill: 'var(--danger)' }

const MapMarker = memo(() => {
	const { location, scale } = useSnapshot(lunarEclipseStore.state)
	const point = worldMapCoordinateToPoint({ latitude: toDeg(location.latitude), longitude: toDeg(location.longitude) })
	const size = 132 / scale

	return <Icons.MapMarker width={size} height={size} style={{ ...MAP_MARKER_STYLE, transform: `translate(${point.x - size * 0.5}px, ${point.y - size}px)` }} />
})

const PENUMBRA_STYLE: CSSProperties = { fill: '#000', stroke: 'none', strokeLinecap: 'round', opacity: 0.2 }
const UMBRA_STYLE: CSSProperties = { fill: '#000', stroke: 'none', strokeLinecap: 'round', opacity: 0.2 }
const TOTAL_STYLE: CSSProperties = { fill: '#000', stroke: 'none', strokeLinecap: 'round', opacity: 0.2 }
const MAX_STYLE: CSSProperties = { fill: '#000', stroke: 'none', strokeLinecap: 'round', opacity: 0.2 }
const POINT_LABEL_STYLE: CSSProperties = { font: '12px sans-serif', fontWeight: 'bold', fill: '#fff' }

const MapGeometry = memo(() => {
	const { map } = useSnapshot(lunarEclipseStore.state)

	if (map === undefined) return null

	const { P1, U1, U2, MAX, U3, U4, P4 } = map.paths.moonRiseSet

	return (
		<g>
			<path style={PENUMBRA_STYLE} d={P1} />
			<path style={UMBRA_STYLE} d={U1} />
			<path style={TOTAL_STYLE} d={U2} />
			<path style={MAX_STYLE} d={MAX} />
			<path style={TOTAL_STYLE} d={U3} />
			<path style={UMBRA_STYLE} d={U4} />
			<path style={PENUMBRA_STYLE} d={P4} />
			{map.events.map((event) => {
				const point = map.paths.sublunarPoints[event.kind]
				return point && <MapPoint key={event.kind} name={event.kind} x={point.x} y={point.y} color={CONTACT_POINT_COLORS[event.kind]} />
			})}
		</g>
	)
})

interface MapPointProps {
	readonly name: string
	readonly x: number
	readonly y: number
	readonly color: string
}

const MapPoint = memo(({ name, x, y, color }: MapPointProps) => (
	<g>
		<circle cx={x} cy={y} r="4" fill={color} stroke="none" />
		<text x={x + 10} y={y - 6} children={name} style={POINT_LABEL_STYLE} />
	</g>
))
