import { formatAZ, toDeg } from 'nebulosa/src/angle'
import type { Point } from 'nebulosa/src/geometry'
import type { LocalSolarEclipseSvgShape } from 'nebulosa/src/sun.eclipse.local'
import { formatTemporal } from 'nebulosa/src/temporal'
import { memo, type CSSProperties } from 'react'
import { useSnapshot } from 'valtio'
import { atlasStore } from '../stores/atlas.store'
import { solarEclipseStore } from '../stores/solar.eclipse.store'
import { Tab, TabPanel, Tabs } from './components/Tabs'
import { TextInput } from './components/TextInput'
import { WorldMap, worldMapCoordinateToPoint } from './components/WorldMap'
import { Icons } from './Icon'
import { LocalEclipseContactKindButtonGroup } from './LocalEclipseContactKindButtonGroup'
import { LocalViewOrientationModeButtonGroup } from './LocalViewOrientationModeButtonGroup'
import { Modal } from './Modal'

export const SolarEclipseMap = memo(() => {
	const { show } = useSnapshot(solarEclipseStore.state)

	if (!show) return null

	return (
		<Modal header="Solar Eclipse Map" id="solar-eclipse-map" maxWidth="480px" onHide={solarEclipseStore.hide}>
			<Body />
		</Modal>
	)
})

const Body = memo(() => (
	<div className="flex w-full flex-col gap-2">
		<Info />
		<Map />
	</div>
))

const Info = memo(() => (
	<div className="flex w-full flex-col gap-2">
		<Tabs>
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

const EclipseDetails = memo(() => {
	const { eclipse, map } = useSnapshot(solarEclipseStore.state)

	if (map === undefined || eclipse === undefined) return null

	return (
		<div className="grid w-full grid-cols-4 gap-2">
			<TextInput className="col-span-1" readOnly value={eclipse.type} label="Type" />
			<TextInput className="col-span-1" readOnly value={eclipse.lunation.toFixed(0)} label="Lunation" />
			<TextInput className="col-span-1" readOnly value={eclipse.magnitude.toFixed(6)} label="Magnitude" />
			<TextInput className="col-span-1" readOnly value={eclipse.gamma.toFixed(6)} label="Gamma" />
		</div>
	)
})

interface ContactPointProps {
	readonly name: string
	readonly point: Point & { time: number }
	readonly offset: number
}

function ContactPoint({ point, name, offset }: ContactPointProps) {
	return (
		<div className="col-span-2 flex w-full flex-col items-center justify-center gap-0 rounded-md bg-neutral-800/40 px-2 py-1 text-xs">
			<div className="flex w-full flex-row items-center justify-between">
				<b>{name}</b>
				<span className="flex flex-row items-center gap-1">
					<b>LAT:</b> {formatAZ(point.y, true)}
					<b>LON:</b> {formatAZ(point.x, true)}
				</span>
			</div>
			<span className="w-full">{formatTemporal(point?.time, 'YYYY-MM-DD HH:mm', offset)}</span>
		</div>
	)
}

const Contacts = memo(() => {
	const { eclipse, map } = useSnapshot(solarEclipseStore.state)
	const { offset } = useSnapshot(atlasStore.state.request.time)

	if (map === undefined || eclipse === undefined) return null

	return (
		<div className="grid w-full grid-cols-4 gap-2">
			{map.points.P1 && <ContactPoint point={map.points.P1} name="P1" offset={offset} />}
			{map.points.U1 && <ContactPoint point={map.points.U1} name="U1" offset={offset} />}
			{map.points.C1 && <ContactPoint point={map.points.C1} name="C1" offset={offset} />}
			{map.points.U2 && <ContactPoint point={map.points.U2} name="U2" offset={offset} />}
			{map.points.Max && <ContactPoint point={map.points.Max} name="MAX" offset={offset} />}
			{map.points.U3 && <ContactPoint point={map.points.U3} name="U3" offset={offset} />}
			{map.points.C2 && <ContactPoint point={map.points.C2} name="C2" offset={offset} />}
			{map.points.U4 && <ContactPoint point={map.points.U4} name="U4" offset={offset} />}
			{map.points.P3 && <ContactPoint point={map.points.P3} name="P3" offset={offset} />}
			{map.points.P2 && <ContactPoint point={map.points.P2} name="P2" offset={offset} />}
			{map.points.P4 && <ContactPoint point={map.points.P4} name="P4" offset={offset} />}
		</div>
	)
})

const N = [0, 1, 2, 3] as const

const BesselianElements = memo(() => {
	const { map } = useSnapshot(solarEclipseStore.state)

	if (map === undefined) return null

	return (
		<div className="grid w-full grid-cols-13 items-center gap-2 font-mono text-sm">
			<span className="col-span-full">Elements for t0 = {formatTemporal(map.elements.time0, 'YYYY-MM-DD HH:mm', 0)} TT</span>
			<span>n</span>
			<span className="col-span-2 text-end">x</span>
			<span className="col-span-2 text-end">y</span>
			<span className="col-span-2 text-end">D</span>
			<span className="col-span-2 text-end">L1</span>
			<span className="col-span-2 text-end">L2</span>
			<span className="col-span-2 text-end">u</span>
			{N.map((n) => (
				<>
					<span>{n}</span>
					<span className="col-span-2 text-end">{map.elements.x[n].toFixed(7)}</span>
					<span className="col-span-2 text-end">{map.elements.y[n].toFixed(7)}</span>
					<span className="col-span-2 text-end">{map.elements.d[n].toFixed(7)}</span>
					<span className="col-span-2 text-end">{map.elements.l1[n].toFixed(7)}</span>
					<span className="col-span-2 text-end">{map.elements.l2[n].toFixed(7)}</span>
					<span className="col-span-2 text-end">{map.elements.mu[n].toFixed(7)}</span>
				</>
			))}
			<span className="col-span-full flex flex-row justify-center gap-3">
				<span>tan F1: {map.elements.tanF1.toFixed(7)}</span>
				<span>tan F2: {map.elements.tanF2.toFixed(7)}</span>
			</span>
		</div>
	)
})

const LocalCircumstances = memo(() => (
	<div className="flex flex-col gap-2">
		<LocalHeader />
		<Tabs>
			<Tab id="details">Details</Tab>
			<Tab id="instants">Instants</Tab>
			<Tab id="view">View</Tab>
			<TabPanel id="view">
				<LocalView />
			</TabPanel>
		</Tabs>
	</div>
))

const LocalHeader = memo(() => {
	const { location, circumstances } = useSnapshot(solarEclipseStore.state)

	return (
		<div className="flex flex-col gap-0 font-mono">
			<span>
				LAT: {formatAZ(location.latitude)} LON: {formatAZ(location.longitude)}
			</span>
			<span className="flex flex-row items-center gap-1">
				<span>{circumstances?.visibility.text}</span>
				<span>{circumstances?.visibility.sunMotion === 'rising' ? 'on sunrise' : circumstances?.visibility.sunMotion === 'setting' ? 'on sunset' : ''}</span>
				{circumstances?.details.maximalMagnitude && <span>, max phase: {circumstances.details.maximalMagnitude.toFixed(2) || ''}</span>}
			</span>
		</div>
	)
})

const LocalDetails = memo(() => {})

const LocalInstants = memo(() => {})

// const LOCAL_VIEW_SHAPE_TEXT_STYLE: CSSProperties = { textAnchor: 'middle', dominantBaseline: 'middle', fill: 'gray' }

const LOCAL_VIEW_SHAPE_STYLES: Record<LocalSolarEclipseSvgShape['role'], CSSProperties> = {
	sunDisk: { fill: 'yellow', stroke: 'none' },
	moonDisk: { fill: 'blue', stroke: 'none' },
	ghostSunDisk: {},
	ghostMoonDisk: { fill: 'none', stroke: 'gray', opacity: 0.3 },
	solarLimb: {},
	lunarLimb: {},
	horizonLine: {},
	trajectoryLine: {},
	trajectoryPath: {},
	horizonBand: { fill: 'green', stroke: 'none', opacity: 0.8 },
}

function ShapeItem(shape: LocalSolarEclipseSvgShape) {
	if (shape.kind === 'circle') {
		return (
			<>
				<circle cx={shape.cx} cy={shape.cy} r={shape.r} role={shape.role} style={LOCAL_VIEW_SHAPE_STYLES[shape.role]} />
			</>
		)
	} else if (shape.kind === 'polygon') {
		const points = shape.points.map((p) => `${p.x},${p.y}`).join(' ')
		return <polygon points={points} role={shape.role} style={LOCAL_VIEW_SHAPE_STYLES.horizonBand} />
	}

	return null
}

const LocalView = memo(() => {
	const { localView } = useSnapshot(solarEclipseStore.state)
	const { orientationMode, selectedEvent } = useSnapshot(solarEclipseStore.state.localViewOptions)

	if (!localView) return null
	if (localView.shapes.length === 0) return 'Eclipse is invisible'

	return (
		<div className="flex flex-col gap-2">
			<div className="flex flex-row items-center justify-between">
				<LocalEclipseContactKindButtonGroup value={selectedEvent} onValueChange={(value) => solarEclipseStore.updateLocalViewOptions('selectedEvent', value)} />
				<LocalViewOrientationModeButtonGroup value={orientationMode} onValueChange={(value) => solarEclipseStore.updateLocalViewOptions('orientationMode', value)} />
			</div>
			<svg width="100%" height="100%" className="bg-(--primary)" viewBox={`0 0 ${localView.width} ${localView.height}`}>
				{localView.shapes.map(ShapeItem)}
			</svg>
		</div>
	)
})

const Map = memo(() => (
	<WorldMap ref={solarEclipseStore.setWorldMap} defaultScale={1} onCoordinateClick={solarEclipseStore.handleCoordinateChange} onTransformChange={solarEclipseStore.handleTransformChange}>
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
const TEXT_STYLE: CSSProperties = { font: '14px sans-serif', fontWeight: 'bold', fill: '#fff' }

const MapGeometry = memo(() => {
	const { map } = useSnapshot(solarEclipseStore.state)

	if (map === undefined) return null

	const { penumbraNorth, penumbraSouth, umbraNorth, umbraSouth, riseSetCurves, centerLine, points } = map.paths
	const { C1, C2, P1, P2, P3, P4, U1, U2, U3, U4, N1, N2, S1, S2, Max } = points

	return (
		<g>
			<path style={PENUMBRA_STYLE} d={penumbraNorth} />
			<path style={PENUMBRA_STYLE} d={penumbraSouth} />
			<path style={UMBRA_STYLE} d={umbraNorth} />
			<path style={UMBRA_STYLE} d={umbraSouth} />
			<path style={RISESET_LINE_STYLE} className="riseset" d={riseSetCurves} />
			<path style={CENTER_LINE_STYLE} d={centerLine} />
			{P1 && <MapPoint name="P1" x={P1.x} y={P1.y} color="#FF9F1C" />}
			{P2 && <MapPoint name="P2" x={P2.x} y={P2.y} color="#FF9F1C" />}
			{P3 && <MapPoint name="P3" x={P3.x} y={P3.y} color="#FF9F1C" />}
			{P4 && <MapPoint name="P4" x={P4.x} y={P4.y} color="#FF9F1C" />}
			{U1 && <MapPoint name="U1" x={U1.x} y={U1.y} color="#FFE66D" />}
			{U2 && <MapPoint name="U2" x={U2.x} y={U2.y} color="#FFE66D" />}
			{U3 && <MapPoint name="U3" x={U3.x} y={U3.y} color="#FFE66D" />}
			{U4 && <MapPoint name="U4" x={U4.x} y={U4.y} color="#FFE66D" />}
			{C1 && <MapPoint name="C1" x={C1.x} y={C1.y} color="#FF7BEA" />}
			{C2 && <MapPoint name="C2" x={C2.x} y={C2.y} color="#FF7BEA" />}
			{N1 && <MapPoint name="N1" x={N1.x} y={N1.y} color="#35FF7A" />}
			{N2 && <MapPoint name="N2" x={N2.x} y={N2.y} color="#35FF7A" />}
			{S1 && <MapPoint name="S1" x={S1.x} y={S1.y} color="#FF4D4D" />}
			{S2 && <MapPoint name="S2" x={S2.x} y={S2.y} color="#FF4D4D" />}
			{Max && <MapPoint name="Max" x={Max.x} y={Max.y} color="#FFFFFF" />}
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
	<>
		<circle cx={x} cy={y} r="3" fill={color} />
		<text x={x + 5} y={y - 5} children={name} style={TEXT_STYLE} />
	</>
))
