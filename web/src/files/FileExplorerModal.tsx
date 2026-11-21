import type { DirectoryListing, FileEntry } from 'api'
import { cn } from 'cn'
import { type KeyboardEvent, useEffect, useRef, useState } from 'react'
import { formatByteSize } from '../format'
import { Button } from '../ui/Button'
import { inputClassName } from '../ui/Field'
import { Icon } from '../ui/Icon'
import { IconButton } from '../ui/IconButton'
import { Modal } from '../ui/Modal'
import { moveIndex } from '../ui/navigation'
import { createDirectory, fetchDirectory, joinPath } from './files'

// Modal to choose a file on the server's filesystem, since the application may run on another machine
// than the browser. It lists one directory at a time, filtered by extension; double click or Enter opens
// a directory or chooses a file. In save mode a file name is typed (clicking a listed file copies its
// name) and the chosen path is that name in the listed directory, whether or not it exists. In directory
// mode only directories are listed, and the chosen path is the selected directory or, with none selected,
// the listed one. With `multiple` in open mode, a click checks or unchecks a file of the listed directory, and
// the checked files are chosen together; opening another directory unchecks them. Refresh lists the directory again,
// keeping the selection and the checked files that are still there, and New Folder creates a directory in the listed
// one and selects it. Its state is transient and lives in the component.

// Props of every mode of the chooser.
interface FileExplorerBaseProps {
	// Whether the modal is shown.
	readonly open: boolean
	// Modal title.
	readonly title: string
	// Whether an existing file is opened, a file name is chosen to save to, or a directory is chosen.
	readonly mode?: 'open' | 'save' | 'directory'
	// File name proposed in save mode.
	readonly defaultName?: string
	// Whether the choice is being acted on, which disables the confirm button.
	readonly busy?: boolean
	// Failure of acting on the choice, shown above the buttons.
	readonly message?: string
	// Directory shown first; falls back to the server's working directory when it cannot be listed.
	readonly initialPath?: string
	// Extensions of the files listed (lowercase, without the dot); every file when absent. Every directory
	// is listed; files are not listed in directory mode.
	readonly extensions?: readonly string[]
	// Hides the modal.
	readonly onClose: () => void
}

// One file or directory chosen at a time.
interface SingleChoiceProps {
	readonly multiple?: false
	// Receives the chosen file or directory and the listed directory; the modal stays open until onClose.
	readonly onChoose: (path: string, directory: string) => void
}

// Several files of one directory chosen at once, in open mode.
interface MultipleChoiceProps {
	readonly multiple: true
	// Receives the checked files, in listing order, and the listed directory; the modal stays open until onClose.
	readonly onChoose: (paths: readonly string[], directory: string) => void
}

export type FileExplorerModalProps = FileExplorerBaseProps & (SingleChoiceProps | MultipleChoiceProps)

// How a listing treats what was selected.
interface BrowseOptions {
	// Directory listed when the requested one cannot be.
	readonly fallback?: string
	// Whether the selection and the checked files still listed are kept.
	readonly keep?: boolean
	// Path of the entry selected once listed.
	readonly select?: string
}

// Server file chooser.
export function FileExplorerModal(props: FileExplorerModalProps) {
	const { open, title, mode = 'open', defaultName = '', busy = false, message, initialPath, extensions, onClose } = props
	const [listing, setListing] = useState<DirectoryListing>()
	const [typed, setTyped] = useState('')
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState<string>()
	const [selected, setSelected] = useState<string>()
	// Files checked in multiple mode, by path.
	const [checked, setChecked] = useState<ReadonlySet<string>>(new Set())
	// File name typed in save mode.
	const [name, setName] = useState(defaultName)
	// Name of the folder being created in the listed directory; absent while none is.
	const [folder, setFolder] = useState<string>()
	// Whether the folder is being created on the server.
	const [creating, setCreating] = useState(false)
	// Why the folder could not be created.
	const [folderError, setFolderError] = useState<string>()
	const request = useRef<AbortController>(undefined)
	const listRef = useRef<HTMLUListElement>(null)
	const folderRef = useRef<HTMLInputElement>(null)
	const naming = folder !== undefined
	const saving = mode === 'save'
	const choosingDirectory = mode === 'directory'
	const multiple = props.multiple === true && mode === 'open'
	// Entries shown: the directories only in directory mode.
	const entries = (choosingDirectory ? listing?.entries.filter((entry) => entry.directory) : listing?.entries) ?? []

	// Lists a directory; a newer request aborts an older one. When fallback is set, a failure lists it
	// instead (used when the remembered directory no longer exists). The selection and the checked files are cleared,
	// unless keep keeps those still listed; select selects an entry instead.
	async function browse(path: string, { fallback, keep = false, select }: BrowseOptions = {}) {
		const kept = keep ? { selected, checked } : undefined
		request.current?.abort()
		const controller = new AbortController()
		request.current = controller
		setLoading(true)
		setError(undefined)

		try {
			const result = await fetchDirectory(path, extensions, controller.signal)
			const listed = new Set(result.entries.map((entry) => entry.path))
			setListing(result)
			setTyped(result.path)
			setSelected(select ?? (kept?.selected !== undefined && listed.has(kept.selected) ? kept.selected : undefined))
			setChecked(new Set(kept ? [...kept.checked].filter((path) => listed.has(path)) : []))
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
		setFolder(undefined)
		setFolderError(undefined)
		void browse(initialPath ?? '.', initialPath === undefined ? {} : { fallback: '.' })
		return () => request.current?.abort()
	}, [open])

	useEffect(() => {
		if (naming) folderRef.current?.focus()
	}, [naming])

	// Creates the folder named in the listed directory, then lists it again with the new folder selected.
	async function createFolder() {
		const folderName = folder?.trim()
		if (!folderName || !listing?.path || creating) return
		setCreating(true)
		setFolderError(undefined)

		try {
			const created = await createDirectory(listing.path, folderName)
			setFolder(undefined)
			await browse(listing.path, { select: created.path })
		} catch (e) {
			setFolderError(e instanceof Error ? e.message : 'Unable to reach the server')
		} finally {
			setCreating(false)
		}
	}

	// Stops naming a folder.
	function cancelFolder() {
		setFolder(undefined)
		setFolderError(undefined)
	}

	// Hands the chosen paths to the caller, in the shape of its mode.
	function choose(paths: readonly string[], directory: string) {
		if (props.multiple === true) props.onChoose(paths, directory)
		else if (paths.length > 0) props.onChoose(paths[0], directory)
	}

	function activate(entry: FileEntry) {
		if (entry.directory) void browse(entry.path)
		else if (multiple) toggle(entry)
		else if (listing) choose([entry.path], listing.path)
	}

	// Checks or unchecks a file in multiple mode, and moves the selection to it.
	function toggle(entry: FileEntry) {
		const next = new Set(checked)
		if (next.has(entry.path)) next.delete(entry.path)
		else next.add(entry.path)
		setChecked(next)
		setSelected(entry.path)
	}

	// Selects an entry; in save mode a file also gives its name.
	function select(entry: FileEntry) {
		setSelected(entry.path)
		if (saving && !entry.directory) setName(entry.name)
	}

	function handleListKeyDown(e: KeyboardEvent<HTMLUListElement>) {
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
	// Files listed, and those checked in multiple mode, in listing order.
	const files = entries.filter((entry) => !entry.directory)
	const chosenFiles = files.filter((entry) => checked.has(entry.path)).map((entry) => entry.path)
	// Name typed in save mode, trimmed; a listing of drives has no directory to save in.
	const fileName = name.trim()
	const saveDirectory = listing?.path ? listing.path : undefined
	// Directory chosen in directory mode: the selected one, or else the listed one (none for the drives).
	const chosenDirectory = choosingDirectory ? (entries.find((entry) => entry.path === selected)?.path ?? saveDirectory) : undefined

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
				<input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Path on the server" autoCapitalize="off" className={inputClassName} />
				<Button type="submit" variant="secondary">
					Go
				</Button>
				<IconButton icon="refresh" label="Refresh" disabled={loading} onClick={() => void browse(listing ? listing.path : typed.trim(), { keep: true })} />
				<IconButton icon="newFolder" label="New folder" pressed={naming} disabled={!listing?.path} onClick={() => (naming ? cancelFolder() : setFolder(''))} />
			</form>
			{naming && (
				<form
					className="mt-2 flex items-center gap-2"
					onSubmit={(e) => {
						e.preventDefault()
						void createFolder()
					}}
				>
					<label className="flex-none text-sm text-ink-300">Folder name</label>
					<input
						ref={folderRef}
						value={folder}
						onChange={(e) => setFolder(e.target.value)}
						onKeyDown={(e) => {
							// Escape stops naming the folder without closing the chooser.
							if (e.key !== 'Escape') return
							e.preventDefault()
							e.stopPropagation()
							cancelFolder()
						}}
						className={inputClassName}
					/>
					<Button type="submit" disabled={!folder.trim() || creating}>
						{creating ? 'Creating…' : 'Create'}
					</Button>
					<Button variant="secondary" onClick={cancelFolder}>
						Cancel
					</Button>
				</form>
			)}
			{folderError && <p className="m-0 mt-2 text-sm text-danger">{folderError}</p>}
			<div className="mt-3 h-[min(26rem,calc(100dvh-16rem))] min-h-32 overflow-y-auto overscroll-contain rounded-sm border border-line-100 bg-base-100">
				{error ? (
					<p className="m-0 p-6 text-center text-sm text-danger">{error}</p>
				) : listing && entries.length === 0 ? (
					<p className="m-0 p-6 text-center text-sm text-ink-300">{loading ? 'Loading…' : choosingDirectory ? 'No folders here.' : 'No folders or images here.'}</p>
				) : (
					<ul ref={listRef} tabIndex={0} onKeyDown={handleListKeyDown} className={cn('m-0 list-none p-1 outline-hidden focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-2 focus-visible:outline-accent', loading && 'opacity-60')}>
						{entries.map((entry) => (
							<li key={entry.path}>
								<button
									type="button"
									tabIndex={-1}
									onClick={() => (multiple && !entry.directory ? toggle(entry) : select(entry))}
									onDoubleClick={() => (!multiple || entry.directory) && activate(entry)}
									className={cn(
										'flex w-full cursor-pointer items-center gap-3 rounded-sm border-0 px-2 py-1.5 text-left font-mono text-sm leading-5',
										(multiple ? checked.has(entry.path) : entry.path === selected) ? 'bg-accent-subtle text-accent' : 'bg-transparent text-ink-100 hover:bg-base-300',
										multiple && entry.path === selected && 'outline-1 -outline-offset-1 outline-line-200',
									)}
								>
									<Icon name={entry.directory ? 'folder' : 'file'} className={cn('size-4', entry.directory ? 'text-ink-200' : 'text-ink-300')} />
									<span className="min-w-0 flex-1 truncate">{entry.name}</span>
									{entry.size !== undefined && <span className="flex-none text-xs text-ink-300 tabular-nums">{formatByteSize(entry.size)}</span>}
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
						if (fileName && saveDirectory && !busy) choose([joinPath(saveDirectory, fileName)], saveDirectory)
					}}
				>
					<label className="flex-none text-sm text-ink-300">File name</label>
					<input value={name} onChange={(e) => setName(e.target.value)} data-autofocus className={inputClassName} />
				</form>
			)}
			{message && <p className="m-0 mt-3 text-sm text-danger">{message}</p>}
			<div className="mt-4 flex items-center justify-end gap-2">
				<span className="mr-auto min-w-0 truncate text-sm text-ink-300">
					{choosingDirectory ? (chosenDirectory ?? 'Choose a folder') : saving ? (saveDirectory ? `Saving in ${saveDirectory}` : 'Choose a folder') : multiple ? (chosenFiles.length > 0 ? `${chosenFiles.length} of ${files.length} files` : 'Choose image files') : chosen ? chosen.name : 'Choose an image file'}
				</span>
				{multiple && (
					<>
						<Button variant="secondary" disabled={chosenFiles.length === files.length} onClick={() => setChecked(new Set(files.map((entry) => entry.path)))}>
							Select All
						</Button>
						<Button variant="secondary" disabled={chosenFiles.length === 0} onClick={() => setChecked(new Set())}>
							Select None
						</Button>
					</>
				)}
				<Button variant="secondary" onClick={onClose}>
					Cancel
				</Button>
				{choosingDirectory ? (
					<Button disabled={!chosenDirectory || busy} onClick={() => chosenDirectory && listing && choose([chosenDirectory], listing.path)}>
						Select
					</Button>
				) : saving ? (
					<Button disabled={!fileName || !saveDirectory || busy} onClick={() => saveDirectory && choose([joinPath(saveDirectory, fileName)], saveDirectory)}>
						{busy ? 'Saving…' : 'Save'}
					</Button>
				) : multiple ? (
					<Button disabled={chosenFiles.length === 0 || busy} onClick={() => listing && choose(chosenFiles, listing.path)}>
						Open
					</Button>
				) : (
					<Button disabled={!chosen} onClick={() => chosen && listing && choose([chosen.path], listing.path)}>
						Open
					</Button>
				)}
			</div>
		</Modal>
	)
}
