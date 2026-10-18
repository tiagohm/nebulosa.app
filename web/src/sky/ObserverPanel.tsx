import { useState } from 'react'
import { type SkyObserverSettings, normalizeSkyObserver, profileState, setSkyObserver } from '../profile/profile'
import { PanelSection } from '../shell/ContextualPanel'
import { Button } from '../ui/Button'
import { Select } from '../ui/Select'
import { TextInput } from '../ui/TextInput'

// Observer settings of the Sky workspace: the location of the active profile, entered by hand in
// degrees and meters, and the time zone its times are shown in. No location is ever assumed; without one the sky has no horizon and positions are
// geocentric. Saving stores it in the profile; the map and the selection follow it.

export interface ObserverPanelProps {
	// Observer of the active profile; absent when none is set.
	readonly observer?: SkyObserverSettings
	// Returns to the Object Inspector.
	readonly onDone: () => void
}

// Time zones offered: the browser's (empty) and every IANA zone the browser knows.
const TIME_ZONES = ['', ...Intl.supportedValuesOf('timeZone')]

// Time zone of the browser, named by the empty option.
const BROWSER_TIME_ZONE = new Intl.DateTimeFormat().resolvedOptions().timeZone

// Text of a number field: the stored value, or empty.
function fieldText(value: number | undefined) {
	return value === undefined ? '' : `${value}`
}

// Observer settings form.
export function ObserverPanel({ observer, onDone }: ObserverPanelProps) {
	const [name, setName] = useState(observer?.name ?? '')
	const [latitude, setLatitude] = useState(fieldText(observer?.latitude))
	const [longitude, setLongitude] = useState(fieldText(observer?.longitude))
	const [elevation, setElevation] = useState(fieldText(observer?.elevation ?? 0))
	const [timeZone, setTimeZone] = useState(observer?.timeZone ?? '')
	const [error, setError] = useState<string>()

	function save() {
		const candidate = { name: name.trim() || undefined, latitude: latitude.trim() === '' ? Number.NaN : +latitude, longitude: longitude.trim() === '' ? Number.NaN : +longitude, elevation: elevation.trim() === '' ? 0 : +elevation, timeZone: timeZone || undefined }

		if (!normalizeSkyObserver(candidate)) {
			setError('Latitude must be between −90° and 90°, longitude between −180° and 180° (east positive), and elevation between −500 m and 9000 m.')
			return
		}

		setSkyObserver(profileState, candidate)
		setError(undefined)
		onDone()
	}

	function clear() {
		setSkyObserver(profileState, undefined)
		setName('')
		setLatitude('')
		setLongitude('')
		setElevation('0')
		setTimeZone('')
		setError(undefined)
	}

	return (
		<>
			<PanelSection title="Location">
				<form
					className="flex flex-col gap-3"
					onSubmit={(e) => {
						e.preventDefault()
						save()
					}}
				>
					<TextInput label="Name" value={name} placeholder="Optional" onChange={(e) => setName(e.target.value)} />
					<TextInput label="Latitude (north +)" suffix="°" inputMode="decimal" value={latitude} placeholder="-23.5505" onChange={(e) => setLatitude(e.target.value)} />
					<TextInput label="Longitude (east +)" suffix="°" inputMode="decimal" value={longitude} placeholder="-46.6333" onChange={(e) => setLongitude(e.target.value)} />
					<TextInput label="Elevation" suffix="m" inputMode="decimal" value={elevation} onChange={(e) => setElevation(e.target.value)} />
					<Select label="Time Zone" options={TIME_ZONES} value={timeZone} onChange={setTimeZone} format={(zone) => zone || `Browser (${BROWSER_TIME_ZONE})`} />
					{error && <p className="m-0 text-xs leading-4 text-danger">{error}</p>}
					<div className="flex flex-wrap gap-2">
						<Button type="submit" size="sm">
							Save
						</Button>
						<Button variant="secondary" size="sm" onClick={onDone}>
							Cancel
						</Button>
						{observer && (
							<Button variant="ghost" size="sm" onClick={clear}>
								Clear Location
							</Button>
						)}
					</div>
				</form>
			</PanelSection>
			<PanelSection title="About">
				<p className="m-0 text-xs leading-4 text-ink-300">The location belongs to the active profile. It sets the horizon, altitudes, and rise and set times, and its time zone sets how times are shown and entered; it does not change any equipment.</p>
			</PanelSection>
		</>
	)
}
