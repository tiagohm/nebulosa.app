import { type ReactNode, useState } from 'react'
import { useSnapshot } from 'valtio'
import { formatElevation, formatGeographic } from '../format'
import { activeProfile, profileState } from '../profile/profile'
import { CollapsibleSection } from '../shell/CollapsibleSection'
import { Button } from '../ui/Button'
import { DataRow } from '../ui/DataRow'
import { Notice } from '../ui/Notice'
import { Select } from '../ui/Select'
import { TextInput } from '../ui/TextInput'
import { activeSite, isValidLocation, MAX_SITE_ELEVATION, MIN_SITE_ELEVATION, openObservingSites, parseGeographicAngle, type ResolvedLocation, siteState, type ToolLocation } from './site'
import { TIME_ZONES } from './zone'

// Location section of a tool: where it observes from, chosen for the tool alone among the active profile's site
// (followed live), another saved site, or coordinates typed in with their time zone. Nothing here changes the profile
// or a site. A tool may ask for a collapsible section, which then summarizes the place while collapsed.

export interface ToolLocationSectionProps {
	// Choice of the tool.
	readonly value: ToolLocation
	// Place it gives, resolved by the tool; absent when there is none.
	readonly location?: ResolvedLocation
	// Receives the choice made.
	readonly onChange: (location: ToolLocation) => void
	// Whether the elevation is asked for coordinates typed in; tools that ignore it leave it at 0 m.
	readonly elevation?: boolean
	// Extra guidance, such as how the tool's map chooses a place.
	readonly hint?: ReactNode
	// Identifier of the collapsible section, namespaced by panel, such as "solarEclipse.location".
	readonly id: string
}

// Option of the source selector: the active site, a saved site after "site:", or coordinates.
type SourceOption = 'active' | 'manual' | `site:${string}`

// Option of a choice.
function sourceOf(value: ToolLocation): SourceOption {
	return value.mode === 'saved' ? `site:${value.siteId}` : value.mode
}

// Text of a coordinate field: the value in degrees to a hundred-thousandth (about 1 m), or empty.
function fieldText(value: number | undefined) {
	return value === undefined ? '' : `${+value.toFixed(5)}`
}

interface ManualFormProps {
	// Place the form starts from, if any.
	readonly start?: ResolvedLocation
	// Whether the elevation is asked for.
	readonly elevation: boolean
	// Receives the place typed in once it is valid.
	readonly onApply: (location: Extract<ToolLocation, { mode: 'manual' }>) => void
}

// Coordinates, elevation, and zone of a place typed in, applied together.
function ManualForm({ start, elevation, onApply }: ManualFormProps) {
	const [latitude, setLatitude] = useState(fieldText(start?.latitude))
	const [longitude, setLongitude] = useState(fieldText(start?.longitude))
	const [height, setHeight] = useState(`${start?.elevation ?? 0}`)
	const [timeZone, setTimeZone] = useState(start?.timeZone ?? 'UTC')
	const [error, setError] = useState<string>()

	function apply() {
		const place = { latitude: parseGeographicAngle(latitude, 'latitude') ?? Number.NaN, longitude: parseGeographicAngle(longitude, 'longitude') ?? Number.NaN, elevation: height.trim() === '' ? Number.NaN : +height, timeZone }

		if (!isValidLocation(place)) {
			setError(`Latitude must be between 90° S and 90° N, longitude between 180° W and 180° E, and elevation between ${MIN_SITE_ELEVATION} m and ${MAX_SITE_ELEVATION} m.`)
			return
		}

		setError(undefined)
		onApply({ mode: 'manual', ...place })
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
				<TextInput label="Latitude" suffix="°" spellCheck={false} autoComplete="off" value={latitude} onChange={(e) => setLatitude(e.target.value)} />
				<TextInput label="Longitude" suffix="°" spellCheck={false} autoComplete="off" value={longitude} onChange={(e) => setLongitude(e.target.value)} />
			</div>
			{elevation && <TextInput label="Elevation" suffix="m" inputMode="decimal" value={height} onChange={(e) => setHeight(e.target.value)} />}
			<Select label="Time Zone of the Place" options={TIME_ZONES} value={timeZone} onChange={setTimeZone} />
			<Notice>Degrees, north and east positive, or with N, S, E, or W. The zone names the place's local days and nights; it is never guessed from the coordinates.</Notice>
			{error && <Notice error>{error}</Notice>}
			<Button type="submit" variant="secondary" className="self-start">
				Apply Location
			</Button>
		</form>
	)
}

// Location section of a tool.
export function ToolLocationSection({ value, location, onChange, elevation = false, hint, id }: ToolLocationSectionProps) {
	const profiles = useSnapshot(profileState)
	const { sites } = useSnapshot(siteState)
	const active = activeSite(activeProfile(profiles), sites)
	const options: SourceOption[] = ['active', ...sites.map((site): SourceOption => `site:${site.id}`), 'manual']
	const formKey = location ? `${location.source}:${location.latitude}:${location.longitude}:${location.elevation}:${location.timeZone}` : 'none'

	function format(option: SourceOption) {
		if (option === 'active') return active ? `Active Site: ${active.name}` : 'Active Site: none'
		if (option === 'manual') return 'Coordinates Entered'
		return sites.find((site) => site.id === option.slice(5))?.name ?? 'Deleted site'
	}

	function choose(option: SourceOption) {
		if (option === 'active') onChange({ mode: 'active' })
		else if (option !== 'manual') onChange({ mode: 'saved', siteId: option.slice(5) })
		else if (location) onChange({ mode: 'manual', latitude: location.latitude, longitude: location.longitude, elevation: location.elevation, timeZone: location.timeZone })
		else onChange({ mode: 'manual', latitude: 0, longitude: 0, elevation: 0, timeZone: 'UTC' })
	}

	const content = (
		<>
			<Select label="Source" options={options} value={sourceOf(value)} format={format} onChange={choose} />
			{location ? (
				<>
					<DataRow label="Place">{formatGeographic(location.latitude, location.longitude)}</DataRow>
					{elevation && <DataRow label="Elevation">{formatElevation(location.elevation)}</DataRow>}
					<DataRow label="Time Zone">{location.timeZone}</DataRow>
				</>
			) : value.mode === 'active' ? (
				<>
					<Notice>The active profile has no observing site.</Notice>
					<Button variant="ghost" className="self-start" onClick={() => openObservingSites()}>
						Choose Observing Site
					</Button>
				</>
			) : (
				<Notice>This site was deleted. Choose another location.</Notice>
			)}
			{value.mode === 'manual' && <ManualForm key={formKey} start={location} elevation={elevation} onApply={onChange} />}
			{hint}
			<Notice>Choosing a location here never changes the profile or its observing site.</Notice>
		</>
	)

	return (
		<CollapsibleSection id={id} title="Location" summary={location ? (location.name ?? formatGeographic(location.latitude, location.longitude)) : 'No site'}>
			{content}
		</CollapsibleSection>
	)
}
