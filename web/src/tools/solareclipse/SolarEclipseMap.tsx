import type { SolarEclipseMap as SolarEclipseMapData } from 'api'
import { cn } from 'cn'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { useSnapshot } from 'valtio'
import { activeProfile, profileState } from '../../profile/profile'
import { EmptyState, WorkspaceLayout } from '../../shell/WorkspaceLayout'
import { Button } from '../../ui/Button'
import { Checkbox } from '../../ui/Checkbox'
import { IconButton } from '../../ui/IconButton'
import { TextInput } from '../../ui/TextInput'
import { WorldMap, type WorldMapHandle, WorldMapSymbol } from '../../ui/WorldMap'
import { DEGREE_PLANE_TRANSFORM } from '../../ui/worldmap.geometry'
import { displayTimeZone, formatEclipseTime, utcDate } from '../eclipse/eclipse'
import { GlobalPointIcon, GlobalPointMarker } from './GlobalPointMarker'
import { ECLIPSE_TYPE_NAMES, findEclipseFrom, GLOBAL_POINTS, type GlobalPointKind, globalPoints, labelRows, limitName, nextEclipse, openSolarEclipseMap, previousEclipse, retryEclipse, type SolarEclipseLayers, selectPlace, setLayer, solarEclipseState } from './solareclipse'
import { SolarEclipsePanel } from './SolarEclipsePanel'

// Solar Eclipse Map tool: steps through solar eclipses (previous, next, from a date, optionally only those
// visible from the place), draws on the world map the central line (solid where total, dashed where annular), the
// limits of the central and partial eclipse, the sunrise/sunset curves, and every global point (contacts P1 to
// P4 and U1 to U4, central line ends C1 and C2, partial limit ends N1, N2, S1, and S2, greatest eclipse and
// duration) with its name, and shows the local circumstances of the place clicked on the map in the contextual
// panel. A global point is chosen in the panel, since a click on the map chooses the place; the map then rings
// it and centers on it. Map paths come from the API on the degree plane and
// are scaled to map units here; zooming, panning, and showing or hiding layers never ask the API for anything.

interface EclipseOverlayProps {
	// Global map of the eclipse.
	readonly map: SolarEclipseMapData
	// Layers shown.
	readonly layers: SolarEclipseLayers
	// Global point highlighted.
	readonly selectedPoint?: GlobalPointKind
}

// Height of a row of point labels, in screen pixels.
const LABEL_ROW_HEIGHT = 12

// Map layers of an eclipse, in painting order: the partial limits, the sunrise/sunset curves, the central limits,
// the central line, and the global points with their labels, the highlighted one ringed. Labels of points that
// nearly coincide are stacked so they do not overlap.
function EclipseOverlay({ map, layers, selectedPoint }: EclipseOverlayProps) {
	const { paths } = map
	const points = globalPoints(map)
	const rows = labelRows(points)

	return (
		<>
			<g transform={DEGREE_PLANE_TRANSFORM}>
				{layers.penumbralLimits && [paths.penumbraNorth, paths.penumbraSouth].map((d, i) => d && <path key={i} d={d} className="fill-none stroke-ink-200" strokeWidth={1} vectorEffect="non-scaling-stroke" />)}
				{layers.riseSet && paths.riseSet && <path d={paths.riseSet} className="fill-none stroke-ink-300 [stroke-dasharray:3_3]" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
				{layers.umbralLimits && [paths.umbraNorth, paths.umbraSouth].map((d, i) => d && <path key={i} d={d} className="fill-none stroke-accent" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />)}
				{layers.centralLine && paths.total && <path d={paths.total} className="fill-none stroke-accent" strokeWidth={2.5} vectorEffect="non-scaling-stroke" />}
				{layers.centralLine && paths.annular && <path d={paths.annular} className="fill-none stroke-accent [stroke-dasharray:6_4]" strokeWidth={2.5} vectorEffect="non-scaling-stroke" />}
			</g>
			{layers.points &&
				points.map((point, i) => (
					<WorldMapSymbol key={point.kind} longitude={point.longitude} latitude={point.latitude}>
						{point.kind === selectedPoint && <circle r={9} className="fill-none stroke-accent" strokeWidth={2} />}
						<GlobalPointMarker kind={point.kind} />
						<title>{`${point.kind} · ${GLOBAL_POINTS[point.kind].name}`}</title>
						{layers.labels && (
							<text x={8} y={4 + rows[i] * LABEL_ROW_HEIGHT} strokeWidth={3} strokeLinejoin="round" className={cn('stroke-base-000 font-mono text-[10px] font-semibold [paint-order:stroke]', point.kind === selectedPoint ? 'fill-accent' : 'fill-ink-100')}>
								{point.kind}
							</text>
						)}
					</WorldMapSymbol>
				))}
		</>
	)
}

interface LegendItemProps {
	// Layer the item shows or hides.
	readonly layer: keyof SolarEclipseLayers
	// Label of the layer.
	readonly label: string
	// Swatch drawn before the label, like the layer on the map.
	readonly swatch: ReactNode
	// Whether the layer is shown.
	readonly checked: boolean
}

// One line of the legend, also the switch of its layer.
function LegendItem({ layer, label, swatch, checked }: LegendItemProps) {
	return (
		<span className="flex items-center gap-2">
			<span className="flex w-4 flex-none justify-center">{swatch}</span>
			<Checkbox label={label} checked={checked} onChange={(shown) => setLayer(solarEclipseState, layer, shown)} />
		</span>
	)
}

// Swatch of a line: solid or dashed, in the accent or a muted color.
function LineSwatch({ dashed, accent, thick }: { readonly dashed?: boolean; readonly accent?: boolean; readonly thick?: boolean }) {
	return (
		<svg width={16} height={6} className="flex-none">
			<line x1={0} y1={3} x2={16} y2={3} className={accent ? 'stroke-accent' : 'stroke-ink-200'} strokeWidth={thick ? 2.5 : 1.5} strokeDasharray={dashed ? '4 3' : undefined} />
		</svg>
	)
}

// Solar Eclipse Map tool.
export function SolarEclipseMap() {
	const profiles = useSnapshot(profileState)
	const observer = activeProfile(profiles).settings.sky.observer
	const state = useSnapshot(solarEclipseState)
	const { eclipse, map, loading, error, notice, layers, place, visibleOnly, selectedPoint } = state
	const [date, setDate] = useState('')
	const mapRef = useRef<WorldMapHandle>(null)
	const timeZone = displayTimeZone(state)

	// Takes the Sky observer as the place and shows the next eclipse on the first visit of the tab.
	useEffect(() => {
		openSolarEclipseMap(solarEclipseState, activeProfile(profileState).settings.sky.observer)
	}, [])

	// Centers the map on a global point when it is highlighted.
	useEffect(() => {
		const point = map && selectedPoint && globalPoints(map).find((p) => p.kind === selectedPoint)
		if (point) mapRef.current?.centerOn(point)
	}, [map, selectedPoint])

	// The map layers are drawn again only when the eclipse, the layers, or the highlighted point change, never on
	// zoom or pan.
	const overlay = useMemo(() => map && <EclipseOverlay map={map} layers={layers} selectedPoint={selectedPoint} />, [map, layers, selectedPoint])
	const title = eclipse ? `${ECLIPSE_TYPE_NAMES[eclipse.type]} solar eclipse · ${utcDate(eclipse.maximum)}` : 'Solar eclipse'
	const central = map && (map.paths.total || map.paths.annular)
	const limits = map && (map.paths.umbraNorth || map.paths.umbraSouth)

	function find() {
		if (date) void findEclipseFrom(solarEclipseState, date)
	}

	return (
		<WorkspaceLayout workspace="tools" title="Solar Eclipse Map" context={<span className="truncate text-xs text-ink-300 max-sm:hidden">{eclipse ? title : ''}</span>} panel={{ title: 'Local Circumstances', content: <SolarEclipsePanel observer={observer} /> }}>
			<div className="flex h-full flex-col bg-base-000">
				<div className="flex flex-none flex-wrap items-center gap-2 border-b border-line-100 bg-base-100 px-2 py-1.5">
					<div className="flex min-w-0 items-center gap-1">
						<IconButton icon="stepBack" label="Previous eclipse" disabled={loading && !eclipse} onClick={() => void previousEclipse(solarEclipseState)} />
						<span className="min-w-0 truncate text-[13px] font-medium text-ink-100">{title}</span>
						<IconButton icon="stepForward" label="Next eclipse" disabled={loading && !eclipse} onClick={() => void nextEclipse(solarEclipseState)} />
					</div>
					<form
						className="flex items-center gap-1"
						onSubmit={(e) => {
							e.preventDefault()
							find()
						}}
					>
						<TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-40" title="First eclipse on or after this date (UTC)" />
						<Button type="submit" variant="secondary" disabled={!date}>
							Find
						</Button>
					</form>
					<Checkbox label="Visible here only" checked={visibleOnly} disabled={!place} onChange={(checked) => (solarEclipseState.visibleOnly = checked)} />
				</div>
				<div className="relative isolate min-h-0 flex-1">
					<WorldMap ref={mapRef} className="size-full" selected={place} onSelect={(point) => void selectPlace(solarEclipseState, { source: 'map', longitude: point.longitude, latitude: point.latitude })}>
						{overlay}
					</WorldMap>
					{map && eclipse && (
						<div className="absolute bottom-9 left-3 flex max-w-[calc(100%-1.5rem)] flex-col gap-1 rounded-sm border border-line-100 bg-base-100/80 px-2.5 py-2 text-xs leading-4 text-ink-200">
							{map.greatestEclipse && <span className="text-ink-100">Greatest eclipse · {formatEclipseTime(map.greatestEclipse.time, timeZone)}</span>}
							{central && (
								<LegendItem
									layer="centralLine"
									label={map.paths.total && map.paths.annular ? 'Central line, dashed where annular' : map.paths.annular ? 'Central line of annularity' : 'Central line of totality'}
									swatch={<LineSwatch accent thick dashed={!map.paths.total} />}
									checked={layers.centralLine}
								/>
							)}
							{limits && <LegendItem layer="umbralLimits" label={limitName(eclipse.type)} swatch={<LineSwatch accent />} checked={layers.umbralLimits} />}
							<LegendItem layer="penumbralLimits" label="Limits of the partial eclipse" swatch={<LineSwatch />} checked={layers.penumbralLimits} />
							{map.paths.riseSet && <LegendItem layer="riseSet" label="Eclipse at sunrise or sunset" swatch={<LineSwatch dashed />} checked={layers.riseSet} />}
							<LegendItem layer="points" label="Global points (see the panel)" swatch={<GlobalPointIcon kind="MAX" />} checked={layers.points} />
							<LegendItem layer="labels" label="Names of the points" swatch={<span className="font-mono text-[10px] font-semibold text-ink-100">P1</span>} checked={layers.labels} />
						</div>
					)}
					{loading && <p className="pointer-events-none absolute top-3 left-3 m-0 text-xs text-ink-300">Computing the eclipse…</p>}
					{notice && <p className="pointer-events-none absolute top-3 left-3 m-0 rounded-sm bg-base-100/90 px-2 py-1 text-xs text-ink-200">{notice}</p>}
					{error && (
						<div className="absolute inset-0 bg-base-000/80">
							<EmptyState
								title="The solar eclipse could not be computed"
								description={error}
								action={
									<Button variant="secondary" onClick={() => void retryEclipse(solarEclipseState)}>
										Retry
									</Button>
								}
							/>
						</div>
					)}
				</div>
			</div>
		</WorkspaceLayout>
	)
}
