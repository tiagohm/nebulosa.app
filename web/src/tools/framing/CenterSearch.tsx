import type { SkySearchResult } from 'api'
import { cn } from 'cn'
import { type KeyboardEvent, useEffect, useRef, useState } from 'react'
import type { FramePoint } from '../../framing/geometry'
import { aborted } from '../../http'
import { createRequestGuard } from '../../sky/selection'
import { fetchSkyPosition, searchSky } from '../../sky/sky'
import { Notice } from '../../ui/Notice'
import { TextInput } from '../../ui/TextInput'

// Search of the object the preview of the Framing tool is centered on: the stars and deep-sky objects of the local sky
// catalog whose names match what is typed float in a list under the field, as the model searches do, and choosing one,
// by pointer or by the arrow keys and Enter, centers the preview on its J2000 position (its catalog position moved by
// its proper motion to now). Only catalog objects are offered, since only they have a fixed J2000 position; the search
// is local, so it works without the internet. The list closes on Escape and when the field loses focus.

// Pause after the last keystroke before searching, in milliseconds.
const SEARCH_DELAY_MS = 200

// Most objects listed.
const MAX_RESULTS = 12

// State of a search.
type SearchState = { readonly status: 'idle' | 'loading' } | { readonly status: 'done'; readonly results: readonly SkySearchResult[] } | { readonly status: 'failed'; readonly error: string }

// Props of the search.
export interface CenterSearchProps {
	// Called with the J2000 position (radians) and the name of the object chosen.
	readonly onPick: (center: FramePoint, name: string) => void
}

// Field that searches the sky catalog for the center of the preview.
export function CenterSearch({ onPick }: CenterSearchProps) {
	const [query, setQuery] = useState('')
	const [open, setOpen] = useState(false)
	const [active, setActive] = useState(0)
	const [search, setSearch] = useState<SearchState>({ status: 'idle' })
	const [error, setError] = useState<string>()
	const guard = useRef(createRequestGuard())
	const listRef = useRef<HTMLUListElement>(null)
	const results = search.status === 'done' ? search.results : []
	const shown = open && query.trim() !== '' && search.status !== 'idle'

	// Searches the catalog a moment after the last keystroke.
	useEffect(() => {
		const text = query.trim()
		if (!text) {
			guard.current.cancel()
			setSearch({ status: 'idle' })
			return
		}

		setSearch({ status: 'loading' })
		const timer = setTimeout(() => {
			const request = guard.current.begin()
			searchSky(text, request.signal).then(
				(found) => request.current() && setSearch({ status: 'done', results: found.filter((result) => result.ref.kind === 'catalog').slice(0, MAX_RESULTS) }),
				(failure: unknown) => request.current() && !aborted(failure) && setSearch({ status: 'failed', error: failure instanceof Error ? failure.message : String(failure) }),
			)
		}, SEARCH_DELAY_MS)
		return () => clearTimeout(timer)
	}, [query])

	useEffect(() => () => guard.current.cancel(), [])

	useEffect(() => {
		if (shown) listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
	}, [shown, active])

	// Centers the preview on an object, reading its J2000 position.
	async function pick(result: SkySearchResult | undefined) {
		if (!result) return
		setOpen(false)
		setError(undefined)

		try {
			const { position } = await fetchSkyPosition(result.ref, Date.now(), undefined, 'fast')
			setQuery('')
			onPick({ rightAscension: position.rightAscensionJ2000, declination: position.declinationJ2000 }, result.name)
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : String(failure))
		}
	}

	function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
		if (event.key === 'Enter') {
			event.preventDefault()
			if (shown) void pick(results[active])
		} else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault()
			if (!shown) setOpen(true)
			else setActive(event.key === 'ArrowDown' ? Math.min(active + 1, results.length - 1) : Math.max(active - 1, 0))
		} else if (event.key === 'Escape' && shown) {
			event.preventDefault()
			setOpen(false)
		}
	}

	return (
		<div className="flex flex-col gap-2">
			<div className="relative">
				<TextInput
					label="Object"
					spellCheck={false}
					autoComplete="off"
					value={query}
					placeholder="Search, such as M 42"
					onFocus={() => setOpen(true)}
					onBlur={() => setOpen(false)}
					onChange={(event) => {
						setQuery(event.target.value)
						setActive(0)
						setOpen(true)
					}}
					onKeyDown={handleKeyDown}
				/>
				{shown && (
					<ul ref={listRef} className="absolute inset-x-0 top-[calc(100%+4px)] z-20 m-0 box-border max-h-88 min-w-64 list-none overflow-y-auto overscroll-contain rounded-md border border-line-100 bg-base-200 p-1 text-sm leading-5 shadow-[0_12px_32px_rgb(0_0_0/0.45)]">
						{search.status === 'loading' && <li className="px-2 py-2 text-ink-300">Searching the sky catalog…</li>}
						{search.status === 'failed' && <li className="px-2 py-2 text-danger">{search.error}</li>}
						{search.status === 'done' && results.length === 0 && <li className="px-2 py-2 text-ink-300">No star or deep-sky object of the catalog matches.</li>}
						{results.map((result, index) => (
							<li
								key={result.ref.kind === 'catalog' ? result.ref.id : result.name}
								data-index={index}
								onMouseDown={(event) => event.preventDefault()}
								onMouseMove={() => active !== index && setActive(index)}
								onClick={() => void pick(result)}
								className={cn('flex cursor-pointer flex-col rounded-sm px-2 py-2 max-sm:min-h-12.5', index === active && 'bg-base-300')}
							>
								<span className={index === active ? 'text-accent' : 'text-ink-100'}>{result.name}</span>
								<span className="text-xs leading-4 text-ink-300">
									{result.typeName}
									{result.constellation ? ` · ${result.constellation}` : ''}
									{result.designations[0] && result.designations[0] !== result.name ? ` · ${result.designations[0]}` : ''}
								</span>
							</li>
						))}
					</ul>
				)}
			</div>
			{error && <Notice error>{error}</Notice>}
		</div>
	)
}
