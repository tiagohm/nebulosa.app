import type { LocalCentralPhaseKind, LocalEclipseContactKind, LocalSolarEclipseEvent, LocalSolarEclipseSvgShape } from 'nebulosa/src/astronomy/events/eclipse/solar/local'
import type { SolarEclipseGeoPoint } from 'nebulosa/src/astronomy/events/eclipse/solar/map'
import { formatTemporal, temporalFromTime } from 'nebulosa/src/astronomy/time/temporal'
import { time } from 'nebulosa/src/astronomy/time/time'
import { formatAZ, toDeg } from 'nebulosa/src/math/units/angle'
import { Fragment, memo, type CSSProperties } from 'react'
import { useSnapshot } from 'valtio'
import { astronomicEventTemporal } from '../shared/time'
import { tw } from '../shared/util'
import { atlasStore } from '../stores/atlas.store'
import { solarEclipseStore } from '../stores/solar.eclipse.store'
import { IconButton } from './components/IconButton'
import { Tab, TabPanel, Tabs } from './components/Tabs'
import { WorldMap, worldMapCoordinateToPoint } from './components/WorldMap'
import { Icons } from './Icon'
import { LocalEclipseContactKindButtonGroup } from './LocalEclipseContactKindButtonGroup'
import { LocalViewOrientationModeButtonGroup } from './LocalViewOrientationModeButtonGroup'
import { Modal } from './Modal'

export const SolarEclipseMap = memo(() => {
	const { show } = useSnapshot(solarEclipseStore.state)

	if (!show) return null

	return (
		<Modal header={<Header />} id="solar-eclipse-map" initialWidth="560px" onHide={solarEclipseStore.hide}>
			<Body />
		</Modal>
	)
})

const Header = memo(() => {
	const { eclipse } = useSnapshot(solarEclipseStore.state)

	return (
		<div className="grid w-full grid-cols-[2.5rem_1fr_2.5rem] items-center gap-2">
			<IconButton icon={Icons.ArrowLeft} onClick={solarEclipseStore.prev} tooltipContent="Prev" />
			<span className="flex min-w-0 items-center justify-center gap-2 text-sm font-semibold text-neutral-100">
				<Icons.Sun className="text-warning" />
				<div className="flex flex-col items-center justify-center gap-0">
					<span className="truncate">Solar Eclipse</span>
					{eclipse && <span className="truncate">{formatTemporal(temporalFromTime(eclipse.maximalTime), 'YYYY-MM-DD')}</span>}
				</div>
			</span>
			<IconButton icon={Icons.ArrowRight} onClick={solarEclipseStore.next} tooltipContent="Next" />
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
			<Tab id="besselianElements">Besselian Elements</Tab>
			<Tab id="localCircumstances">Local Circumstances</Tab>
			<TabPanel id="details">
				<EclipseDetails />
			</TabPanel>
			<TabPanel id="contacts">
				<Contacts />
			</TabPanel>
			<TabPanel id="besselianElements">
				<BesselianElements />
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
	const { eclipse, map } = useSnapshot(solarEclipseStore.state)

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
	readonly point: SolarEclipseGeoPoint
	readonly offset: number
	readonly color: string
}

function ContactPoint({ point, name, offset, color }: ContactPointProps) {
	return (
		<div className="flex min-w-0 flex-col gap-0 rounded-lg border border-neutral-800 bg-neutral-900/70 px-3 py-2 text-xs" style={{ borderLeftColor: color, borderLeftWidth: 3 }}>
			<div className="flex min-w-0 flex-row items-center justify-between gap-2">
				<span className="font-mono text-sm font-bold" style={{ color }}>
					{name}
				</span>
				<span className="truncate font-mono text-neutral-300">{formatTemporal(temporalFromTime(time(point.jd!, 0, 3)), 'YYYY-MM-DD HH:mm', offset)}</span>
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

const CONTACT_POINT_ITEMS = [
	['P1', '#FF9F1C'],
	['U1', '#FFE66D'],
	['C1', '#FF7BEA'],
	['U2', '#FFE66D'],
	['Max', '#FFFFFF'],
	['U3', '#FFE66D'],
	['C2', '#FF7BEA'],
	['U4', '#FFE66D'],
	['P3', '#FF9F1C'],
	['P2', '#FF9F1C'],
	['P4', '#FF9F1C'],
] as const

const Contacts = memo(() => {
	const { eclipse, map } = useSnapshot(solarEclipseStore.state)
	const { offset } = useSnapshot(atlasStore.state.request.time)

	if (map === undefined || eclipse === undefined) return null

	return (
		<div className="grid w-full grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
			{CONTACT_POINT_ITEMS.map(([name, color]) => {
				const point = map.points[name]
				return point && <ContactPoint color={color} key={name} point={point} name={name === 'Max' ? 'MAX' : name} offset={offset} />
			})}
		</div>
	)
})

const N = [0, 1, 2, 3] as const

const BesselianElements = memo(() => {
	const { map } = useSnapshot(solarEclipseStore.state)

	if (map === undefined) return null

	return (
		<div className="overflow-x-auto rounded-lg bg-neutral-900/70 text-sm text-neutral-100">
			<div className="flex flex-row flex-wrap items-center justify-between gap-2 border-b border-neutral-800 px-3 py-2">
				<span className="font-mono text-xs text-neutral-400">t0 = {formatTemporal(astronomicEventTemporal(map.elements.time0), 'YYYY-MM-DD HH:mm', 0)} TT</span>
				<span className="flex flex-row gap-3 font-mono text-xs text-neutral-500">
					<span>tan F1 {map.elements.tanF1.toFixed(7)}</span>
					<span>tan F2 {map.elements.tanF2.toFixed(7)}</span>
				</span>
			</div>
			<div className="grid w-full grid-cols-[2.5rem_repeat(6,minmax(5.5rem,1fr))] font-mono">
				<span className="bg-neutral-950/70 px-3 py-2 text-xs font-bold text-neutral-500 uppercase">n</span>
				<span className="bg-neutral-950/70 px-3 py-2 text-end text-xs font-bold text-neutral-500 uppercase">x</span>
				<span className="bg-neutral-950/70 px-3 py-2 text-end text-xs font-bold text-neutral-500 uppercase">y</span>
				<span className="bg-neutral-950/70 px-3 py-2 text-end text-xs font-bold text-neutral-500 uppercase">D</span>
				<span className="bg-neutral-950/70 px-3 py-2 text-end text-xs font-bold text-neutral-500 uppercase">L1</span>
				<span className="bg-neutral-950/70 px-3 py-2 text-end text-xs font-bold text-neutral-500 uppercase">L2</span>
				<span className="bg-neutral-950/70 px-3 py-2 text-end text-xs font-bold text-neutral-500 uppercase">u</span>
				{N.map((n) => (
					<Fragment key={n}>
						<span className="border-t border-neutral-800 px-3 py-2 text-neutral-500">{n}</span>
						<span className="border-t border-neutral-800 px-3 py-2 text-end">{map.elements.x[n].toFixed(7)}</span>
						<span className="border-t border-neutral-800 px-3 py-2 text-end">{map.elements.y[n].toFixed(7)}</span>
						<span className="border-t border-neutral-800 px-3 py-2 text-end">{map.elements.d[n].toFixed(7)}</span>
						<span className="border-t border-neutral-800 px-3 py-2 text-end">{map.elements.l1[n].toFixed(7)}</span>
						<span className="border-t border-neutral-800 px-3 py-2 text-end">{map.elements.l2[n].toFixed(7)}</span>
						<span className="border-t border-neutral-800 px-3 py-2 text-end">{map.elements.mu[n].toFixed(7)}</span>
					</Fragment>
				))}
			</div>
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
	const { location, circumstances } = useSnapshot(solarEclipseStore.state)
	const sunMotion = circumstances?.visibility.sunMotion
	const motionLabel = sunMotion === 'rising' ? 'on sunrise' : sunMotion === 'setting' ? 'on sunset' : ''

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
				{motionLabel && <span className="text-neutral-400">{motionLabel}</span>}
				{circumstances?.details.maximalMagnitude !== null && circumstances?.details.maximalMagnitude !== undefined && <span className="font-mono text-neutral-400">max {circumstances.details.maximalMagnitude.toFixed(2)}</span>}
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

function centralPhaseLabel(kind: LocalCentralPhaseKind) {
	if (kind === 'total') return 'Total'
	if (kind === 'annular') return 'Annular'
	return 'Central'
}

const LocalDetails = memo(() => {
	const { circumstances } = useSnapshot(solarEclipseStore.state)

	if (circumstances === undefined) return null

	const { details, visibility } = circumstances
	const centralPhase = centralPhaseLabel(visibility.centralPhaseKind)

	return (
		<div className="grid w-full grid-cols-3 gap-2">
			<MetricCard label="Maximal magnitude" value={formatNullableNumber(details.maximalMagnitude, 3)} />
			<MetricCard label="Moon/Sun diameter ratio" value={formatNullableNumber(details.moonSunDiameterRatio, 4)} />
			<MetricCard label="Partial phase duration" value={formatDurationSeconds(details.partialPhaseDuration)} />
			<MetricCard label={`${centralPhase} phase duration`} value={formatDurationSeconds(details.centralPhaseDuration)} />
			<MetricCard label="Shadow path width" value={details.shadowPathWidthKm === null ? '--' : `${details.shadowPathWidthKm.toFixed(0)} km`} />
		</div>
	)
})

const LOCAL_CONTACT_KINDS = ['C1', 'C2', 'MAX', 'C3', 'C4'] as const

function describeLocalEvent(kind: LocalEclipseContactKind, centralKind: LocalCentralPhaseKind) {
	switch (kind) {
		case 'C1':
			return 'Beginning of partial phase'
		case 'C2':
			return `Beginning of ${centralKind === 'annular' ? 'annular' : centralKind === 'total' ? 'total' : 'central'} phase`
		case 'MAX':
			return 'Local maximum'
		case 'C3':
			return `End of ${centralKind === 'annular' ? 'annular' : centralKind === 'total' ? 'total' : 'central'} phase`
		case 'C4':
			return 'End of partial phase'
	}
}

function eventLabel(kind: LocalEclipseContactKind, event: LocalSolarEclipseEvent | null, centralKind: LocalCentralPhaseKind) {
	return `${event?.kind ?? kind}: ${event?.description ?? describeLocalEvent(kind, centralKind)}`
}

function formatEventTime(event: LocalSolarEclipseEvent | null) {
	return event === null ? '--' : formatTemporal(temporalFromTime(event.time), 'HH:mm:ss')
}

function formatSignedDegrees(value: number) {
	const degrees = toDeg(value)
	return `${degrees >= 0 ? '+' : ''}${degrees.toFixed(1)}°`
}

function formatDegrees(value: number | null) {
	return value === null ? '--' : `${toDeg(value).toFixed(1)}°`
}

const LocalInstants = memo(() => {
	const { circumstances } = useSnapshot(solarEclipseStore.state)

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
					const cellClassName = tw('min-h-10 border-t border-neutral-800 px-3 py-2 font-mono', event === null ? 'text-neutral-500' : event.observable ? 'text-neutral-100' : 'text-neutral-400')

					return (
						<Fragment key={kind}>
							<span className={tw(cellClassName, 'whitespace-normal font-sans')}>{eventLabel(kind, event, circumstances.visibility.centralPhaseKind)}</span>
							<span className={cellClassName}>{formatEventTime(event)}</span>
							<span className={cellClassName}>{event === null ? '--' : formatSignedDegrees(event.sunAltitude)}</span>
							<span className={cellClassName}>{event === null ? '--' : formatDegrees(event.positionAngleP)}</span>
							<span className={cellClassName}>{event === null ? '--' : formatDegrees(event.zenithAngleZ)}</span>
						</Fragment>
					)
				})}
			</div>
		</div>
	)
})

// const LOCAL_VIEW_SHAPE_TEXT_STYLE: CSSProperties = { textAnchor: 'middle', dominantBaseline: 'middle', fill: 'gray' }

const LOCAL_VIEW_SHAPE_STYLES: Record<LocalSolarEclipseSvgShape['role'], CSSProperties> = {
	sunDisk: { fill: '#FFD166', stroke: 'none' },
	moonDisk: { fill: '#3645E1', stroke: 'none', strokeWidth: 1 },
	ghostSunDisk: { fill: 'none', stroke: '#FFD166', strokeWidth: 1, opacity: 0.35 },
	ghostMoonDisk: { fill: 'none', stroke: '#93C5FD', strokeWidth: 1, opacity: 0.35 },
	solarLimb: { fill: 'none', stroke: '#FFD166', strokeWidth: 1 },
	lunarLimb: { fill: 'none', stroke: '#93C5FD', strokeWidth: 1 },
	horizonLine: { fill: 'none', stroke: 'none', strokeWidth: 1 },
	trajectoryLine: { fill: 'none', stroke: '#F472B6', strokeWidth: 1, strokeDasharray: '5 5' },
	trajectoryPath: { fill: 'none', stroke: '#F472B6', strokeWidth: 1 },
	horizonBand: { fill: '#134E4A', stroke: 'none', opacity: 0.8 },
}

interface LocalViewShapeProps {
	readonly shape: LocalSolarEclipseSvgShape
}

function LocalViewShape({ shape }: LocalViewShapeProps) {
	if (shape.kind === 'circle') {
		return <circle cx={shape.cx} cy={shape.cy} r={shape.r} role={shape.role} style={LOCAL_VIEW_SHAPE_STYLES[shape.role]} />
	} else if (shape.kind === 'line') {
		return <line x1={shape.x1} y1={shape.y1} x2={shape.x2} y2={shape.y2} role={shape.role} style={LOCAL_VIEW_SHAPE_STYLES[shape.role]} />
	} else if (shape.kind === 'path') {
		return <path d={shape.d} role={shape.role} style={LOCAL_VIEW_SHAPE_STYLES[shape.role]} />
	} else if (shape.kind === 'polygon') {
		const points = shape.points.map((p) => `${p.x},${p.y}`).join(' ')
		return <polygon points={points} role={shape.role} style={LOCAL_VIEW_SHAPE_STYLES[shape.role]} />
	}

	return null
}

function localViewShapeKey(shape: LocalSolarEclipseSvgShape, index: number) {
	return `${shape.kind}-${shape.role}-${'event' in shape ? (shape.event ?? '') : ''}-${index}`
}

const LocalView = memo(() => {
	const { localView } = useSnapshot(solarEclipseStore.state)
	const { orientationMode, selectedEvent } = useSnapshot(solarEclipseStore.state.localViewOptions)

	if (!localView) return null
	if (localView.shapes.length === 0) {
		return <div className="rounded-lg bg-neutral-900/70 px-3 py-6 text-center text-sm text-neutral-500">Eclipse is invisible</div>
	}

	return (
		<div className="flex flex-col gap-2">
			<div className="flex flex-row flex-wrap items-center justify-between gap-2">
				<LocalEclipseContactKindButtonGroup value={selectedEvent} onValueChange={(value) => solarEclipseStore.updateLocalViewOptions('selectedEvent', value)} />
				<LocalViewOrientationModeButtonGroup value={orientationMode} onValueChange={(value) => solarEclipseStore.updateLocalViewOptions('orientationMode', value)} />
			</div>
			<div className="overflow-hidden rounded-lg bg-neutral-950">
				<svg width="100%" height="100%" className="aspect-2/ block bg-(--primary)" viewBox={`0 0 ${localView.width} ${localView.height}`}>
					{localView.shapes.map((shape, index) => (
						<LocalViewShape key={localViewShapeKey(shape, index)} shape={shape} />
					))}
				</svg>
			</div>
		</div>
	)
})

const Map = memo(() => (
	<WorldMap defaultScale={1} onCoordinateClick={solarEclipseStore.handleCoordinateChange} onTransformChange={solarEclipseStore.handleTransformChange}>
		<MapMarker />
		<MapGeometry />
	</WorldMap>
))

const MAP_MARKER_STYLE: CSSProperties = { fill: 'var(--danger)' }

const MapMarker = memo(() => {
	const { location, scale } = useSnapshot(solarEclipseStore.state)
	const point = worldMapCoordinateToPoint({ latitude: toDeg(location.latitude), longitude: toDeg(location.longitude) })
	const size = 132 / scale

	return <Icons.MapMarker width={size} height={size} style={{ ...MAP_MARKER_STYLE, transform: `translate(${point.x - size * 0.5}px, ${point.y - size}px)` }} />
})

const UMBRA_STYLE: CSSProperties = { fill: 'none', stroke: '#FFE66D', strokeWidth: 2, strokeLinecap: 'round' }
const PENUMBRA_STYLE: CSSProperties = { fill: 'none', stroke: '#FF9F1C', strokeWidth: 2, strokeLinecap: 'round' }
const CENTER_LINE_STYLE: CSSProperties = { fill: 'none', stroke: '#FF2ED1', strokeWidth: 2, strokeLinecap: 'round' }
const RISESET_LINE_STYLE: CSSProperties = { fill: 'none', stroke: '#00E5FF', strokeWidth: 2, strokeLinecap: 'round' }
const POINT_LABEL_STYLE: CSSProperties = { font: '12px sans-serif', fontWeight: 'bold', fill: '#fff' }

const MAP_POINT_ITEMS = [...CONTACT_POINT_ITEMS, ['N1', '#35FF7A'], ['N2', '#35FF7A'], ['S1', '#FF4D4D'], ['S2', '#FF4D4D']] as const

const MapGeometry = memo(() => {
	const { map } = useSnapshot(solarEclipseStore.state)

	if (map === undefined) return null

	const { penumbraNorth, penumbraSouth, umbraNorth, umbraSouth, riseSetCurves, centerLine, points } = map.paths

	return (
		<g>
			<path style={PENUMBRA_STYLE} d={penumbraNorth} />
			<path style={PENUMBRA_STYLE} d={penumbraSouth} />
			<path style={UMBRA_STYLE} d={umbraNorth} />
			<path style={UMBRA_STYLE} d={umbraSouth} />
			<path style={RISESET_LINE_STYLE} className="riseset" d={riseSetCurves} />
			<path style={CENTER_LINE_STYLE} d={centerLine} />
			{MAP_POINT_ITEMS.map(([name, color]) => {
				const point = points[name]
				return point && <MapPoint key={name} name={name} x={point.x} y={point.y} color={color} />
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
