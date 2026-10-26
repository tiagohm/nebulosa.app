import type { LunarEclipseContactKind, LunarEclipseMap as LunarEclipseMapData } from 'api'
import { useEffect, useMemo, useState } from 'react'
import { useSnapshot } from 'valtio'
import { activeProfile, profileState } from '../../profile/profile'
import { EmptyState, WorkspaceLayout } from '../../shell/WorkspaceLayout'
import { Button } from '../../ui/Button'
import { Checkbox } from '../../ui/Checkbox'
import { IconButton } from '../../ui/IconButton'
import { Select } from '../../ui/Select'
import { TextInput } from '../../ui/TextInput'
import { WorldMap, WorldMapSymbol } from '../../ui/WorldMap'
import { DEGREE_PLANE_TRANSFORM } from '../../ui/worldmap.geometry'
import { displayTimeZone, formatEclipseTime, utcDate } from '../eclipse/eclipse'
import { CONTACT_NAMES, ECLIPSE_TYPE_NAMES, findEclipseFrom, lunarEclipseState, nextEclipse, openLunarEclipseMap, previousEclipse, retryEclipse, selectEvent, selectPlace } from './lunareclipse'
import { LunarEclipsePanel } from './LunarEclipsePanel'

// Lunar Eclipse Map tool: steps through lunar eclipses (previous, next, from a date, optionally only those
// visible from the place), draws on the world map where the Moon is above the horizon at the selected contact
// with the moonrise/moonset line of every contact and the sublunar points, and shows the local circumstances of
// the place clicked on the map in the contextual panel. Map paths come from the API on the degree plane and are
// scaled to map units here; zooming and panning never ask the API for anything.

interface EclipseOverlayProps {
	// Global map of the eclipse.
	readonly map: LunarEclipseMapData
	// Contact highlighted.
	readonly selectedEvent: LunarEclipseContactKind
}

// Map layers of an eclipse: the region where the Moon is above the horizon at the selected contact, the
// moonrise/moonset line of each contact (the selected one highlighted), and the sublunar points at the greatest
// eclipse and at the selected contact.
function EclipseOverlay({ map, selectedEvent }: EclipseOverlayProps) {
	const fill = map.fills[selectedEvent]
	const max = map.events.find((event) => event.kind === 'MAX')
	const selected = map.events.find((event) => event.kind === selectedEvent)

	return (
		<>
			<g transform={DEGREE_PLANE_TRANSFORM}>
				{fill && <path d={fill} fillRule="evenodd" className="fill-accent/15" />}
				{map.events.map((event) => {
					const line = map.lines[event.kind]
					if (!line || event.kind === selectedEvent) return null
					return <path key={event.kind} d={line} className="fill-none stroke-ink-300/70" strokeWidth={1} vectorEffect="non-scaling-stroke" />
				})}
				{map.lines[selectedEvent] && <path d={map.lines[selectedEvent]} className="fill-none stroke-accent" strokeWidth={2} vectorEffect="non-scaling-stroke" />}
			</g>
			{max && (
				<WorldMapSymbol longitude={max.sublunar.longitude} latitude={max.sublunar.latitude}>
					<circle r={5} className="fill-base-000 stroke-ink-100" strokeWidth={1.5} />
					<circle r={2} className="fill-ink-100" />
				</WorldMapSymbol>
			)}
			{selected && selected.kind !== 'MAX' && (
				<WorldMapSymbol longitude={selected.sublunar.longitude} latitude={selected.sublunar.latitude}>
					<circle r={4} className="fill-accent stroke-base-000" strokeWidth={1.5} />
				</WorldMapSymbol>
			)}
		</>
	)
}

// Lunar Eclipse Map tool.
export function LunarEclipseMap() {
	const profiles = useSnapshot(profileState)
	const observer = activeProfile(profiles).settings.sky.observer
	const state = useSnapshot(lunarEclipseState)
	const { eclipse, map, loading, error, notice, selectedEvent, place, visibleOnly } = state
	const [date, setDate] = useState('')
	const timeZone = displayTimeZone(state)

	// Takes the Sky observer as the place and shows the next eclipse on the first visit of the tab.
	useEffect(() => {
		openLunarEclipseMap(lunarEclipseState, activeProfile(profileState).settings.sky.observer)
	}, [])

	// The map layers are drawn again only when the eclipse or the contact change, never on zoom or pan.
	const overlay = useMemo(() => map && <EclipseOverlay map={map} selectedEvent={selectedEvent} />, [map, selectedEvent])
	const selectedContact = eclipse?.contacts.find((contact) => contact.kind === selectedEvent)
	const title = eclipse ? `${ECLIPSE_TYPE_NAMES[eclipse.type]} lunar eclipse · ${utcDate(eclipse.maximum)}` : 'Lunar eclipse'

	function find() {
		if (date) void findEclipseFrom(lunarEclipseState, date)
	}

	return (
		<WorkspaceLayout workspace="tools" title="Lunar Eclipse Map" context={<span className="truncate text-xs text-ink-300 max-sm:hidden">{eclipse ? title : ''}</span>} panel={{ title: 'Local Circumstances', content: <LunarEclipsePanel observer={observer} /> }}>
			<div className="flex h-full flex-col bg-base-000">
				<div className="flex flex-none flex-wrap items-center gap-2 border-b border-line-100 bg-base-100 px-2 py-1.5">
					<div className="flex min-w-0 items-center gap-1">
						<IconButton icon="stepBack" label="Previous eclipse" disabled={loading && !eclipse} onClick={() => void previousEclipse(lunarEclipseState)} />
						<span className="min-w-0 truncate text-[13px] font-medium text-ink-100">{title}</span>
						<IconButton icon="stepForward" label="Next eclipse" disabled={loading && !eclipse} onClick={() => void nextEclipse(lunarEclipseState)} />
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
					<Checkbox label="Visible here only" checked={visibleOnly} disabled={!place} onChange={(checked) => (lunarEclipseState.visibleOnly = checked)} />
					{eclipse && <Select options={eclipse.contacts.map((contact) => contact.kind)} value={selectedEvent} onChange={(kind) => void selectEvent(lunarEclipseState, kind)} format={(kind) => `${kind} · ${CONTACT_NAMES[kind]}`} className="w-60 max-sm:w-full" />}
				</div>
				<div className="relative isolate min-h-0 flex-1">
					<WorldMap className="size-full" selected={place} onSelect={(point) => void selectPlace(lunarEclipseState, { source: 'map', longitude: point.longitude, latitude: point.latitude })}>
						{overlay}
					</WorldMap>
					{map && selectedContact && (
						<div className="pointer-events-none absolute bottom-9 left-3 flex max-w-[calc(100%-1.5rem)] flex-col gap-1 rounded-sm border border-line-100 bg-base-100/70 px-2.5 py-2 text-xs leading-4 text-ink-200">
							<span className="flex items-center gap-2">
								<span className="size-3 flex-none rounded-xs border border-accent bg-accent/15" />
								Moon above the horizon at {selectedEvent} · {formatEclipseTime(selectedContact.time, timeZone)}
							</span>
							<span className="flex items-center gap-2">
								<span className="h-0.5 w-3 flex-none bg-ink-300" />
								Moonrise or moonset at each contact
							</span>
							<span className="flex items-center gap-2">
								<span className="size-3 flex-none rounded-full border-[1.5px] border-ink-100 bg-base-000" />
								Moon at the zenith at greatest eclipse
							</span>
						</div>
					)}
					{loading && <p className="pointer-events-none absolute top-3 left-3 m-0 text-xs text-ink-300">Computing the eclipse…</p>}
					{notice && <p className="pointer-events-none absolute top-3 left-3 m-0 rounded-sm bg-base-100/90 px-2 py-1 text-xs text-ink-200">{notice}</p>}
					{error && (
						<div className="absolute inset-0 bg-base-000/80">
							<EmptyState
								title="The lunar eclipse could not be computed"
								description={error}
								action={
									<Button variant="secondary" onClick={() => void retryEclipse(lunarEclipseState)}>
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
