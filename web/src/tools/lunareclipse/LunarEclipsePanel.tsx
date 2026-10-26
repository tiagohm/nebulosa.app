import type { LocalLunarViewHandedness, LocalLunarViewOrientationMode } from 'api'
import { cn } from 'cn'
import { type ReactNode, useState } from 'react'
import { useSnapshot } from 'valtio'
import type { SkyObserverSettings } from '../../profile/schema'
import { PanelSection } from '../../shell/ContextualPanel'
import { BROWSER_TIME_ZONE, TIME_ZONES } from '../../sky/clock'
import { Button } from '../../ui/Button'
import { Checkbox } from '../../ui/Checkbox'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { Select } from '../../ui/Select'
import { TextInput } from '../../ui/TextInput'
import { CONTACT_NAMES, displayTimeZone, ECLIPSE_TYPE_NAMES, formatDuration, formatEclipseTime, loadLocal, lunarEclipseState, observerPlace, phaseDurations, selectEvent, selectPlace, setViewSettings } from './lunareclipse'
import { LunarEclipseLocalView } from './LunarEclipseLocalView'

// Local Circumstances panel of the Lunar Eclipse Map: the place (the Sky observer, a click on the map, or
// coordinates typed in), the visibility of the eclipse from it, the contacts in the time zone shown, the
// magnitudes and durations, and the Local View. The global contact times are shown even without a place or when
// the Moon is below its horizon. Nothing here changes the profile.

export interface LunarEclipsePanelProps {
	// Sky observer of the active profile; absent when none is set.
	readonly observer?: SkyObserverSettings
}

// Time zones offered for the times: UTC, the browser's (empty), and every other IANA zone.
const DISPLAY_TIME_ZONES = ['UTC', ...TIME_ZONES.filter((zone) => zone !== 'UTC')]

// Orientations of the Local View, in display order.
const ORIENTATIONS: readonly LocalLunarViewOrientationMode[] = ['zenith', 'north']

// Handedness of the Local View, in display order.
const HANDEDNESS: readonly LocalLunarViewHandedness[] = ['eastRight', 'eastLeft']

// Names of the sources of a place.
const PLACE_SOURCES = { observer: 'Sky observer', map: 'Map selection', manual: 'Coordinates entered' } as const

// Label and value of one datum.
function Datum({ label, children }: { readonly label: string; readonly children: ReactNode }) {
	return (
		<div className="flex items-baseline justify-between gap-3">
			<span className="flex-none text-ink-300">{label}</span>
			<span className="min-w-0 text-right font-mono text-[13px] wrap-break-word text-ink-100">{children}</span>
		</div>
	)
}

// Muted note under a section.
function Note({ children, danger }: { readonly children: ReactNode; readonly danger?: boolean }) {
	return <p className={danger ? 'm-0 text-xs leading-4 text-danger' : 'm-0 text-xs leading-4 text-ink-300'}>{children}</p>
}

// Text of a coordinate field: the value in degrees to a ten-thousandth (about 11 m), or empty.
function fieldText(value: number | undefined) {
	return value === undefined ? '' : `${+value.toFixed(4)}`
}

interface PlaceFormProps {
	// Latitude shown when the form opens, in degrees.
	readonly latitude?: number
	// Longitude shown when the form opens, in degrees.
	readonly longitude?: number
}

// Coordinates of a place typed in, applied together.
function PlaceForm({ latitude, longitude }: PlaceFormProps) {
	const [latitudeText, setLatitudeText] = useState(fieldText(latitude))
	const [longitudeText, setLongitudeText] = useState(fieldText(longitude))
	const [error, setError] = useState<string>()

	function apply() {
		const lat = latitudeText.trim() === '' ? Number.NaN : +latitudeText
		const lon = longitudeText.trim() === '' ? Number.NaN : +longitudeText

		if (!(lat >= -90 && lat <= 90) || !(lon >= -180 && lon <= 180)) {
			setError('Latitude must be between −90° and 90°, and longitude between −180° and 180° (east positive).')
			return
		}

		setError(undefined)
		void selectPlace(lunarEclipseState, { source: 'manual', latitude: lat, longitude: lon })
	}

	return (
		<form
			className="flex flex-col gap-2"
			onSubmit={(e) => {
				e.preventDefault()
				apply()
			}}
		>
			<div className="grid grid-cols-2 gap-2">
				<TextInput label="Latitude" suffix="°" inputMode="decimal" value={latitudeText} onChange={(e) => setLatitudeText(e.target.value)} />
				<TextInput label="Longitude" suffix="°" inputMode="decimal" value={longitudeText} onChange={(e) => setLongitudeText(e.target.value)} />
			</div>
			<Note>Degrees, north and east positive.</Note>
			{error && <Note danger>{error}</Note>}
			<Button type="submit" variant="secondary" size="sm" className="self-start">
				Apply Coordinates
			</Button>
		</form>
	)
}

// Local Circumstances panel.
export function LunarEclipsePanel({ observer }: LunarEclipsePanelProps) {
	const state = useSnapshot(lunarEclipseState)
	const { eclipse, place, local, localLoading, localError, selectedEvent, view } = state
	const timeZone = displayTimeZone(state)
	const events = new Map(local?.events.map((event) => [event.kind, event]))
	const selectedLocal = events.get(selectedEvent)
	const durations = eclipse && phaseDurations(eclipse)
	const placeKey = place ? `${place.source}:${place.latitude}:${place.longitude}` : 'none'

	return (
		<>
			<PanelSection title="Location">
				{place ? (
					<>
						<Datum label="Source">{place.source === 'observer' && place.name ? place.name : PLACE_SOURCES[place.source]}</Datum>
						<Datum label="Latitude">{place.latitude.toFixed(4)}°</Datum>
						<Datum label="Longitude">{place.longitude.toFixed(4)}°</Datum>
					</>
				) : (
					<Note>Select a location on the map, or enter its coordinates.</Note>
				)}
				<PlaceForm key={placeKey} latitude={place?.latitude} longitude={place?.longitude} />
				{observer && place?.source !== 'observer' && (
					<Button
						variant="ghost"
						size="sm"
						className="self-start"
						onClick={() => {
							lunarEclipseState.timeZone = undefined
							void selectPlace(lunarEclipseState, observerPlace(observer))
						}}
					>
						Use Sky Observer
					</Button>
				)}
				<Note>Choosing a location here never changes the Sky observer of the profile.</Note>
			</PanelSection>
			{place && (
				<PanelSection title="Visibility">
					{local && <p className="m-0 font-medium text-ink-100">{local.visibility.text}</p>}
					{local && !local.visibility.hasObservableEclipse && <Note>The Moon stays below the horizon here from P1 to P4; the contact times still hold for everyone.</Note>}
					{local && local.visibility.kind === 'totalVisible' && <Note>The Moon is above the horizon during at least part of totality, but not during the whole eclipse.</Note>}
					{localLoading && <Note>Computing the local circumstances…</Note>}
					{localError && (
						<>
							<Note danger>{localError}</Note>
							<Button variant="secondary" size="sm" className="self-start" onClick={() => void loadLocal(lunarEclipseState)}>
								Retry
							</Button>
						</>
					)}
					<Note>Visible means the Moon's center at or above the 0° horizon, without refraction.</Note>
				</PanelSection>
			)}
			{eclipse && (
				<PanelSection title="Contacts">
					<Select label="Time Zone" options={DISPLAY_TIME_ZONES} value={timeZone} onChange={(zone) => (lunarEclipseState.timeZone = zone)} format={(zone) => zone || `Browser (${BROWSER_TIME_ZONE})`} />
					{eclipse.contacts.map((contact) => {
						const event = events.get(contact.kind)
						const selected = contact.kind === selectedEvent

						return (
							<button
								key={contact.kind}
								type="button"
								onClick={() => void selectEvent(lunarEclipseState, contact.kind)}
								className={cn(
									'flex cursor-pointer flex-col gap-0.5 rounded-sm border px-2 py-1.5 text-left font-mono text-xs text-inherit transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none',
									selected ? 'border-accent bg-accent-subtle' : 'border-line-100 bg-transparent hover:border-line-200',
								)}
							>
								<span className="flex items-baseline justify-between gap-2">
									<span className="font-semibold text-ink-100">{contact.kind}</span>
									<span className="truncate text-ink-300">{CONTACT_NAMES[contact.kind]}</span>
								</span>
								<span className="text-ink-100">{formatEclipseTime(contact.time, timeZone)}</span>
								{event && (
									<span className={event.observable ? 'text-ink-200' : 'text-ink-300'}>
										Alt {event.altitude.toFixed(1)}° · Az {event.azimuth.toFixed(1)}° · {event.observable ? 'Above horizon' : 'Below horizon'}
									</span>
								)}
							</button>
						)
					})}
				</PanelSection>
			)}
			{eclipse && durations && (
				<PanelSection title="Details">
					<Datum label="Type">{ECLIPSE_TYPE_NAMES[eclipse.type]}</Datum>
					<Datum label={eclipse.type === 'PENUMBRAL' ? 'Penumbral magnitude' : 'Umbral magnitude'}>{eclipse.magnitude.toFixed(4)}</Datum>
					{local && eclipse.type !== 'PENUMBRAL' && <Datum label="Penumbral magnitude">{local.details.maximalPenumbralMagnitude.toFixed(4)}</Datum>}
					{durations.penumbral !== undefined && <Datum label="Penumbral phase">{formatDuration(durations.penumbral)}</Datum>}
					{durations.partial !== undefined && <Datum label="Partial phase">{formatDuration(durations.partial)}</Datum>}
					{durations.total !== undefined && <Datum label="Totality">{formatDuration(durations.total)}</Datum>}
					{local && <Datum label="Observable here">{formatDuration(local.details.observableDuration)}</Datum>}
					{selectedLocal && (
						<Datum label={`P / Z at ${selectedEvent}`}>
							{selectedLocal.positionAngle.toFixed(1)}° / {selectedLocal.zenithAngle.toFixed(1)}°
						</Datum>
					)}
				</PanelSection>
			)}
			{local && (
				<PanelSection title="Local View">
					<LunarEclipseLocalView view={local.view} />
					<SegmentedControl label="Up" options={ORIENTATIONS} value={view.orientation} onChange={(orientation) => void setViewSettings(lunarEclipseState, { orientation })} format={(value) => (value === 'zenith' ? 'Zenith' : 'North')} />
					<SegmentedControl label="East" options={HANDEDNESS} value={view.handedness} onChange={(handedness) => void setViewSettings(lunarEclipseState, { handedness })} format={(value) => (value === 'eastRight' ? 'Right' : 'Left')} />
					<Checkbox label="Moon at the other contacts" checked={view.ghosts} onChange={(ghosts) => void setViewSettings(lunarEclipseState, { ghosts })} />
					<Note>The Moon at {local.view.selectedEvent ?? selectedEvent} crossing the Earth's penumbra and umbra; the red band is below the horizon. A geometric diagram, not a photorealistic rendering.</Note>
				</PanelSection>
			)}
		</>
	)
}
