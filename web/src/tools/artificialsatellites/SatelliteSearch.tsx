import type { SatelliteSearchPage, SatelliteSummary } from 'api'
import { cn } from 'cn'
import { type RefObject, useEffect, useRef, useState } from 'react'
import { useSnapshot } from 'valtio'
import { formatDate } from '../../format'
import type { GeographicLocation } from '../../location/site'
import { useActiveTimeZone } from '../../location/useLocation'
import { activeProfile, profileState, satelliteFavorites, setSatelliteFavorite } from '../../profile/profile'
import { satelliteCatalogState } from '../../satellites/satellites'
import { createRequestGuard } from '../../sky/selection'
import { Button } from '../../ui/Button'
import { FavoriteButton } from '../../ui/FavoriteButton'
import { inputClassName } from '../../ui/Field'
import { IconButton } from '../../ui/IconButton'
import { artificialSatellitesState, searchSatelliteList, selectSatellite } from './artificialsatellites'

// Satellite search of the Artificial Satellites toolbar, as the Sky's object search: the server's catalog (never
// CelesTrak) listed as the text is typed, by name, NORAD id, or COSPAR id, and chosen with the mouse or the keyboard (↑,
// ↓, Enter, Escape), which selects the satellite in whatever view is shown. Every satellite listed has a star that marks
// or unmarks it as a favorite of the profile. The favorites are listed instead of the search while the Favorites toggle
// beside the field is on, the text then only filtering them, and whenever the field is empty. The list is read again
// after every change of the catalog while it is open.

// Pause after the last keystroke before searching, in milliseconds.
const SEARCH_DEBOUNCE_MS = 200

// State of the list: the page of the latest search, or why it could not be read.
type ListState = { readonly status: 'idle' | 'loading' } | { readonly status: 'done'; readonly page: SatelliteSearchPage } | { readonly status: 'error'; readonly message: string }

// Second line of a satellite listed: its designations and where its elements come from with their epoch (a date in an
// IANA zone), or that it has catalog data only; its type is in the panel once chosen.
function describe(satellite: SatelliteSummary, timeZone: string) {
	const { noradId, cosparId, elementKind, elementEpoch } = satellite
	const elements = elementEpoch === undefined ? 'catalog only, no prediction' : `${elementKind === 'manual' ? 'imported' : 'GP'} ${formatDate(elementEpoch, timeZone)}`
	return [`NORAD ${noradId}`, cosparId, elements].filter(Boolean).join(' · ')
}

// Properties of the satellite search.
export interface SatelliteSearchProps {
	// Observing site of the active profile, which selecting a satellite reads its position for; absent without one.
	readonly observer?: GeographicLocation
	// Opens the CelesTrak Groups, offered when the catalog is empty.
	readonly onOpenGroups: () => void
	// Ref the search field is written to, so the tool can focus it (the / shortcut).
	readonly inputRef: RefObject<HTMLInputElement | null>
}

// Search field with its Favorites toggle and its list.
export function SatelliteSearch({ observer, onOpenGroups, inputRef }: SatelliteSearchProps) {
	const [query, setQuery] = useState('')
	const [open, setOpen] = useState(false)
	const [favoritesOnly, setFavoritesOnly] = useState(false)
	const [list, setList] = useState<ListState>({ status: 'idle' })
	const [active, setActive] = useState(0)
	const guard = useRef(createRequestGuard())
	const { selectedId } = useSnapshot(artificialSatellitesState)
	const { revision, snapshot } = useSnapshot(satelliteCatalogState)
	const settings = activeProfile(useSnapshot(profileState)).settings
	const timeZone = useActiveTimeZone()

	const text = query.trim()
	const showFavorites = favoritesOnly || !text
	const favorites = satelliteFavorites(settings)
	const favoriteIds = favorites.join(',')
	const items = list.status === 'done' ? list.page.items : []
	// Entry the keyboard acts on, kept within the list as entries leave it (a favorite unmarked in the listing).
	const activeIndex = Math.min(active, items.length - 1)

	// Reads the list while it is open: the favorites matching the text, or the catalog's satellites matching it. The
	// previous list stays shown until the new one arrives.
	useEffect(() => {
		guard.current.cancel()
		setActive(0)
		if (!open) return undefined
		setList((current) => (current.status === 'done' ? current : { status: 'loading' }))

		const timer = setTimeout(() => {
			const request = guard.current.begin()
			searchSatelliteList(text, showFavorites ? (favoriteIds ? favoriteIds.split(',') : []) : undefined, request.signal).then(
				(page) => request.current() && setList({ status: 'done', page }),
				(error: unknown) => request.current() && setList({ status: 'error', message: error instanceof Error ? error.message : 'Search failed' }),
			)
		}, SEARCH_DEBOUNCE_MS)

		return () => clearTimeout(timer)
	}, [open, text, showFavorites, favoriteIds, revision])

	useEffect(() => () => guard.current.cancel(), [])

	// Turns the favorites listing on or off and shows the list.
	function toggleFavorites() {
		setFavoritesOnly((on) => !on)
		setActive(0)
		setOpen(true)
		inputRef.current?.focus()
	}

	// Chooses a satellite: selects it in the tool and closes the list.
	function choose(satellite: SatelliteSummary | undefined) {
		if (!satellite) return
		void selectSatellite(artificialSatellitesState, satellite.noradId, observer)
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
			// Keeps the browser from also clearing the search field, so Escape only closes the list, then leaves the field.
			e.preventDefault()
			if (open) setOpen(false)
			else inputRef.current?.blur()
		}
	}

	const more = list.status === 'done' ? list.page.total - list.page.items.length : 0
	const emptyCatalog = snapshot?.objects === 0
	const empty = list.status === 'done' && items.length === 0

	return (
		<div className="flex w-full max-w-96 min-w-0 items-center gap-1 max-sm:max-w-none">
			<div className="relative min-w-0 flex-1">
				<input
					ref={inputRef}
					type="search"
					value={query}
					placeholder={favoritesOnly ? 'Filter favorites' : 'Search satellites: ISS, 25544'}
					title="Search satellites (/)"
					onChange={(e) => {
						setQuery(e.target.value)
						setOpen(true)
					}}
					onFocus={() => setOpen(true)}
					onBlur={() => setOpen(false)}
					onKeyDown={handleKeyDown}
					className={cn(inputClassName, 'h-9.5 py-1 text-sm')}
				/>
				{open && (
					<div onMouseDown={(e) => e.preventDefault()} className="absolute top-full right-0 left-0 z-30 mt-1 sm:right-auto sm:w-[max(100%,22rem)] max-h-[min(28rem,70vh)] overflow-y-auto rounded-md border border-line-100 bg-base-200 py-1 shadow-[0_12px_32px_rgb(0_0_0/0.45)]">
						<p className="m-0 px-3 pt-1 pb-1 text-xs font-medium tracking-[0.08em] text-ink-300 uppercase">{showFavorites ? 'Favorites' : 'Satellites'}</p>
						{items.map((satellite, index) => (
							<div key={satellite.noradId} onMouseEnter={() => setActive(index)} className={cn('flex items-center pr-1', index === activeIndex ? 'bg-base-300' : 'bg-transparent')}>
								<button type="button" title={satellite.noradId === selectedId ? 'Selected' : `Selects ${satellite.name}.`} onClick={() => choose(satellite)} className="flex min-w-0 flex-1 cursor-pointer flex-col border-0 bg-transparent px-3 py-1.5 text-left">
									<span className={cn('block truncate text-sm', satellite.noradId === selectedId ? 'text-accent' : 'text-ink-100')}>{satellite.name}</span>
									<span className="block truncate text-xs text-ink-300">{describe(satellite, timeZone)}</span>
								</button>
								<FavoriteButton favorite={favorites.includes(satellite.noradId)} onChange={(marked) => setSatelliteFavorite(profileState, satellite.noradId, marked)} />
							</div>
						))}
						{list.status === 'loading' && <p className="m-0 px-3 py-2 text-xs text-ink-300">Searching…</p>}
						{list.status === 'error' && <p className="m-0 px-3 py-2 text-xs text-danger">The satellite catalog could not be searched: {list.message}</p>}
						{more > 0 && <p className="m-0 px-3 py-1 text-xs text-ink-300">{`${more} more ${showFavorites ? 'favorites' : 'satellites'}; type to narrow the list.`}</p>}
						{empty && emptyCatalog && (
							<div className="flex flex-col items-start gap-2 px-3 py-2">
								<p className="m-0 text-xs text-ink-300">No catalog downloaded. Download a group, such as Space stations, or import element sets.</p>
								<Button variant="secondary" onClick={onOpenGroups}>
									Open CelesTrak Groups
								</Button>
							</div>
						)}
						{empty && !emptyCatalog && showFavorites && <p className="m-0 px-3 py-2 text-xs text-ink-300">{favorites.length > 0 ? `No favorites match “${text}”.` : 'No favorites yet. Type to search the catalog and mark satellites with their star.'}</p>}
						{empty && !emptyCatalog && !showFavorites && <p className="m-0 px-3 py-2 text-xs text-ink-300">{`No satellite matches “${text}”. Download more groups in CelesTrak Groups, or import its elements.`}</p>}
					</div>
				)}
			</div>
			<IconButton icon="favorite" label="Favorites" pressed={favoritesOnly} filled={favoritesOnly} onClick={toggleFavorites} />
		</div>
	)
}
