import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSnapshot } from 'valtio'
import { formatGeographic } from '../format'
import { activeSite, forgetSite, MAX_SITE_ELEVATION, MIN_SITE_ELEVATION, type ObservingSite, type ObservingSiteInput, parseGeographicAngle, removeSite, SITE_DECIMALS, saveSite, selectSite, siteState } from '../location/site'
import { BROWSER_TIME_ZONE, formatUtcOffset, TIME_ZONES, zoneSolarDifference } from '../location/zone'
import { activeProfile, profileState } from '../profile/profile'
import { PanelSection } from '../shell/ContextualPanel'
import { Actions } from '../ui/Actions'
import { Button } from '../ui/Button'
import { ConfirmButton } from '../ui/ConfirmButton'
import { Notice } from '../ui/Notice'
import { StatusBadge } from '../ui/StatusBadge'
import { TextInput } from '../ui/TextInput'
import { VirtualSelect } from '../ui/VirtualSelect'
import { WorldMap, type WorldMapHandle, WorldMapSymbol } from '../ui/WorldMap'
import { project, WORLD_MAP_HOME, type WorldMapView } from '../ui/worldmap.geometry'

// Editor of one observing site: its name, latitude and longitude (decimal or sexagesimal, signed or with a hemisphere
// letter, kept in decimal degrees), height above the ellipsoid, and IANA time zone, edited as a local draft that only
// Save writes. Each field names its own problem, and Save stays disabled, saying why, while one remains. The world map
// opens on the site, follows the coordinates typed, and sets them with a click to the precision its zoom shows; it never
// chooses a zone, which is always chosen by a person: the browser's zone is only offered, and a zone far from the solar
// time of the longitude is only pointed out. A site changed by another tab replaces an unchanged draft. Saving,
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

// Fields of a draft that can hold a problem; the time zone is always one of the list.
type CheckedField = 'name' | 'latitude' | 'longitude' | 'elevation'

// Problem of each field of a draft, in words; absent for a field that can be saved.
type Problems = Partial<Record<CheckedField, string>>

// Fields in form order, which is the order their problems are named in.
const CHECKED_FIELDS: readonly CheckedField[] = ['name', 'latitude', 'longitude', 'elevation']

// Zoom of the map opened on a saved site, a multiple of the smallest one: a region a few hundred kilometres across.
const SITE_MAP_ZOOM = 8

// Hours between a zone's clock and the solar time of the longitude beyond which the zone is pointed out; civil zones
// keep within about 3 h of it, and a site left in UTC away from Western Europe and Africa is usually past it.
const ZONE_SOLAR_LIMIT = 2.5

// Limit in degrees, its range in words, and the typed forms of a latitude and a longitude, for their problems.
const ANGLE_FORMS = {
	latitude: { limit: 90, range: '90° S and 90° N', example: '-23.5475, 23.5475 S, or 23 32 51 S' },
	longitude: { limit: 180, range: '180° W and 180° E', example: '-46.6361, 46.6361 W, or 46 38 10 W' },
} as const

// Returns the draft of a site, or of a new one at sea level in UTC.
function draftOf(site: ObservingSiteInput | undefined): Draft {
	return site ? { name: site.name, latitude: `${site.latitude}`, longitude: `${site.longitude}`, elevation: `${site.elevation}`, timeZone: site.timeZone } : { name: '', latitude: '', longitude: '', elevation: '0', timeZone: 'UTC' }
}

// Whether two drafts hold the same text.
function sameDraft(a: Draft, b: Draft) {
	return a.name === b.name && a.latitude === b.latitude && a.longitude === b.longitude && a.elevation === b.elevation && a.timeZone === b.timeZone
}

// Returns the problem of a latitude or longitude typed, or undefined when it reads as one in range.
function angleProblem(text: string, axis: 'latitude' | 'longitude'): string | undefined {
	if (text.trim() === '') return `Enter a ${axis}.`
	const value = parseGeographicAngle(text, axis)
	const { limit, range, example } = ANGLE_FORMS[axis]
	if (value === undefined) return `Not a ${axis}; type it as ${example}.`
	if (Math.abs(value) > limit) return `A ${axis} is between ${range}.`
	return undefined
}

// Returns the problems of the fields of a draft; empty when it can be saved.
function problemsOf(draft: Draft): Problems {
	const problems: { -readonly [K in CheckedField]?: string } = {}
	if (draft.name.trim() === '') problems.name = 'Enter a name.'
	problems.latitude = angleProblem(draft.latitude, 'latitude')
	problems.longitude = angleProblem(draft.longitude, 'longitude')
	const elevation = +draft.elevation
	if (draft.elevation.trim() === '') problems.elevation = 'Enter an elevation.'
	else if (!Number.isFinite(elevation)) problems.elevation = 'Not a number of meters.'
	else if (elevation < MIN_SITE_ELEVATION || elevation > MAX_SITE_ELEVATION) problems.elevation = `An elevation is between ${MIN_SITE_ELEVATION} m and ${MAX_SITE_ELEVATION} m.`
	return problems
}

// Returns the site of a draft without problems.
function siteOf(draft: Draft): ObservingSiteInput {
	return { name: draft.name, latitude: parseGeographicAngle(draft.latitude, 'latitude') ?? 0, longitude: parseGeographicAngle(draft.longitude, 'longitude') ?? 0, elevation: +draft.elevation, timeZone: draft.timeZone }
}

// Returns the decimals a map click is written with: those of the degrees one screen pixel spans on a map `width` CSS
// pixels wide at a zoom (a multiple of the smallest scale, which fits the 360° of longitude to the width), at most
// SITE_DECIMALS.
function mapDecimals(width: number, zoom: number): number {
	if (width <= 0 || zoom <= 0) return 0
	const perPixel = 360 / (width * zoom)
	return Math.min(SITE_DECIMALS, Math.max(0, Math.ceil(-Math.log10(perPixel))))
}

// Returns the confirmation of the deletion of a site observed from by a number of profiles.
function deleteMessage(users: number) {
	const who = users === 0 ? 'No profile observes from it.' : users === 1 ? 'The one profile that observes from it will have no observing site.' : `The ${users} profiles that observe from it will have no observing site.`
	return `${who} This cannot be undone.`
}

// Editor of an observing site.
export function ObservingSiteEditor({ site, onDirtyChange, onSaved, onClosed }: ObservingSiteEditorProps) {
	const profiles = useSnapshot(profileState)
	const { sites } = useSnapshot(siteState)
	const [base, setBase] = useState(() => draftOf(site))
	const [draft, setDraft] = useState(base)
	// Whether the site was just saved, until the next edit.
	const [justSaved, setJustSaved] = useState(false)
	const map = useRef<WorldMapHandle>(null)
	const frame = useRef<HTMLDivElement>(null)
	// View the map opens with: centred on the saved site, or the whole world for a new one; kept for the editor's life.
	const [initialView] = useState<WorldMapView>(() => (site ? { zoom: SITE_MAP_ZOOM, center: project(site.longitude, site.latitude) } : WORLD_MAP_HOME))
	const dirty = !sameDraft(draft, base)
	const saved = useMemo(() => draftOf(site), [site])

	// Follows a site saved elsewhere while the draft is unchanged, or already has its values.
	if (site && !sameDraft(saved, base) && (!dirty || sameDraft(draft, saved))) {
		setBase(saved)
		setDraft(saved)
	}

	useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange])
	// An editor that goes away, such as one whose record another tab deleted, leaves no unsaved changes behind.
	useEffect(() => () => onDirtyChange(false), [onDirtyChange])

	const problems = problemsOf(draft)
	const firstProblem = CHECKED_FIELDS.map((field) => problems[field]).find((problem) => problem !== undefined)
	// Problem shown under a field: only once its text differs from the saved one, so an empty new form is not all errors.
	const shown = (field: CheckedField) => (draft[field] !== base[field] ? problems[field] : undefined)
	const latitude = problems.latitude ? undefined : parseGeographicAngle(draft.latitude, 'latitude')
	const longitude = problems.longitude ? undefined : parseGeographicAngle(draft.longitude, 'longitude')
	const located = latitude !== undefined && longitude !== undefined
	const active = site !== undefined && activeSite(activeProfile(profiles), sites)?.id === site.id
	const users = site ? profiles.profiles.filter((profile) => profile.activeSiteId === site.id).length : 0
	// Current hour, Unix milliseconds rounded down: the instant the UTC offsets of the zones are named at, kept for the hour
	// so the zone texts the search reads are not rebuilt on every render.
	const hour = Math.floor(Date.now() / 3_600_000) * 3_600_000
	const zoneLabel = useCallback((zone: string) => `${zone} (${formatUtcOffset(zone, hour)})`, [hour])
	const solarDifference = located ? zoneSolarDifference(draft.timeZone, longitude, hour) : 0
	const saveBlocked = firstProblem ?? (site && !dirty ? 'No changes to save' : undefined)

	// Brings the coordinates typed into view on the map, moving it only when they are off screen.
	useEffect(() => {
		if (latitude !== undefined && longitude !== undefined) map.current?.reveal({ latitude, longitude })
	}, [latitude, longitude])

	function edit(patch: Partial<Draft>) {
		setDraft({ ...draft, ...patch })
		setJustSaved(false)
	}

	function save() {
		if (saveBlocked) return
		const result = saveSite(siteState, siteOf(draft), site?.id)
		if (!result) return
		const next = draftOf(result)
		setBase(next)
		setDraft(next)
		setJustSaved(true)
		onSaved(result)
	}

	function cancel() {
		setDraft(base)
		if (!site) onClosed()
	}

	function remove() {
		if (!site) return
		removeSite(siteState, site.id)
		forgetSite(profileState, site.id)
		onClosed()
	}

	function pick(point: { readonly latitude: number; readonly longitude: number }) {
		const decimals = mapDecimals(frame.current?.clientWidth ?? 0, map.current?.view().zoom ?? 1)
		edit({ latitude: point.latitude.toFixed(decimals), longitude: point.longitude.toFixed(decimals) })
	}

	return (
		<div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
			<header className="z-10 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line-100 bg-base-100 px-4 py-3 sm:sticky sm:top-0">
				<div className="flex min-w-0 flex-1 basis-60 flex-col">
					<h2 className="m-0 truncate leading-6 font-medium text-ink-100" title={site?.name}>
						{site ? site.name : 'New Site'}
					</h2>
					{site && <Notice>{users === 0 ? 'No profile observes from this site.' : users === 1 ? 'One profile observes from this site.' : `${users} profiles observe from this site.`}</Notice>}
				</div>
				{site &&
					(active ? (
						<StatusBadge tone="neutral" label="Active in this profile" title="The observing site of this profile" />
					) : (
						<Button variant="secondary" disabled={dirty} title={dirty ? 'Save or cancel the changes first' : undefined} onClick={() => selectSite(profileState, siteState, site.id)}>
							Use in This Profile
						</Button>
					))}
			</header>
			<div className="grid lg:grid-cols-[24rem_minmax(0,1fr)] lg:grid-rows-[auto_1fr]">
				<div className="min-w-0 lg:col-start-1 lg:row-start-1">
					<PanelSection title="Site">
						<form
							className="flex flex-col gap-3"
							onSubmit={(e) => {
								e.preventDefault()
								save()
							}}
						>
							<div className="flex flex-col gap-1">
								<TextInput label="Name" value={draft.name} placeholder="Backyard" onChange={(e) => edit({ name: e.target.value })} />
								{shown('name') && <Notice error>{shown('name')}</Notice>}
							</div>
							<div className="flex flex-col gap-1">
								<TextInput label="Latitude" suffix="°" value={draft.latitude} placeholder="-23.5475 or 23 32 51 S" onChange={(e) => edit({ latitude: e.target.value })} />
								{shown('latitude') && <Notice error>{shown('latitude')}</Notice>}
							</div>
							<div className="flex flex-col gap-1">
								<TextInput label="Longitude" suffix="°" value={draft.longitude} placeholder="-46.6361 or 46 38 10 W" onChange={(e) => edit({ longitude: e.target.value })} />
								{shown('longitude') && <Notice error>{shown('longitude')}</Notice>}
								<Notice>{located ? formatGeographic(latitude, longitude, SITE_DECIMALS) : 'Decimal or sexagesimal, signed or with N S E W.'}</Notice>
							</div>
							<div className="flex flex-col gap-1">
								<TextInput label="Elevation" suffix="m" inputMode="decimal" value={draft.elevation} onChange={(e) => edit({ elevation: e.target.value })} />
								{shown('elevation') && <Notice error>{shown('elevation')}</Notice>}
								<Notice>Height above the WGS84 ellipsoid, not above sea level; the two differ by up to about 100 m.</Notice>
							</div>
							<div className="flex flex-col gap-1">
								<VirtualSelect label="Time Zone" options={TIME_ZONES} value={draft.timeZone} onChange={(timeZone) => edit({ timeZone })} format={zoneLabel} searchable searchPlaceholder="Zone or UTC offset…" />
								{Math.abs(solarDifference) > ZONE_SOLAR_LIMIT && (
									<Notice warning>
										{draft.timeZone} runs {Math.abs(solarDifference).toFixed(1)} h {solarDifference > 0 ? 'ahead of' : 'behind'} the solar time at this longitude. Check that it is the zone of the site.
									</Notice>
								)}
								<Notice>The civil time zone of the site, which names its local days and nights. It is never guessed from the coordinates.</Notice>
							</div>
							{draft.timeZone !== BROWSER_TIME_ZONE && (
								<Button variant="secondary" className="justify-start self-start text-left" onClick={() => edit({ timeZone: BROWSER_TIME_ZONE })}>
									Use This Device's Time Zone ({BROWSER_TIME_ZONE})
								</Button>
							)}
							<Actions>
								<Button type="submit" disabled={saveBlocked !== undefined} title={saveBlocked}>
									{site ? 'Save' : 'Add Site'}
								</Button>
								<Button variant="secondary" disabled={site !== undefined && !dirty} title={site !== undefined && !dirty ? 'No changes to cancel' : undefined} onClick={cancel}>
									Cancel
								</Button>
								{justSaved && <Notice>Saved.</Notice>}
							</Actions>
						</form>
					</PanelSection>
				</div>
				<div className="flex min-w-0 flex-col gap-2 border-t border-line-100 px-4 py-3 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:border-t-0">
					<div ref={frame} className="aspect-2/1 w-full overflow-hidden max-sm:aspect-4/3 rounded-md border border-line-100">
						<WorldMap ref={map} className="size-full" initialView={initialView} selected={located ? { latitude, longitude } : undefined} onSelect={pick}>
							{sites
								.filter((entry) => entry.id !== site?.id)
								.map((entry) => (
									<WorldMapSymbol key={entry.id} latitude={entry.latitude} longitude={entry.longitude}>
										<circle r={3.5} className="fill-ink-300 stroke-base-000" strokeWidth={1} />
									</WorldMapSymbol>
								))}
						</WorldMap>
					</div>
					<Notice>Click or tap the map to set the coordinates, as precise as its zoom shows; the other sites are the gray dots. The map never changes the time zone.</Notice>
				</div>
				{site && (
					<div className="min-w-0 border-t border-line-100 lg:col-start-1 lg:row-start-2">
						<PanelSection title="Delete">
							<Notice>Profiles that observe from this site will observe from none; running operations keep the place they started with.</Notice>
							<Actions>
								<ConfirmButton destructive title={`Delete ${site.name}?`} message={deleteMessage(users)} confirmLabel="Delete Site" onConfirm={remove}>
									Delete Site
								</ConfirmButton>
							</Actions>
						</PanelSection>
					</div>
				)}
			</div>
		</div>
	)
}
