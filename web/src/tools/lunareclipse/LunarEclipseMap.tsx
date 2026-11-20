import type { LunarEclipseContactKind, LunarEclipseInstantMap, LunarEclipseMap as LunarEclipseMapData } from 'api'
import { cn } from 'cn'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSnapshot } from 'valtio'
import { formatLongDateTime } from '../../format'
import { locationKey } from '../../location/site'
import { useDisplayZone, useToolLocation } from '../../location/useLocation'
import { redirect, routeState } from '../../shell/route'
import { EmptyState, WorkspaceLayout } from '../../shell/WorkspaceLayout'
import { Button } from '../../ui/Button'
import { Checkbox } from '../../ui/Checkbox'
import { IconButton } from '../../ui/IconButton'
import { Select } from '../../ui/Select'
import { TextInput } from '../../ui/TextInput'
import { WorldMap, type WorldMapHandle, WorldMapSymbol } from '../../ui/WorldMap'
import { DEGREE_PLANE_TRANSFORM } from '../../ui/worldmap.geometry'
import { utcDate } from '../eclipse/eclipse'
import { EclipseHeading, EclipseMapLegend, FRAME_MAX_ZOOM, framePadding } from '../eclipse/EclipseMapParts'
import { CONTACT_NAMES, ECLIPSE_TYPE_NAMES, equatorCrossings, findEclipseFrom, lunarEclipseState, moonUpBounds, nextEclipse, openLunarEclipseMap, previousEclipse, retryEclipse, selectEvent, selectMapPlace, showLunarEclipse, syncPlace } from './lunareclipse'
import { LunarEclipsePanel } from './LunarEclipsePanel'

// Lunar Eclipse Map tool: steps through lunar eclipses (previous, next, from a date, optionally skipping those not
// visible from the place), draws on the world map where the Moon is above the horizon at the selected contact, or at
// the instant the Local View draws between the contacts, with the moonrise/moonset line of every contact named where it
// crosses the equator and the sublunar points, and shows in the contextual panel the local circumstances of the tool's
// location: the active site until another site, coordinates, or a point clicked on the map is chosen. Each eclipse is
// framed on the map, the hemisphere where the Moon is up at greatest eclipse with the place, and a place chosen off
// screen is brought into view. A URL that names an eclipse opens that one. Map paths come from the API on the degree
// plane and are scaled to map units here; zooming and panning never ask the API for anything.

// Value of the toolbar's contact picker while the Local View, and so the map, draws an instant between the contacts.
const BETWEEN_CONTACTS = 'between'

// Height of a row of stacked contact names on the map, in screen pixels.
const LABEL_ROW_HEIGHT = 12

// Longitude, in degrees, below which the names of two contacts where their lines cross the equator are stacked
// rather than drawn over each other: about the width of a name on the whole map.
const LABEL_STACK_DISTANCE = 12

interface EclipseOverlayProps {
	// Global map of the eclipse.
	readonly map: LunarEclipseMapData
	// Contact highlighted, unless instant is given.
	readonly selectedEvent: LunarEclipseContactKind
	// Map at the instant the Local View draws between the contacts, drawn in place of the selected contact's.
	readonly instant?: LunarEclipseInstantMap
}

// Name of a contact on the map, where its moonrise/moonset line crosses the equator.
interface ContactLabel {
	// Contact named.
	readonly kind: LunarEclipseContactKind
	// Longitude of the crossing, in degrees.
	readonly longitude: number
	// Row of the name in its stack, 0 for the first.
	readonly row: number
}

// Returns the names of the contacts where their lines cross the equator, in contact order, each in the first row free
// of the earlier names within LABEL_STACK_DISTANCE of it, so close contacts stay readable.
function contactLabels(map: LunarEclipseMapData): ContactLabel[] {
	const labels: ContactLabel[] = []

	for (const event of map.events) {
		const line = map.lines[event.kind]
		if (!line) continue

		for (const longitude of equatorCrossings(line)) {
			const taken = new Set(labels.filter((label) => Math.abs(((label.longitude - longitude + 540) % 360) - 180) < LABEL_STACK_DISTANCE).map((label) => label.row))
			let row = 0
			while (taken.has(row)) row++
			labels.push({ kind: event.kind, longitude, row })
		}
	}

	return labels
}

// Map layers of an eclipse: the region where the Moon is above the horizon at the selected contact or the instant
// drawn, the moonrise/moonset line of each contact (the selected one highlighted) named at the equator, the line of the
// instant drawn, and the sublunar points at the greatest eclipse and at the selected contact or instant.
function EclipseOverlay({ map, selectedEvent, instant }: EclipseOverlayProps) {
	const highlighted = instant ? undefined : selectedEvent
	const fill = instant ? instant.fill : map.fills[selectedEvent]
	const max = map.events.find((event) => event.kind === 'MAX')
	const selected = instant ? instant.sublunar : map.events.find((event) => event.kind === selectedEvent && event.kind !== 'MAX')?.sublunar
	const labels = useMemo(() => contactLabels(map), [map])

	return (
		<>
			<g transform={DEGREE_PLANE_TRANSFORM}>
				{fill && <path d={fill} fillRule="evenodd" className="fill-map-moon/25" />}
				{map.events.map((event) => {
					const line = map.lines[event.kind]
					if (!line || event.kind === highlighted) return null
					return <path key={event.kind} d={line} className="fill-none stroke-ink-300/70" strokeWidth={1} vectorEffect="non-scaling-stroke" />
				})}
				{highlighted && map.lines[highlighted] && <path d={map.lines[highlighted]} className="fill-none stroke-map-moon" strokeWidth={2} vectorEffect="non-scaling-stroke" />}
				{instant && <path d={instant.line} className="fill-none stroke-map-moon" strokeWidth={2} vectorEffect="non-scaling-stroke" />}
			</g>
			{labels.map((label, i) => (
				<WorldMapSymbol key={i} longitude={label.longitude} latitude={0}>
					<text x={4} y={-4 - label.row * LABEL_ROW_HEIGHT} strokeWidth={3} strokeLinejoin="round" className={cn('stroke-base-000 font-mono text-xs font-semibold [paint-order:stroke]', label.kind === highlighted ? 'fill-map-moon' : 'fill-ink-300')}>
						{label.kind}
					</text>
				</WorldMapSymbol>
			))}
			{max && (
				<WorldMapSymbol longitude={max.sublunar.longitude} latitude={max.sublunar.latitude}>
					<circle r={5} className="fill-base-000 stroke-ink-100" strokeWidth={1.5} />
					<circle r={2} className="fill-ink-100" />
				</WorldMapSymbol>
			)}
			{selected && (
				<WorldMapSymbol longitude={selected.longitude} latitude={selected.latitude}>
					<circle r={4} className="fill-map-moon stroke-base-000" strokeWidth={1.5} />
				</WorldMapSymbol>
			)}
		</>
	)
}

// Lunar Eclipse Map tool.
export function LunarEclipseMap() {
	const state = useSnapshot(lunarEclipseState)
	const { eclipse, map, loading, error, unknownLink, notice, selectedEvent, place, visibleOnly, local, viewFraction, legendOpen } = state
	const [date, setDate] = useState('')
	const mapRef = useRef<WorldMapHandle>(null)
	const legendRef = useRef<HTMLDivElement>(null)
	const location = useToolLocation(state.location)
	const placeKey = locationKey(location)
	const timeZone = useDisplayZone(location, state.zone).zone
	const { route } = useSnapshot(routeState)
	const linked = route.workspace === 'tools' ? route.eclipse : undefined
	// Map at the instant the Local View draws, while it draws one between the contacts.
	const instant = viewFraction !== undefined ? local?.view.map : undefined
	const instantTime = instant && local?.view.time

	// Takes the place of the tool's location and shows the eclipse the URL names, or the next eclipse on the first
	// visit of the tab; a reload, back, or forward shows the eclipse of the URL again.
	useEffect(() => {
		if (linked) void showLunarEclipse(lunarEclipseState, linked)
		openLunarEclipseMap(lunarEclipseState, location)
	}, [linked])

	// Asks for the local circumstances again when the place of the location changes, such as when the active site or
	// one of its coordinates changes; syncPlace ignores a change of elevation alone.
	useEffect(() => {
		void syncPlace(lunarEclipseState, location)
	}, [placeKey])

	// Frames the hemisphere where the Moon is up whenever an eclipse is shown, so a portrait screen shows it large
	// rather than the whole Earth in a thin band.
	useEffect(() => {
		frame()
	}, [map])

	// Brings the place into view when it is chosen off screen, such as from typed coordinates; a click on the map is
	// already in view and moves nothing.
	useEffect(() => {
		if (place) mapRef.current?.reveal(place)
	}, [place?.longitude, place?.latitude])

	// The map layers are drawn again only when the eclipse, the contact, or the instant drawn change, never on zoom or pan.
	const overlay = useMemo(() => map && <EclipseOverlay map={map} selectedEvent={selectedEvent} instant={instant} />, [map, selectedEvent, instant])
	const selectedContact = eclipse?.contacts.find((contact) => contact.kind === selectedEvent)
	const shownTime = instant ? instantTime : selectedContact?.time

	// Shows the hemisphere where the Moon is up at greatest eclipse, with the place, beside the legend while it is shown.
	function frame() {
		const bounds = map && moonUpBounds(map, lunarEclipseState.place)
		if (bounds) mapRef.current?.fit(bounds, framePadding(legendRef.current), FRAME_MAX_ZOOM)
	}

	// Keeps a URL that names an eclipse naming the one shown once a search steps to another eclipse.
	function follow(search: Promise<void>) {
		void search.then(() => {
			const current = routeState.route
			const id = lunarEclipseState.eclipse?.id
			if (current.workspace === 'tools' && current.tool === 'lunar-eclipse-map' && current.eclipse && id && current.eclipse !== id) redirect(routeState, { ...current, eclipse: id })
		})
	}

	function find() {
		if (date) follow(findEclipseFrom(lunarEclipseState, date))
	}

	return (
		<WorkspaceLayout workspace="tools" title="Lunar Eclipse Map" panel={{ title: 'Local Circumstances', content: <LunarEclipsePanel /> }}>
			<div className="flex h-full flex-col bg-base-000">
				<div className="flex flex-none flex-wrap items-center gap-2 border-b border-line-100 bg-base-100 px-2 py-1.5">
					<div className="flex min-w-0 items-center gap-1">
						<IconButton icon="stepBack" label="Previous eclipse" disabled={loading && !eclipse} onClick={() => follow(previousEclipse(lunarEclipseState))} />
						<EclipseHeading type={eclipse && `${ECLIPSE_TYPE_NAMES[eclipse.type]} lunar eclipse`} date={eclipse && utcDate(eclipse.maximum)} fallback="Lunar eclipse" />
						<IconButton icon="stepForward" label="Next eclipse" disabled={loading && !eclipse} onClick={() => follow(nextEclipse(lunarEclipseState))} />
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
					<Checkbox
						label="Skip eclipses not visible here"
						checked={visibleOnly}
						disabled={!place}
						title={place ? 'Previous and Next step only to eclipses with the Moon above the horizon here' : 'Choose a location to skip the eclipses it does not see'}
						onChange={(checked) => (lunarEclipseState.visibleOnly = checked)}
					/>
					{eclipse && (
						<Select<LunarEclipseContactKind | typeof BETWEEN_CONTACTS>
							options={eclipse.contacts.map((contact) => contact.kind)}
							value={instant ? BETWEEN_CONTACTS : selectedEvent}
							onChange={(kind) => kind !== BETWEEN_CONTACTS && void selectEvent(lunarEclipseState, kind)}
							format={(kind) => (kind === BETWEEN_CONTACTS ? 'Between contacts' : `${kind} · ${CONTACT_NAMES[kind]}`)}
							className="w-60 flex-none max-sm:w-full"
						/>
					)}
				</div>
				<div className="relative isolate min-h-0 flex-1">
					<WorldMap ref={mapRef} className="size-full" selected={place} tools={<IconButton icon="lunarEclipse" label="Frame the eclipse" disabled={!map} onClick={frame} />} onSelect={(point) => void selectMapPlace(lunarEclipseState, { longitude: point.longitude, latitude: point.latitude })}>
						{overlay}
					</WorldMap>
					{map && shownTime !== undefined && (
						<EclipseMapLegend ref={legendRef} passThrough open={legendOpen} onOpenChange={(open) => (lunarEclipseState.legendOpen = open)}>
							<span className="flex items-center gap-2">
								<span className="size-3 flex-none rounded-xs border border-map-moon bg-map-moon/25" />
								Moon above the horizon {instant ? 'at the instant drawn' : `at ${selectedEvent}`} · {formatLongDateTime(shownTime, timeZone)}
							</span>
							<span className="flex items-center gap-2">
								<span className="h-0.5 w-3 flex-none bg-ink-300" />
								Moonrise or moonset at each contact, named at the equator
							</span>
							<span className="flex items-center gap-2">
								<span className="size-3 flex-none rounded-full border-[1.5px] border-ink-100 bg-base-000" />
								Moon at the zenith at greatest eclipse
							</span>
							{(instant !== undefined || selectedEvent !== 'MAX') && (
								<span className="flex items-center gap-2">
									<span className="size-3 flex-none rounded-full border-[1.5px] border-base-000 bg-map-moon" />
									Moon at the zenith {instant ? 'at the instant drawn' : `at ${selectedEvent}`}
								</span>
							)}
						</EclipseMapLegend>
					)}
					{loading && <p className="pointer-events-none absolute top-3 left-3 m-0 rounded-sm bg-base-100/90 px-2 py-1 text-xs text-ink-200">Computing the eclipse…</p>}
					{notice && !loading && <p className="pointer-events-none absolute top-3 left-3 m-0 rounded-sm bg-base-100/90 px-2 py-1 text-xs text-ink-200">{notice}</p>}
					{error && (
						<div className="absolute inset-0 bg-base-000/80">
							<EmptyState
								title={unknownLink ? 'No lunar eclipse at this link' : 'The lunar eclipse could not be computed'}
								description={unknownLink ? 'The link names no lunar eclipse; it may be mistyped or cut short.' : error}
								action={
									unknownLink ? (
										<Button variant="secondary" onClick={() => redirect(routeState, { workspace: 'tools', tool: 'lunar-eclipse-map' })}>
											Show the next eclipse
										</Button>
									) : (
										<Button variant="secondary" onClick={() => (linked && !eclipse ? void showLunarEclipse(lunarEclipseState, linked) : follow(retryEclipse(lunarEclipseState)))}>
											Retry
										</Button>
									)
								}
							/>
						</div>
					)}
				</div>
			</div>
		</WorkspaceLayout>
	)
}
