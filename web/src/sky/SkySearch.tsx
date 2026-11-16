import type { MinorBody, MinorBodySearchResponse, SkySearchResult } from 'api'
import { cn } from 'cn'
import { useEffect, useRef, useState } from 'react'
import { useSnapshot } from 'valtio'
import { activeProfile, profileState, satelliteFavorites, skyFavorites } from '../profile/profile'
import { FavoriteButton } from '../ui/FavoriteButton'
import { inputClassName } from '../ui/Field'
import { IconButton } from '../ui/IconButton'
import { filterFavorites, isSkyFavorite, searchFavoriteSatellites, setSkyObjectFavorite } from './favorites'
import { formatMagnitude } from './format'
import { createRequestGuard } from './selection'
import { searchMinorBodies, searchSky } from './sky'

// Object search of the Sky toolbar. Local results (the catalog and the major bodies) come first and
// fast; asteroids and comets are looked up in SBDB in parallel, in their own section, and never hold up
// the local results. Results are grouped by category and chosen with the mouse or the keyboard (↑, ↓,
// Enter, Escape). An ambiguous SBDB match lists its candidates, which search again by designation.
// Every object listed has a star that marks or unmarks it as a favorite of the profile (./favorites). The
// favorites are listed instead of the search while the Favorites toggle beside the field is on, the text then
// only filtering them, and whenever the field is empty: the Sky favorites of the profile, filtered in the tab,
// and the favorite satellites, filtered and named by the satellite catalog.

// Pause after the last keystroke before searching locally, in milliseconds.
const LOCAL_DEBOUNCE_MS = 200

// Pause after the last keystroke before searching SBDB, in milliseconds; longer, as it is remote.
const REMOTE_DEBOUNCE_MS = 600

// Shortest query sent to SBDB.
const REMOTE_MIN_LENGTH = 2

// Most candidates of an ambiguous SBDB match listed.
const MAX_CANDIDATES = 8

// Pause after the last keystroke before listing the favorite satellites, in milliseconds.
const SATELLITES_DEBOUNCE_MS = LOCAL_DEBOUNCE_MS

// Section of the result list.
type SearchSection = 'Solar System' | 'Artificial Satellites' | 'Meteor Showers' | 'Stars' | 'Deep Sky Objects' | 'Asteroids & Comets'

// Selectable entry of the result list: an object, or an SBDB candidate to search again.
type SearchItem = { readonly kind: 'result'; readonly section: SearchSection; readonly result: SkySearchResult; readonly minorBody?: MinorBody } | { readonly kind: 'refine'; readonly section: SearchSection; readonly designation: string; readonly name: string }

// State of the SBDB search.
type RemoteState = { readonly status: 'idle' | 'loading' } | { readonly status: 'done'; readonly response: MinorBodySearchResponse } | { readonly status: 'error'; readonly message: string }

// State of the listing of the favorite satellites: the ones matching the text, and how many match in all.
type SatellitesState = { readonly status: 'idle' | 'loading' } | { readonly status: 'done'; readonly results: readonly SkySearchResult[]; readonly total: number } | { readonly status: 'error'; readonly message: string }

// Section of a result.
function sectionOf(result: SkySearchResult): SearchSection {
	if (result.category === 'star') return 'Stars'
	if (result.category === 'deepSky') return 'Deep Sky Objects'
	if (result.category === 'satellite') return 'Artificial Satellites'
	if (result.category === 'meteorShower') return 'Meteor Showers'
	if (result.category === 'minorBody') return 'Asteroids & Comets'
	return 'Solar System'
}

// Order of the sections in the list.
const SECTIONS: readonly SearchSection[] = ['Solar System', 'Artificial Satellites', 'Meteor Showers', 'Stars', 'Deep Sky Objects', 'Asteroids & Comets']

// Builds the selectable entries of the list, in section order.
function buildItems(local: readonly SkySearchResult[], remote: RemoteState): SearchItem[] {
	const items: SearchItem[] = local.map((result) => ({ kind: 'result', section: sectionOf(result), result }))

	if (remote.status === 'done') {
		const { response } = remote

		if (response.kind === 'found') {
			const { body } = response
			items.push({ kind: 'result', section: 'Asteroids & Comets', minorBody: body, result: { ref: { kind: 'minorBody', spkId: body.spkId, designation: body.designation }, name: body.name, designations: [], category: 'minorBody', typeName: body.kind === 'comet' ? 'Comet' : 'Asteroid' } })
		} else if (response.kind === 'ambiguous') {
			for (const match of response.matches.slice(0, MAX_CANDIDATES)) items.push({ kind: 'refine', section: 'Asteroids & Comets', designation: match.designation, name: match.name })
		}
	}

	return items.sort((a, b) => SECTIONS.indexOf(a.section) - SECTIONS.indexOf(b.section))
}

// Builds the entries of the favorites listing: the Sky favorites and the favorite satellites, in section order, by name
// within a section.
function buildFavoriteItems(favorites: readonly SkySearchResult[], satellites: SatellitesState): SearchItem[] {
	const results = satellites.status === 'done' ? [...favorites, ...satellites.results] : [...favorites]
	results.sort((a, b) => SECTIONS.indexOf(sectionOf(a)) - SECTIONS.indexOf(sectionOf(b)) || a.name.localeCompare(b.name))
	return results.map((result) => ({ kind: 'result', section: sectionOf(result), result }))
}

export interface SkySearchProps {
	// Called with the chosen object and, for a minor body, its SBDB data.
	readonly onSelect: (result: SkySearchResult, minorBody?: MinorBody) => void
}

// Search field with its Favorites toggle and its result list.
export function SkySearch({ onSelect }: SkySearchProps) {
	const [query, setQuery] = useState('')
	const [open, setOpen] = useState(false)
	const [local, setLocal] = useState<readonly SkySearchResult[]>([])
	const [localStatus, setLocalStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
	const [remote, setRemote] = useState<RemoteState>({ status: 'idle' })
	const [active, setActive] = useState(0)
	const [favoritesOnly, setFavoritesOnly] = useState(false)
	const [satellites, setSatellites] = useState<SatellitesState>({ status: 'idle' })
	const inputRef = useRef<HTMLInputElement>(null)
	const localGuard = useRef(createRequestGuard())
	const remoteGuard = useRef(createRequestGuard())
	const satellitesGuard = useRef(createRequestGuard())
	const settings = activeProfile(useSnapshot(profileState)).settings

	const text = query.trim()
	const showFavorites = favoritesOnly || !text
	const favorites = skyFavorites(settings)
	const satelliteIds = satelliteFavorites(settings).join(',')
	const hasFavorites = favorites.length > 0 || satelliteIds.length > 0
	const items = showFavorites ? buildFavoriteItems(filterFavorites(favorites, text), satellites) : buildItems(local, remote)
	// Entry the keyboard acts on, kept within the list as entries leave it (a favorite unmarked in the listing).
	const activeIndex = Math.min(active, items.length - 1)

	useEffect(() => {
		localGuard.current.cancel()
		remoteGuard.current.cancel()
		setActive(0)

		if (!text || favoritesOnly) {
			setLocal([])
			setLocalStatus('idle')
			setRemote({ status: 'idle' })
			return
		}

		setLocalStatus('loading')
		setRemote({ status: text.length >= REMOTE_MIN_LENGTH ? 'loading' : 'idle' })

		const localTimer = setTimeout(() => {
			const request = localGuard.current.begin()
			searchSky(text, request.signal).then(
				(results) => {
					if (!request.current()) return
					setLocal(results)
					setLocalStatus('done')
				},
				() => request.current() && setLocalStatus('error'),
			)
		}, LOCAL_DEBOUNCE_MS)

		const remoteTimer =
			text.length >= REMOTE_MIN_LENGTH
				? setTimeout(() => {
						const request = remoteGuard.current.begin()
						searchMinorBodies(text, request.signal).then(
							(response) => request.current() && setRemote({ status: 'done', response }),
							(error: unknown) => request.current() && setRemote({ status: 'error', message: error instanceof Error ? error.message : 'Search failed' }),
						)
					}, REMOTE_DEBOUNCE_MS)
				: undefined

		return () => {
			clearTimeout(localTimer)
			clearTimeout(remoteTimer)
		}
	}, [text, favoritesOnly])

	// Lists the favorite satellites matching the text while the favorites are on screen; nothing is asked without favorite
	// satellites or while the list is closed. The previous listing stays shown until the new one arrives.
	useEffect(() => {
		satellitesGuard.current.cancel()

		if (!showFavorites || !open || !satelliteIds) {
			setSatellites({ status: 'idle' })
			return
		}

		setSatellites((current) => (current.status === 'done' ? current : { status: 'loading' }))

		const timer = setTimeout(() => {
			const request = satellitesGuard.current.begin()
			searchFavoriteSatellites(satelliteIds.split(','), text, request.signal).then(
				({ results, total }) => request.current() && setSatellites({ status: 'done', results, total }),
				(error: unknown) => request.current() && setSatellites({ status: 'error', message: error instanceof Error ? error.message : 'Listing failed' }),
			)
		}, SATELLITES_DEBOUNCE_MS)

		return () => clearTimeout(timer)
	}, [showFavorites, open, satelliteIds, text])

	useEffect(
		() => () => {
			localGuard.current.cancel()
			remoteGuard.current.cancel()
			satellitesGuard.current.cancel()
		},
		[],
	)

	// Turns the favorites listing on or off and shows the list.
	function toggleFavorites() {
		setFavoritesOnly((on) => !on)
		setActive(0)
		setOpen(true)
		inputRef.current?.focus()
	}

	// Chooses an entry: selects an object and closes the list, or searches a candidate's designation.
	function choose(item: SearchItem | undefined) {
		if (!item) return

		if (item.kind === 'refine') {
			setQuery(item.designation)
			inputRef.current?.focus()
			return
		}

		onSelect(item.result, item.minorBody)
		setOpen(false)
		inputRef.current?.blur()
	}

	function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
		if (e.key === 'ArrowDown') {
			e.preventDefault()
			setOpen(true)
			setActive(Math.min(items.length - 1, activeIndex + 1))
		} else if (e.key === 'ArrowUp') {
			e.preventDefault()
			setActive(Math.max(0, activeIndex - 1))
		} else if (e.key === 'Enter') {
			e.preventDefault()
			choose(items[activeIndex])
		} else if (e.key === 'Escape') {
			if (open) setOpen(false)
			else inputRef.current?.blur()
		}
	}

	const showList = open && (!showFavorites || favoritesOnly || hasFavorites)
	const nothing = !showFavorites && localStatus === 'done' && local.length === 0 && remote.status !== 'loading' && !(remote.status === 'done' && remote.response.kind !== 'notFound')
	const noFavorites = showFavorites && items.length === 0 && satellites.status !== 'loading'
	const moreSatellites = satellites.status === 'done' ? satellites.total - satellites.results.length : 0

	return (
		<div className="flex w-full max-w-96 min-w-0 items-center gap-1 max-sm:max-w-none">
			<div className="relative min-w-0 flex-1">
				<input
					ref={inputRef}
					type="search"
					value={query}
					placeholder={favoritesOnly ? 'Filter favorites' : 'Search objects: M31, Sirius, HIP 32349, Mars, Ceres'}
					onChange={(e) => {
						setQuery(e.target.value)
						setOpen(true)
					}}
					onFocus={() => setOpen(true)}
					onBlur={() => setOpen(false)}
					onKeyDown={handleKeyDown}
					className={cn(inputClassName, 'h-9.5 py-1 text-sm')}
				/>
				{showList && (
					<div onMouseDown={(e) => e.preventDefault()} className="absolute top-full right-0 left-0 z-30 mt-1 max-h-[min(28rem,70vh)] overflow-y-auto rounded-sm border border-line-100 bg-base-200 py-1 shadow-[0_8px_32px_rgb(0_0_0/0.5)]">
						{SECTIONS.map((section) => {
							const entries = items.map((item, index) => ({ item, index })).filter((e) => e.item.section === section)
							const remoteSection = !showFavorites && section === 'Asteroids & Comets'
							const satellitesSection = showFavorites && section === 'Artificial Satellites'
							const pending = (remoteSection && (remote.status === 'loading' || remote.status === 'error')) || (satellitesSection && (satellites.status === 'loading' || satellites.status === 'error' || moreSatellites > 0))
							if (entries.length === 0 && !pending) return null

							return (
								<div key={section} className="py-1">
									<p className="m-0 px-3 pb-1 text-xs font-medium tracking-[0.08em] text-ink-300 uppercase">{section}</p>
									{entries.map(({ item, index }) => (
										<div key={item.kind === 'result' ? `${item.section}:${JSON.stringify(item.result.ref)}` : `refine:${item.designation}`} onMouseEnter={() => setActive(index)} className={cn('flex items-center pr-1', index === activeIndex ? 'bg-base-300' : 'bg-transparent')}>
											<button type="button" onClick={() => choose(item)} className="flex min-w-0 flex-1 cursor-pointer items-baseline gap-2 border-0 bg-transparent px-3 py-1.5 text-left">
												{item.kind === 'result' ? (
													<>
														<span className="min-w-0 flex-1">
															<span className="block truncate text-sm text-ink-100">{item.result.name}</span>
															<span className="block truncate text-xs text-ink-300">{[item.result.typeName, ...item.result.designations].join(' · ')}</span>
														</span>
														{item.result.magnitude !== undefined && <span className="flex-none font-mono text-xs text-ink-300">mag {formatMagnitude(item.result.magnitude)}</span>}
														{item.result.constellation && <span className="w-8 flex-none text-right text-xs text-ink-300">{item.result.constellation}</span>}
													</>
												) : (
													<span className="min-w-0 flex-1 truncate text-sm text-ink-200">
														{item.name} <span className="text-xs text-ink-300">— refine</span>
													</span>
												)}
											</button>
											{item.kind === 'result' && <FavoriteButton favorite={isSkyFavorite(settings, item.result.ref)} onChange={(marked) => setSkyObjectFavorite(profileState, item.result, marked)} />}
										</div>
									))}
									{remoteSection && remote.status === 'loading' && <p className="m-0 px-3 py-1 text-xs text-ink-300">Searching the JPL Small-Body Database…</p>}
									{remoteSection && remote.status === 'error' && <p className="m-0 px-3 py-1 text-xs text-danger">Small-Body Database unavailable: {remote.message}</p>}
									{satellitesSection && satellites.status === 'loading' && <p className="m-0 px-3 py-1 text-xs text-ink-300">Listing the favorite satellites…</p>}
									{satellitesSection && satellites.status === 'error' && <p className="m-0 px-3 py-1 text-xs text-danger">Satellite catalog unavailable: {satellites.message}</p>}
									{satellitesSection && moreSatellites > 0 && <p className="m-0 px-3 py-1 text-xs text-ink-300">{moreSatellites} more favorite satellites; type to narrow the list.</p>}
								</div>
							)
						})}
						{!showFavorites && localStatus === 'loading' && local.length === 0 && <p className="m-0 px-3 py-2 text-xs text-ink-300">Searching…</p>}
						{!showFavorites && localStatus === 'error' && <p className="m-0 px-3 py-2 text-xs text-danger">The local search failed.</p>}
						{nothing && <p className="m-0 px-3 py-2 text-xs text-ink-300">No objects match “{text}”. The catalog holds stars to magnitude 8.</p>}
						{noFavorites && <p className="m-0 px-3 py-2 text-xs text-ink-300">{hasFavorites ? `No favorites match “${text}”.` : 'No favorites yet. Mark objects with the star of a result or of the Object Inspector.'}</p>}
					</div>
				)}
			</div>
			<IconButton icon="favorite" label="Favorites" pressed={favoritesOnly} filled={favoritesOnly} onClick={toggleFavorites} />
		</div>
	)
}
