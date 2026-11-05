import { useEffect, useMemo, useState } from 'react'
import { useSnapshot } from 'valtio'
import { formatGeographic } from '../format'
import { activeSite, forgetSite, MAX_SITE_ELEVATION, MIN_SITE_ELEVATION, normalizeObservingSite, type ObservingSite, type ObservingSiteInput, parseGeographicAngle, removeSite, saveSite, selectSite, siteState } from '../location/site'
import { BROWSER_TIME_ZONE, formatUtcOffset, TIME_ZONES } from '../location/zone'
import { activeProfile, profileState } from '../profile/profile'
import { PanelSection } from '../shell/ContextualPanel'
import { Actions } from '../ui/Actions'
import { Button } from '../ui/Button'
import { ConfirmButton } from '../ui/ConfirmButton'
import { Notice } from '../ui/Notice'
import { Select } from '../ui/Select'
import { TextInput } from '../ui/TextInput'
import { WorldMap, WorldMapSymbol } from '../ui/WorldMap'

// Editor of one observing site: its name, latitude and longitude (decimal or sexagesimal, signed or with a hemisphere
// letter, kept in decimal degrees), height above the ellipsoid, and IANA time zone, edited as a local draft that only
// Save writes. The world map sets the coordinates with a click and never chooses a zone, which is always chosen by a
// person; the browser's zone is only offered. A site changed by another tab replaces an unchanged draft. Saving,
// selecting, or deleting a site never commands a device.

export interface ObservingSiteEditorProps {
	// Site edited; absent while a new one is created.
	readonly site?: ObservingSite
	// Reports whether the draft differs from what was saved.
	readonly onDirtyChange: (dirty: boolean) => void
	// Called with the site once saved.
	readonly onSaved: (site: ObservingSite) => void
	// Called when a new site is abandoned or a site is deleted.
	readonly onClosed: () => void
}

// Text of the fields of a site being edited.
interface Draft {
	readonly name: string
	readonly latitude: string
	readonly longitude: string
	readonly elevation: string
	readonly timeZone: string
}

// Decimals of the coordinates a map click writes: 1e-5° is about 1 m on the Earth.
const MAP_DECIMALS = 5

// Returns the draft of a site, or of a new one at sea level in UTC.
function draftOf(site: ObservingSiteInput | undefined): Draft {
	return site ? { name: site.name, latitude: `${site.latitude}`, longitude: `${site.longitude}`, elevation: `${site.elevation}`, timeZone: site.timeZone } : { name: '', latitude: '', longitude: '', elevation: '0', timeZone: 'UTC' }
}

// Whether two drafts hold the same text.
function sameDraft(a: Draft, b: Draft) {
	return a.name === b.name && a.latitude === b.latitude && a.longitude === b.longitude && a.elevation === b.elevation && a.timeZone === b.timeZone
}

// Returns the site a draft describes, or undefined when a field cannot be read or is out of range.
function parseDraft(draft: Draft): ObservingSiteInput | undefined {
	const latitude = parseGeographicAngle(draft.latitude, 'latitude')
	const longitude = parseGeographicAngle(draft.longitude, 'longitude')
	const elevation = draft.elevation.trim() === '' ? Number.NaN : +draft.elevation
	if (latitude === undefined || longitude === undefined) return undefined
	return normalizeObservingSite({ name: draft.name, latitude, longitude, elevation, timeZone: draft.timeZone })
}

// Editor of an observing site.
export function ObservingSiteEditor({ site, onDirtyChange, onSaved, onClosed }: ObservingSiteEditorProps) {
	const profiles = useSnapshot(profileState)
	const { sites } = useSnapshot(siteState)
	const [base, setBase] = useState(() => draftOf(site))
	const [draft, setDraft] = useState(base)
	const [error, setError] = useState<string>()
	const dirty = !sameDraft(draft, base)
	const saved = useMemo(() => draftOf(site), [site])

	// Follows a site saved elsewhere while the draft is unchanged, or already has its values.
	if (site && !sameDraft(saved, base) && (!dirty || sameDraft(draft, saved))) {
		setBase(saved)
		setDraft(saved)
	}

	useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange])

	const latitude = parseGeographicAngle(draft.latitude, 'latitude')
	const longitude = parseGeographicAngle(draft.longitude, 'longitude')
	const located = latitude !== undefined && longitude !== undefined && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180
	const active = site !== undefined && activeSite(activeProfile(profiles), sites)?.id === site.id
	const users = site ? profiles.profiles.filter((profile) => profile.activeSiteId === site.id).length : 0
	const now = Date.now()

	function edit(patch: Partial<Draft>) {
		setDraft({ ...draft, ...patch })
		setError(undefined)
	}

	function save() {
		const input = parseDraft(draft)

		if (!input) {
			setError(`Enter a name, a latitude between 90° S and 90° N, a longitude between 180° W and 180° E, and an elevation between ${MIN_SITE_ELEVATION} m and ${MAX_SITE_ELEVATION} m.`)
			return
		}

		const result = saveSite(siteState, input, site?.id)
		if (!result) return
		const next = draftOf(result)
		setBase(next)
		setDraft(next)
		onSaved(result)
	}

	function cancel() {
		setDraft(base)
		setError(undefined)
		if (!site) onClosed()
	}

	function remove() {
		if (!site) return
		removeSite(siteState, site.id)
		forgetSite(profileState, site.id)
		onClosed()
	}

	return (
		<div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
			<header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line-100 px-4 py-3">
				<div className="flex min-w-0 flex-1 basis-60 flex-col">
					<h2 className="m-0 truncate text-md leading-6 font-medium text-ink-100">{site ? site.name : 'New Site'}</h2>
					{site && <Notice>{users === 0 ? 'No profile observes from this site.' : users === 1 ? 'One profile observes from this site.' : `${users} profiles observe from this site.`}</Notice>}
				</div>
				{site &&
					(active ? (
						<span className="text-xs font-medium text-accent">Active in this profile</span>
					) : (
						<Button variant="secondary" disabled={dirty} title={dirty ? 'Save or cancel the changes first' : undefined} onClick={() => selectSite(profileState, siteState, site.id)}>
							Use in This Profile
						</Button>
					))}
			</header>
			<div className="flex flex-col lg:flex-row">
				<div className="flex min-w-0 flex-col lg:w-96 lg:flex-none">
					<PanelSection title="Site">
						<form
							className="flex flex-col gap-3"
							onSubmit={(e) => {
								e.preventDefault()
								save()
							}}
						>
							<TextInput label="Name" value={draft.name} placeholder="Backyard" onChange={(e) => edit({ name: e.target.value })} />
							<TextInput label="Latitude" suffix="°" spellCheck={false} autoComplete="off" value={draft.latitude} placeholder="-23.5475 or 23° 32′ 51″ S" onChange={(e) => edit({ latitude: e.target.value })} />
							<TextInput label="Longitude" suffix="°" spellCheck={false} autoComplete="off" value={draft.longitude} placeholder="-46.6361 or 46° 38′ 10″ W" onChange={(e) => edit({ longitude: e.target.value })} />
							{located && <Notice>{formatGeographic(latitude, longitude, MAP_DECIMALS)}</Notice>}
							<TextInput label="Elevation" suffix="m" inputMode="decimal" value={draft.elevation} onChange={(e) => edit({ elevation: e.target.value })} />
							<Notice>Height above the WGS84 ellipsoid, not above sea level; the two differ by up to about 100 m.</Notice>
							<Select label="Time Zone" options={TIME_ZONES} value={draft.timeZone} onChange={(timeZone) => edit({ timeZone })} format={(zone) => `${zone} (${formatUtcOffset(zone, now)})`} />
							{draft.timeZone !== BROWSER_TIME_ZONE && (
								<Button variant="ghost" className="self-start" onClick={() => edit({ timeZone: BROWSER_TIME_ZONE })}>
									Use the Browser Time Zone ({BROWSER_TIME_ZONE})
								</Button>
							)}
							<Notice>The civil time zone of the site, which names its local days and nights. It is never guessed from the coordinates.</Notice>
							{error && <Notice error>{error}</Notice>}
							<Actions>
								<Button type="submit" disabled={site !== undefined && !dirty}>
									{site ? 'Save' : 'Add Site'}
								</Button>
								<Button variant="secondary" disabled={site !== undefined && !dirty} onClick={cancel}>
									Cancel
								</Button>
							</Actions>
						</form>
					</PanelSection>
					{site && (
						<PanelSection title="Delete">
							<Notice>Profiles that observe from this site will observe from none; running operations keep the place they started with.</Notice>
							<Actions>
								<ConfirmButton title={`Delete ${site.name}?`} message="Every profile that observes from it will have no observing site. This cannot be undone." confirmLabel="Delete Site" onConfirm={remove}>
									Delete Site
								</ConfirmButton>
							</Actions>
						</PanelSection>
					)}
				</div>
				<div className="flex min-w-0 flex-1 flex-col gap-2 px-4 py-3">
					<WorldMap className="h-72 w-full overflow-hidden rounded-md border border-line-100 lg:h-112" selected={located ? { latitude, longitude } : undefined} onSelect={(point) => edit({ latitude: point.latitude.toFixed(MAP_DECIMALS), longitude: point.longitude.toFixed(MAP_DECIMALS) })}>
						{sites
							.filter((entry) => entry.id !== site?.id)
							.map((entry) => (
								<WorldMapSymbol key={entry.id} latitude={entry.latitude} longitude={entry.longitude}>
									<circle r={3.5} className="fill-ink-300 stroke-base-000" strokeWidth={1} />
								</WorldMapSymbol>
							))}
					</WorldMap>
					<Notice>Click the map to set the coordinates; the other sites are shown as gray dots. The time zone is not changed by the map.</Notice>
				</div>
			</div>
		</div>
	)
}
