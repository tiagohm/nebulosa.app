import type { SatelliteGroundTrack as SatelliteGroundTrackData } from 'api'
import { cn } from 'cn'
import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { useSnapshot } from 'valtio'
import { formatClockDuration, formatClockTime, formatDateTime, formatFixed, formatGeographic, formatKilometers, formatSpeed } from '../../format'
import type { GeographicLocation } from '../../location/site'
import type { DisplayZone } from '../../location/zone'
import { EmptyState } from '../../shell/WorkspaceLayout'
import { Button } from '../../ui/Button'
import { Checkbox } from '../../ui/Checkbox'
import { NumberInput } from '../../ui/NumberInput'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { WorldMap, type WorldMapHandle, WorldMapSymbol } from '../../ui/WorldMap'
import { geoPath, horizonRegionPath, smallCircleRegion } from '../../ui/worldmap.geometry'
import { EclipseMapLegend } from '../eclipse/EclipseMapParts'
import { artificialSatellitesState, type GroundTrackLayers, groundTrackInstant, loadSatelliteGroundTrack, MAX_GROUND_TRACK_ORBITS, SHADOW_LABELS, showSatelliteInSky } from './artificialsatellites'
import { type GroundTrackPoint, type GroundTrackShadow, groundTrackAt, groundTrackDistance, groundTrackRuns, groundTrackShadowCrossings, observerInFootprint } from './groundtrack'

// Ground Track tab of Artificial Satellites: the path of the point below the satellite selected on the world map, from
// one orbit before an instant (the real current time, which it follows, or the Sky's) to the orbits asked for after it,
// dashed before the instant and solid after it, fainter in the Earth's shadow, with the satellite, the region that sees
// it above the horizon, the night side, and the observing site of the active profile at the instant shown, in the
// display zone, its distance from the site (from the Earth's center without one), its orbital speed, and its next sunset and sunrise (the crossings of the Earth's umbra the server found
// along the track) counted from that instant. A cursor chooses another instant of the window, which Show in Sky opens in the Sky. The footprint is a spherical Earth with an ideal horizon. Zooming,
// panning, moving the cursor, and hiding a layer ask the server for nothing.

// Stroke width, in screen pixels, and classes of the track by illumination.
const RUN_STYLES: Readonly<Record<GroundTrackShadow, { readonly width: number; readonly className: string }>> = {
	sunlit: { width: 2, className: 'stroke-accent' },
	penumbra: { width: 1.5, className: 'stroke-accent/60' },
	umbra: { width: 1, className: 'stroke-accent/40' },
}

interface GroundTrackOverlayProps {
	// Samples of the ground track.
	readonly track: SatelliteGroundTrackData
	// Ground track at the instant shown; absent outside the samples.
	readonly point?: GroundTrackPoint
	// Layers shown.
	readonly layers: GroundTrackLayers
	// Observing site of the active profile, degrees; absent without one.
	readonly observer?: { readonly latitude: number; readonly longitude: number }
}

// Map layers of a ground track at an instant.
function GroundTrackOverlay({ track, point, layers, observer }: GroundTrackOverlayProps) {
	const runs = groundTrackRuns(track, point?.time)
	const footprint = layers.footprint && point ? smallCircleRegion(point.subpoint, point.footprint) : undefined

	return (
		<>
			{layers.night && point && <path d={horizonRegionPath(point.subsolar, 'below')} className="fill-black/45" />}
			{footprint && (
				<>
					<path d={footprint.fill} className="fill-accent/10" />
					<path d={footprint.outline} className="fill-none stroke-accent/70" strokeWidth={1} vectorEffect="non-scaling-stroke" />
				</>
			)}
			{runs.map((run, i) => {
				const style = RUN_STYLES[layers.shadow ? run.shadow : 'sunlit']
				return run.pieces.map((piece, j) => <path key={`${i}:${j}`} d={geoPath(piece)} className={`fill-none ${style.className} ${run.past ? '[stroke-dasharray:6_4]' : ''}`} strokeWidth={style.width} vectorEffect="non-scaling-stroke" />)
			})}
			{layers.observer && observer && (
				<WorldMapSymbol longitude={observer.longitude} latitude={observer.latitude}>
					<circle r={4.5} className="fill-none stroke-ink-100" strokeWidth={1.5} />
					<path d="M-8 0H-4M4 0H8M0 -8V-4M0 4V8" className="stroke-ink-100" strokeWidth={1.5} />
				</WorldMapSymbol>
			)}
			{point && (
				<WorldMapSymbol longitude={point.subpoint.longitude} latitude={point.subpoint.latitude}>
					<path d="M-8 0H8" className="stroke-base-000" strokeWidth={4} />
					<rect x={-4} y={-4} width={8} height={8} className="fill-accent stroke-base-000" strokeWidth={1.5} />
					<path d="M-8 0H-4M4 0H8" className="stroke-accent" strokeWidth={2} />
				</WorldMapSymbol>
			)}
		</>
	)
}

// Properties of the Ground Track tab.
interface SatelliteGroundTrackProps {
	// Observing site of the active profile; absent without one.
	readonly observer?: GeographicLocation
	// Zone the instant shown is written in.
	readonly zone: DisplayZone
}

// Ground Track tab.
export function SatelliteGroundTrack({ observer, zone }: SatelliteGroundTrackProps) {
	const state = useSnapshot(artificialSatellitesState)
	const { groundTrackDraft, groundTrack: track, groundTrackAnchor: anchor, groundTrackLoading: loading, groundTrackError: error, groundTrackCursor: cursor, groundTrackLayers: layers, selectedId, details } = state
	const draft = artificialSatellitesState.groundTrackDraft
	const timeZone = zone.zone
	const name = details?.object.name ?? selectedId ?? 'satellite'
	const instant = groundTrackInstant(state)
	const point = track && instant !== undefined ? groundTrackAt(track, Math.min(Math.max(instant, track.start), track.times.at(-1)!)) : undefined
	const site = observer && { latitude: observer.latitude, longitude: observer.longitude }
	const mapRef = useRef<WorldMapHandle>(null)
	const centered = useRef<string>(undefined)

	// The map layers are drawn again only when the track, the instant, the layers, or the site change, never on zoom
	// or pan.
	const overlay = useMemo(() => track && <GroundTrackOverlay track={track} point={point} layers={layers} observer={site} />, [track, point?.time, layers, site?.latitude, site?.longitude])

	// Centers the map on the satellite once per satellite, when its first ground track arrives.
	useEffect(() => {
		if (!point || !selectedId || centered.current === selectedId) return
		centered.current = selectedId
		mapRef.current?.centerOn(point.subpoint)
	}, [selectedId, point === undefined])

	if (!selectedId) return <EmptyState title="No satellite selected" description="Select a satellite in the catalog." />
	if (details && !details.elements) return <EmptyState title="No orbital elements" description={`${name} has no orbital elements to predict a ground track with.`} />

	const following = anchor?.start === 'now' && cursor === undefined
	const inside = point && site ? observerInFootprint(site, point) : undefined
	const crossings = track && point ? groundTrackShadowCrossings(track, point.time) : []

	return (
		<div className="flex h-full min-h-0 flex-col">
			<form
				onSubmit={(event) => {
					event.preventDefault()
					void loadSatelliteGroundTrack(artificialSatellitesState)
				}}
				className="flex flex-none flex-wrap items-end gap-2 border-b border-line-100 bg-base-100 px-4 py-3"
			>
				<SegmentedControl label="From" options={['now', 'sky'] as const} value={groundTrackDraft.start} format={(value) => (value === 'now' ? 'Now' : 'Sky Time')} onChange={(value) => (draft.start = value)} />
				<NumberInput label="Orbits after" className="w-32" min={1} max={MAX_GROUND_TRACK_ORBITS} step={1} value={groundTrackDraft.orbits} onChange={(value) => (draft.orbits = value)} />
				<Button type="submit" className="ml-auto" disabled={loading}>
					Compute
				</Button>
			</form>
			<div className="relative isolate min-h-0 flex-1 bg-base-000">
				<WorldMap ref={mapRef} className="size-full">
					{overlay}
				</WorldMap>
				{track && (
					<EclipseMapLegend>
						<span className="flex items-center gap-2">
							<span className="h-0.5 w-4 flex-none bg-accent" />
							After the instant shown; dashed before it
						</span>
						<Checkbox label="Fainter in the Earth's shadow" checked={layers.shadow} onChange={(checked) => (artificialSatellitesState.groundTrackLayers.shadow = checked)} />
						<Checkbox label="Footprint (spherical Earth, ideal horizon)" checked={layers.footprint} onChange={(checked) => (artificialSatellitesState.groundTrackLayers.footprint = checked)} />
						<Checkbox label="Night side" checked={layers.night} onChange={(checked) => (artificialSatellitesState.groundTrackLayers.night = checked)} />
						<Checkbox label="Observing site" checked={layers.observer} disabled={!site} onChange={(checked) => (artificialSatellitesState.groundTrackLayers.observer = checked)} />
					</EclipseMapLegend>
				)}
				{loading && <p className="pointer-events-none absolute top-3 left-3 m-0 rounded-sm bg-base-100/90 px-2 py-1 text-xs text-ink-200">Computing the ground track…</p>}
				{error && (
					<div className="absolute inset-0 bg-base-000/80">
						<EmptyState
							title="No ground track could be computed"
							description={error}
							action={
								<Button variant="secondary" onClick={() => void loadSatelliteGroundTrack(artificialSatellitesState)}>
									Retry
								</Button>
							}
						/>
					</div>
				)}
			</div>
			{track && point && (
				<div className="flex flex-none flex-col gap-2 border-t border-line-100 bg-base-100 px-4 py-3">
					<div className="flex flex-wrap items-center gap-x-4 gap-y-2">
						<label className="flex min-w-60 flex-1 items-center gap-3 text-xs text-ink-300">
							Instant
							<input type="range" min={track.start} max={track.times.at(-1)} step={1000} value={point.time} onChange={(event) => (artificialSatellitesState.groundTrackCursor = +event.target.value)} className="h-4 min-w-0 flex-1 cursor-pointer accent-accent" />
						</label>
						<span className="font-mono text-xs text-ink-100 tabular-nums">{formatDateTime(point.time, timeZone)}</span>
						<div className="flex gap-2">
							{anchor?.start === 'now' && !following && (
								<Button variant="secondary" onClick={() => (artificialSatellitesState.groundTrackCursor = undefined)}>
									Live
								</Button>
							)}
							<Button variant="secondary" title="Sets the Sky time to this instant and shows the satellite there." onClick={() => selectedId && showSatelliteInSky(selectedId, name, observer, point.time)}>
								Show in Sky
							</Button>
						</div>
					</div>
					<div className="flex flex-wrap items-center gap-1 gap-y-1 text-xs text-ink-300">
						<InstantChip className={following ? 'bg-success/10 text-success' : 'bg-accent/10 text-accent'}>{following ? 'Live' : 'Chosen instant'}</InstantChip>
						<InstantChip className="text-ink-200 tabular-nums">{formatGeographic(point.subpoint.latitude, point.subpoint.longitude)}</InstantChip>
						<InstantChip>Height {formatKilometers(point.heightKm)}</InstantChip>
						<InstantChip>{observer ? `Distance ${formatKilometers(groundTrackDistance(point, observer))}` : `Distance ${formatKilometers(groundTrackDistance(point))} from the Earth's center`}</InstantChip>
						<InstantChip>Speed {formatSpeed(point.speedKmPerSecond, 3)}</InstantChip>
						<InstantChip>{SHADOW_LABELS[point.shadow]}</InstantChip>
						{crossings.map((crossing) => (
							<InstantChip key={crossing.kind}>{`${crossing.kind === 'sunset' ? 'Sunset' : 'Sunrise'} ${formatClockTime(crossing.time, timeZone, { seconds: true })} (in ${formatClockDuration((crossing.time - point.time) / 1000)})`}</InstantChip>
						))}
						{crossings.length === 0 && <InstantChip>No sunset or sunrise until the end of the track</InstantChip>}
						{inside !== undefined && <InstantChip>{inside ? "Above the site's horizon" : "Below the site's horizon"}</InstantChip>}
						<InstantChip>
							Period {formatFixed(track.periodMinutes, 1)} min{track.truncated ? ' · later samples were left out' : ''}
						</InstantChip>
					</div>
				</div>
			)}
		</div>
	)
}

interface InstantChipProps {
	readonly className?: string
	readonly children: ReactNode
}

function InstantChip({ className, children }: InstantChipProps) {
	return <span className={cn('px-2 py-1 bg-ink-300/10 rounded-md', className)}>{children}</span>
}
