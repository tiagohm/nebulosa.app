import type { DirectoryListing, FileEntry } from 'api'
import { cn } from 'cn'
import { type KeyboardEvent, useEffect, useRef, useState } from 'react'
import { Button } from '../ui/Button'
import { inputClassName } from '../ui/Field'
import { Icon } from '../ui/Icon'
import { IconButton } from '../ui/IconButton'
import { Modal } from '../ui/Modal'
import { moveIndex } from '../ui/navigation'
import { fetchDirectory, formatSize, joinPath } from './files'

// Modal to choose a file on the server's filesystem, since the application may run on another machine
// than the browser. It lists one directory at a time, filtered by extension; double click or Enter opens
// a directory or chooses a file. In save mode a file name is typed (clicking a listed file copies its
// name) and the chosen path is that name in the listed directory, whether or not it exists. Its state is
// transient and lives in the component.

export interface FileExplorerModalProps {
	// Whether the modal is shown.
	readonly open: boolean
	// Modal title.
	readonly title: string
	// Whether an existing file is opened or a file name is chosen to save to.
	readonly mode?: 'open' | 'save'
	// File name proposed in save mode.
	readonly defaultName?: string
	// Whether the choice is being acted on, which disables the confirm button.
	readonly busy?: boolean
	// Failure of acting on the choice, shown above the buttons.
	readonly message?: string
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
export function FileExplorerModal({ open, title, mode = 'open', defaultName = '', busy = false, message, initialPath, extensions, onChoose, onClose }: FileExplorerModalProps) {
	const [listing, setListing] = useState<DirectoryListing>()
	const [typed, setTyped] = useState('')
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState<string>()
	const [selected, setSelected] = useState<string>()
	// File name typed in save mode.
	const [name, setName] = useState(defaultName)
	const request = useRef<AbortController>(undefined)
	const listRef = useRef<HTMLUListElement>(null)
	const saving = mode === 'save'

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
		setName(defaultName)
		void browse(initialPath ?? '.', initialPath === undefined ? undefined : '.')
		return () => request.current?.abort()
	}, [open])

	function activate(entry: FileEntry) {
		if (entry.directory) void browse(entry.path)
		else if (listing) onChoose(entry.path, listing.path)
	}

	// Selects an entry; in save mode a file also gives its name.
	function select(entry: FileEntry) {
		setSelected(entry.path)
		if (saving && !entry.directory) setName(entry.name)
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
			if (entries[index]) select(entries[index])
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
	// Name typed in save mode, trimmed; a listing of drives has no directory to save in.
	const fileName = name.trim()
	const saveDirectory = listing?.path ? listing.path : undefined

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
									onClick={() => select(entry)}
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
			{saving && (
				<form
					className="mt-3 flex items-center gap-2"
					onSubmit={(e) => {
						e.preventDefault()
						if (fileName && saveDirectory && !busy) onChoose(joinPath(saveDirectory, fileName), saveDirectory)
					}}
				>
					<label className="flex-none text-[13px] text-ink-300">File name</label>
					<input value={name} onChange={(e) => setName(e.target.value)} spellCheck={false} data-autofocus className={inputClassName} />
				</form>
			)}
			{message && <p className="m-0 mt-3 text-[13px] text-danger">{message}</p>}
			<div className="mt-4 flex items-center justify-end gap-2">
				<span className="mr-auto min-w-0 truncate text-[13px] text-ink-300">{saving ? (saveDirectory ? `Saving in ${saveDirectory}` : 'Choose a folder') : chosen ? chosen.name : 'Choose an image file'}</span>
				<Button variant="secondary" size="sm" onClick={onClose}>
					Cancel
				</Button>
				{saving ? (
					<Button size="sm" disabled={!fileName || !saveDirectory || busy} onClick={() => saveDirectory && onChoose(joinPath(saveDirectory, fileName), saveDirectory)}>
						{busy ? 'Saving…' : 'Save'}
					</Button>
				) : (
					<Button size="sm" disabled={!chosen} onClick={() => chosen && listing && onChoose(chosen.path, listing.path)}>
						Open
					</Button>
				)}
			</div>
		</Modal>
	)
}
