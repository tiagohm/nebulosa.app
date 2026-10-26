import { type ReactNode, useState } from 'react'
import type { SkyObserverSettings } from '../../profile/schema'
import { PanelSection } from '../../shell/ContextualPanel'
import { TIME_ZONES } from '../../sky/clock'
import { Button } from '../../ui/Button'
import { TextInput } from '../../ui/TextInput'
import { type EclipsePlace, observerPlace } from './eclipse'

// Pieces of the Local Circumstances panels of the eclipse map tools: a labeled datum, a muted note, and the
// Location section, where the place is the Sky observer, a click on the map, or coordinates typed in. Nothing here
// changes the profile.

// Time zones offered for the times: UTC, the browser's (empty), and every other IANA zone.
export const DISPLAY_TIME_ZONES = ['UTC', ...TIME_ZONES.filter((zone) => zone !== 'UTC')]

// Names of the sources of a place.
const PLACE_SOURCES = { observer: 'Sky observer', map: 'Map selection', manual: 'Coordinates entered' } as const

// Label and value of one datum.
export function Datum({ label, children }: { readonly label: string; readonly children: ReactNode }) {
	return (
		<div className="flex items-baseline justify-between gap-3">
			<span className="flex-none text-ink-300">{label}</span>
			<span className="min-w-0 text-right font-mono text-[13px] wrap-break-word text-ink-100">{children}</span>
		</div>
	)
}

// Muted note under a section.
export function Note({ children, danger }: { readonly children: ReactNode; readonly danger?: boolean }) {
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
	// Receives the place typed in once both coordinates are in range.
	readonly onApply: (place: EclipsePlace) => void
}

// Coordinates of a place typed in, applied together.
function PlaceForm({ latitude, longitude, onApply }: PlaceFormProps) {
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
		onApply({ source: 'manual', latitude: lat, longitude: lon })
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

export interface LocationSectionProps {
	// Place shown, absent until one is chosen.
	readonly place?: EclipsePlace
	// Sky observer of the active profile; absent when none is set.
	readonly observer?: SkyObserverSettings
	// Receives the place chosen: coordinates typed in, or the Sky observer.
	readonly onSelect: (place: EclipsePlace) => void
}

// Location section: the place shown, its coordinates to edit, and the Sky observer to go back to.
export function LocationSection({ place, observer, onSelect }: LocationSectionProps) {
	const placeKey = place ? `${place.source}:${place.latitude}:${place.longitude}` : 'none'

	return (
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
			<PlaceForm key={placeKey} latitude={place?.latitude} longitude={place?.longitude} onApply={onSelect} />
			{observer && place?.source !== 'observer' && (
				<Button variant="ghost" size="sm" className="self-start" onClick={() => onSelect(observerPlace(observer))}>
					Use Sky Observer
				</Button>
			)}
			<Note>Choosing a location here never changes the Sky observer of the profile.</Note>
		</PanelSection>
	)
}
