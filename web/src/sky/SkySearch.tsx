import type { MinorBody, MinorBodySearchResponse, SkySearchResult } from 'api'
import { cn } from 'cn'
import { useEffect, useRef, useState } from 'react'
import { inputClassName } from '../ui/Field'
import { formatMagnitude } from './format'
import { createRequestGuard } from './selection'
import { searchMinorBodies, searchSky } from './sky'

// Object search of the Sky toolbar. Local results (the catalog and the major bodies) come first and
// fast; asteroids and comets are looked up in SBDB in parallel, in their own section, and never hold up
// the local results. Results are grouped by category and chosen with the mouse or the keyboard (↑, ↓,
// Enter, Escape). An ambiguous SBDB match lists its candidates, which search again by designation.

// Pause after the last keystroke before searching locally, in milliseconds.
const LOCAL_DEBOUNCE_MS = 200

// Pause after the last keystroke before searching SBDB, in milliseconds; longer, as it is remote.
const REMOTE_DEBOUNCE_MS = 600

// Shortest query sent to SBDB.
const REMOTE_MIN_LENGTH = 2

// Most candidates of an ambiguous SBDB match listed.
const MAX_CANDIDATES = 8

// Section of the result list.
type SearchSection = 'Solar System' | 'Stars' | 'Deep Sky Objects' | 'Asteroids & Comets'

// Selectable entry of the result list: an object, or an SBDB candidate to search again.
type SearchItem = { readonly kind: 'result'; readonly section: SearchSection; readonly result: SkySearchResult; readonly minorBody?: MinorBody } | { readonly kind: 'refine'; readonly section: SearchSection; readonly designation: string; readonly name: string }

// State of the SBDB search.
type RemoteState = { readonly status: 'idle' | 'loading' } | { readonly status: 'done'; readonly response: MinorBodySearchResponse } | { readonly status: 'error'; readonly message: string }

// Section of a local result.
function sectionOf(result: SkySearchResult): SearchSection {
	if (result.category === 'star') return 'Stars'
	if (result.category === 'deepSky') return 'Deep Sky Objects'
	return 'Solar System'
}

// Order of the sections in the list.
const SECTIONS: readonly SearchSection[] = ['Solar System', 'Stars', 'Deep Sky Objects', 'Asteroids & Comets']

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

export interface SkySearchProps {
	// Called with the chosen object and, for a minor body, its SBDB data.
	readonly onSelect: (result: SkySearchResult, minorBody?: MinorBody) => void
}

// Search field with its result list.
export function SkySearch({ onSelect }: SkySearchProps) {
	const [query, setQuery] = useState('')
	const [open, setOpen] = useState(false)
	const [local, setLocal] = useState<readonly SkySearchResult[]>([])
	const [localStatus, setLocalStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
	const [remote, setRemote] = useState<RemoteState>({ status: 'idle' })
	const [active, setActive] = useState(0)
	const inputRef = useRef<HTMLInputElement>(null)
	const localGuard = useRef(createRequestGuard())
	const remoteGuard = useRef(createRequestGuard())

	const text = query.trim()
	const items = buildItems(local, remote)

	useEffect(() => {
		localGuard.current.cancel()
		remoteGuard.current.cancel()
		setActive(0)

		if (!text) {
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
	}, [text])

	useEffect(
		() => () => {
			localGuard.current.cancel()
			remoteGuard.current.cancel()
		},
		[],
	)

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
			setActive((i) => Math.min(items.length - 1, i + 1))
		} else if (e.key === 'ArrowUp') {
			e.preventDefault()
			setActive((i) => Math.max(0, i - 1))
		} else if (e.key === 'Enter') {
			e.preventDefault()
			choose(items[active])
		} else if (e.key === 'Escape') {
			if (open) setOpen(false)
			else inputRef.current?.blur()
		}
	}

	const showList = open && text.length > 0
	const nothing = localStatus === 'done' && local.length === 0 && remote.status !== 'loading' && !(remote.status === 'done' && remote.response.kind !== 'notFound')

	return (
		<div className="relative w-full max-w-96 min-w-0">
			<input
				ref={inputRef}
				type="search"
				value={query}
				placeholder="Search objects: M31, Sirius, HIP 32349, Mars, Ceres"
				onChange={(e) => {
					setQuery(e.target.value)
					setOpen(true)
				}}
				onFocus={() => setOpen(true)}
				onBlur={() => setOpen(false)}
				onKeyDown={handleKeyDown}
				className={cn(inputClassName, 'h-9.5 py-1 font-sans text-[13px]')}
			/>
			{showList && (
				<div onMouseDown={(e) => e.preventDefault()} className="absolute top-full right-0 left-0 z-30 mt-1 max-h-[min(28rem,70vh)] overflow-y-auto rounded-sm border border-line-100 bg-base-200 py-1 shadow-[0_8px_32px_rgb(0_0_0/0.5)]">
					{SECTIONS.map((section) => {
						const entries = items.map((item, index) => ({ item, index })).filter((e) => e.item.section === section)
						const remoteSection = section === 'Asteroids & Comets'
						if (entries.length === 0 && !(remoteSection && (remote.status === 'loading' || remote.status === 'error'))) return null

						return (
							<div key={section} className="py-1">
								<p className="m-0 px-3 pb-1 text-[11px] font-medium tracking-[0.08em] text-ink-300 uppercase">{section}</p>
								{entries.map(({ item, index }) => (
									<button
										key={item.kind === 'result' ? `${item.section}:${JSON.stringify(item.result.ref)}` : `refine:${item.designation}`}
										type="button"
										onMouseEnter={() => setActive(index)}
										onClick={() => choose(item)}
										className={cn('flex w-full cursor-pointer items-baseline gap-2 border-0 px-3 py-1.5 text-left', index === active ? 'bg-base-300' : 'bg-transparent')}
									>
										{item.kind === 'result' ? (
											<>
												<span className="min-w-0 flex-1">
													<span className="block truncate text-[13px] text-ink-100">{item.result.name}</span>
													<span className="block truncate text-xs text-ink-300">{[item.result.typeName, ...item.result.designations].join(' · ')}</span>
												</span>
												{item.result.magnitude !== undefined && <span className="flex-none font-mono text-xs text-ink-300">{formatMagnitude(item.result.magnitude)}</span>}
												{item.result.constellation && <span className="w-8 flex-none text-right text-xs text-ink-300">{item.result.constellation}</span>}
											</>
										) : (
											<span className="min-w-0 flex-1 truncate text-[13px] text-ink-200">
												{item.name} <span className="text-xs text-ink-300">— refine</span>
											</span>
										)}
									</button>
								))}
								{remoteSection && remote.status === 'loading' && <p className="m-0 px-3 py-1 text-xs text-ink-300">Searching the JPL Small-Body Database…</p>}
								{remoteSection && remote.status === 'error' && <p className="m-0 px-3 py-1 text-xs text-danger">Small-Body Database unavailable: {remote.message}</p>}
							</div>
						)
					})}
					{localStatus === 'loading' && local.length === 0 && <p className="m-0 px-3 py-2 text-xs text-ink-300">Searching…</p>}
					{localStatus === 'error' && <p className="m-0 px-3 py-2 text-xs text-danger">The local search failed.</p>}
					{nothing && <p className="m-0 px-3 py-2 text-xs text-ink-300">No objects match “{text}”.</p>}
				</div>
			)}
		</div>
	)
}
