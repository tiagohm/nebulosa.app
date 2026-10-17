import type { DirectoryListing, FileEntry } from 'api'
import { cn } from 'cn'
import { type KeyboardEvent, useEffect, useRef, useState } from 'react'
import { Button } from '../ui/Button'
import { inputClassName } from '../ui/Field'
import { Icon } from '../ui/Icon'
import { IconButton } from '../ui/IconButton'
import { Modal } from '../ui/Modal'
import { moveIndex } from '../ui/navigation'
import { fetchDirectory, formatSize } from './files'

// Modal to choose a file on the server's filesystem, since the application may run on another machine
// than the browser. It lists one directory at a time, filtered by extension; double click or Enter opens
// a directory or chooses a file. Its state is transient and lives in the component.

export interface FileExplorerModalProps {
	// Whether the modal is shown.
	readonly open: boolean
	// Modal title.
	readonly title: string
	// Directory shown first; falls back to the server's working directory when it cannot be listed.
	readonly initialPath?: string
	// Extensions of the files listed (lowercase, without the dot); every directory is listed.
	readonly extensions: readonly string[]
	// Receives the chosen file and the directory it is in; the modal stays open until onClose.
	readonly onChoose: (path: string, directory: string) => void
	// Hides the modal.
	readonly onClose: () => void
}

// Server file chooser.
export function FileExplorerModal({ open, title, initialPath, extensions, onChoose, onClose }: FileExplorerModalProps) {
	const [listing, setListing] = useState<DirectoryListing>()
	const [typed, setTyped] = useState('')
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState<string>()
	const [selected, setSelected] = useState<string>()
	const request = useRef<AbortController>(undefined)
	const listRef = useRef<HTMLUListElement>(null)

	// Lists a directory; a newer request aborts an older one. When fallback is set, a failure lists it
	// instead (used when the remembered directory no longer exists).
	async function browse(path: string, fallback?: string) {
		request.current?.abort()
		const controller = new AbortController()
		request.current = controller
		setLoading(true)
		setError(undefined)

		try {
			const result = await fetchDirectory(path, extensions, controller.signal)
			setListing(result)
			setTyped(result.path)
			setSelected(undefined)
		} catch (e) {
			if (controller.signal.aborted) return
			if (fallback !== undefined) return await browse(fallback)
			setError(e instanceof Error ? e.message : 'Unable to reach the server')
		} finally {
			if (request.current === controller) setLoading(false)
		}
	}

	useEffect(() => {
		if (!open) return
		void browse(initialPath ?? '.', initialPath === undefined ? undefined : '.')
		return () => request.current?.abort()
	}, [open])

	function activate(entry: FileEntry) {
		if (entry.directory) void browse(entry.path)
		else if (listing) onChoose(entry.path, listing.path)
	}

	function handleListKeyDown(e: KeyboardEvent<HTMLUListElement>) {
		const entries = listing?.entries ?? []
		const index = moveIndex(
			entries.findIndex((entry) => entry.path === selected),
			entries.length,
			e.key === 'ArrowLeft' || e.key === 'ArrowRight' ? '' : e.key,
		)

		if (index !== undefined) {
			e.preventDefault()
			setSelected(entries[index]?.path)
			listRef.current?.children[index]?.scrollIntoView({ block: 'nearest' })
		} else if (e.key === 'Enter') {
			const entry = entries.find((candidate) => candidate.path === selected)
			if (!entry) return
			e.preventDefault()
			activate(entry)
		} else if (e.key === 'Backspace' && listing?.parent !== undefined) {
			e.preventDefault()
			void browse(listing.parent)
		}
	}

	const chosen = listing?.entries.find((entry) => entry.path === selected && !entry.directory)

	return (
		<Modal open={open} onClose={onClose} title={title} fit className="max-w-3xl">
			<form
				className="flex items-center gap-2"
				onSubmit={(e) => {
					e.preventDefault()
					void browse(typed.trim())
				}}
			>
				<IconButton icon="arrow" label="Parent directory (Backspace)" disabled={listing?.parent === undefined} onClick={() => listing?.parent !== undefined && void browse(listing.parent)} />
				<input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Path on the server" spellCheck={false} className={inputClassName} />
				<Button type="submit" size="sm" variant="secondary">
					Go
				</Button>
			</form>
			<div className="mt-3 h-[min(26rem,calc(100dvh-16rem))] min-h-32 overflow-y-auto overscroll-contain rounded-sm border border-line-100 bg-base-100">
				{error ? (
					<p className="m-0 p-6 text-center text-[13px] text-danger">{error}</p>
				) : listing && listing.entries.length === 0 ? (
					<p className="m-0 p-6 text-center text-[13px] text-ink-300">{loading ? 'Loading…' : 'No folders or images here.'}</p>
				) : (
					<ul ref={listRef} tabIndex={0} onKeyDown={handleListKeyDown} className={cn('m-0 list-none p-1 outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent', loading && 'opacity-60')}>
						{listing?.entries.map((entry) => (
							<li key={entry.path}>
								<button
									type="button"
									tabIndex={-1}
									onClick={() => setSelected(entry.path)}
									onDoubleClick={() => activate(entry)}
									className={cn('flex w-full cursor-pointer items-center gap-3 rounded-sm border-0 px-2 py-1.5 text-left font-mono text-[13px] leading-5', entry.path === selected ? 'bg-accent-subtle text-accent' : 'bg-transparent text-ink-100 hover:bg-base-300')}
								>
									<Icon name={entry.directory ? 'folder' : 'file'} className={cn('size-4', entry.directory ? 'text-ink-200' : 'text-ink-300')} />
									<span className="min-w-0 flex-1 truncate">{entry.name}</span>
									{entry.size !== undefined && <span className="flex-none text-xs text-ink-300 tabular-nums">{formatSize(entry.size)}</span>}
								</button>
							</li>
						))}
					</ul>
				)}
			</div>
			<div className="mt-4 flex items-center justify-end gap-2">
				<span className="mr-auto min-w-0 truncate text-[13px] text-ink-300">{chosen ? chosen.name : 'Choose an image file'}</span>
				<Button variant="secondary" size="sm" onClick={onClose}>
					Cancel
				</Button>
				<Button size="sm" disabled={!chosen} onClick={() => chosen && listing && onChoose(chosen.path, listing.path)}>
					Open
				</Button>
			</div>
		</Modal>
	)
}
