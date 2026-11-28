import type { DirectoryListing, FileEntry, FilePlaces } from 'api'
import { cn } from 'cn'
import { type KeyboardEvent, type MouseEvent, useEffect, useRef, useState } from 'react'
import { formatByteSize, formatZonedDateTime } from '../format'
import { useActiveTimeZone } from '../location/useLocation'
import { Button, buttonClassName } from '../ui/Button'
import { inputClassName } from '../ui/Field'
import { Icon } from '../ui/Icon'
import { IconButton } from '../ui/IconButton'
import { Modal, ModalActions } from '../ui/Modal'
import { moveIndex } from '../ui/navigation'
import { SortHeader } from '../ui/Table'
import { createDirectory, DEFAULT_ENTRY_ORDER, type EntryOrder, fetchDirectory, fetchPlaces, filterLabel, isHidden, joinPath, nameTaken, sortEntries, splitName } from './files'

// Modal to choose a file on the server's filesystem, since the application may run on another machine than the browser.
// It lists one directory at a time, filtered by extension and without the hidden entries (a name starting with a dot),
// directories first, by name or by modification time. It starts in the directory the caller remembers, else in the
// server's data directory, and offers shortcuts to the remembered directory and the server's places. The list is one Tab
// stop whose cursor the arrow keys, Home, End, and typed letters move; Enter or a double click opens a directory or
// chooses a file, Backspace goes up and selects the directory left, and a tap on a touch screen opens a directory at once.
// In save mode a file name is typed (clicking a listed file copies its name) and the chosen path is that name in the listed
// directory, whether or not it exists. In directory mode only directories are listed, and the chosen path is the selected
// directory or, with none selected, the listed one. With `multiple` in open mode, a click or Space checks or unchecks a
// file, Shift extends the checks from the cursor, and the checked files of every directory visited are chosen together.
// Refresh lists the directory again, keeping the cursor, and New Folder names a directory inline in the list, creates it in
// the listed one and selects it. Its state is transient and lives in the component.

// Props of every mode of the chooser.
interface FileExplorerBaseProps {
	// Whether the modal is shown.
	readonly open: boolean
	// Modal title.
	readonly title: string
	// Whether an existing file is opened, a file name is chosen to save to, or a directory is chosen.
	readonly mode?: 'open' | 'save' | 'directory'
	// Verb of the button that chooses the files in open mode, followed by the number of checked files in multiple mode
	// ("Add 3 Files"); Open when absent.
	readonly action?: string
	// File name proposed in save mode.
	readonly defaultName?: string
	// Whether the choice is being acted on, which disables the confirm button.
	readonly busy?: boolean
	// Failure of acting on the choice, shown above the buttons.
	readonly message?: string
	// Directory shown first and offered as Last Used; falls back to the server's data directory when it is absent or
	// cannot be listed.
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

// Several files chosen at once, in open mode.
interface MultipleChoiceProps {
	readonly multiple: true
	// Receives the checked files, in the order they were checked, and the listed directory; the modal stays open until
	// onClose.
	readonly onChoose: (paths: readonly string[], directory: string) => void
}

export type FileExplorerModalProps = FileExplorerBaseProps & (SingleChoiceProps | MultipleChoiceProps)

// How a listing treats what was selected.
interface BrowseOptions {
	// Directory listed when the requested one cannot be.
	readonly fallback?: string
	// Whether the cursor is kept when its entry is still listed.
	readonly keep?: boolean
	// Path of the entry the cursor is put on once listed.
	readonly select?: string
}

// Shortcut of the chooser: a server place, or the directory the caller remembers.
interface Place {
	// Short name shown on its button.
	readonly name: string
	// Directory listed; empty for the list of drives on Windows.
	readonly path: string
}

// Time a typed letter waits for the next one before the type-ahead starts over, in milliseconds.
const TYPE_AHEAD_TIMEOUT = 700

// Classes of the grid of a listing row and of the header above the rows: the icon or checkbox, the name, and from 640 px
// the modification time and the size, in rem.
const ROW_GRID = 'grid grid-cols-[1rem_minmax(0,1fr)] items-center gap-x-3 sm:grid-cols-[1rem_minmax(0,1fr)_10rem_5rem]'

// Returns the time of an entry's last modification as a list shows it, or an empty text when the server gave none.
function formatModified(entry: FileEntry, timeZone: string): string {
	return entry.modifiedAt ? formatZonedDateTime(Date.parse(entry.modifiedAt), timeZone, false) : ''
}

// Server file chooser.
export function FileExplorerModal(props: FileExplorerModalProps) {
	const { open, title, mode = 'open', action = 'Open', defaultName = '', busy = false, message, initialPath, extensions, onClose } = props
	const timeZone = useActiveTimeZone()
	// Host name, data directory, and shortcuts of the server; absent until fetched or when they cannot be.
	const [places, setPlaces] = useState<FilePlaces>()
	const [listing, setListing] = useState<DirectoryListing>()
	// Path typed in the path field; the listed directory once listed.
	const [typed, setTyped] = useState('')
	const [loading, setLoading] = useState(false)
	// Why the requested directory could not be listed; the last listing stays the one Back returns to.
	const [error, setError] = useState<string>()
	// Path of the entry under the cursor: the selected one, except in multiple mode, where files are checked instead.
	const [selected, setSelected] = useState<string>()
	// Files checked in multiple mode, in the order they were checked, mapped to the directory listing them.
	const [checked, setChecked] = useState<ReadonlyMap<string, string>>(new Map())
	// File name typed in save mode.
	const [name, setName] = useState(defaultName)
	// Name of the folder being created in the listed directory; absent while none is.
	const [folder, setFolder] = useState<string>()
	// Whether the folder is being created on the server.
	const [creating, setCreating] = useState(false)
	// Why the folder could not be created.
	const [folderError, setFolderError] = useState<string>()
	// Order of the listed entries.
	const [order, setOrder] = useState<EntryOrder>(DEFAULT_ENTRY_ORDER)
	const request = useRef<AbortController>(undefined)
	const listRef = useRef<HTMLDivElement>(null)
	const pathRef = useRef<HTMLInputElement>(null)
	const folderRef = useRef<HTMLInputElement>(null)
	// Letters typed for the type-ahead and the time of the last one, in Unix milliseconds.
	const typeAhead = useRef({ text: '', time: 0 })
	const naming = folder !== undefined
	const saving = mode === 'save'
	const choosingDirectory = mode === 'directory'
	const multiple = props.multiple === true && mode === 'open'
	// Entries shown: without the hidden ones, the directories only in directory mode, in the chosen order.
	const entries = sortEntries(listing?.entries.filter((entry) => !isHidden(entry) && (!choosingDirectory || entry.directory)) ?? [], order)

	// Lists a directory; a newer request aborts an older one. When fallback is set, a failure lists it instead (used when
	// the remembered directory no longer exists). The cursor is cleared unless keep keeps it while still listed, or select
	// puts it on an entry. Checked files of the listed directory that are gone are unchecked; those of others stay.
	async function browse(path: string, { fallback, keep = false, select }: BrowseOptions = {}) {
		request.current?.abort()
		const controller = new AbortController()
		request.current = controller
		setLoading(true)
		setError(undefined)
		setTyped(path)

		try {
			const result = await fetchDirectory(path, extensions, controller.signal)
			const listed = new Set(result.entries.map((entry) => entry.path))
			setListing(result)
			setTyped(result.path)
			setSelected((current) => select ?? (keep && current !== undefined && listed.has(current) ? current : undefined))
			setChecked((current) => new Map([...current].filter(([file, directory]) => directory !== result.path || listed.has(file))))
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
		setChecked(new Map())
		const controller = new AbortController()

		// Lists the remembered directory, else the server's data directory, which is also the fallback of a remembered one
		// that is gone; without the places, the server's working directory.
		void (async () => {
			let start: FilePlaces | undefined

			try {
				start = await fetchPlaces(controller.signal)
				setPlaces(start)
			} catch {
				if (controller.signal.aborted) return
			}

			const fallback = start?.data ?? '.'
			await browse(initialPath ?? fallback, initialPath === undefined ? {} : { fallback })
		})()

		return () => {
			controller.abort()
			request.current?.abort()
		}
	}, [open])

	useEffect(() => {
		if (naming) folderRef.current?.focus()
	}, [naming])

	// Shows the end of the listed path, the directory itself, and the row under the cursor, after every listing.
	useEffect(() => {
		const path = pathRef.current
		if (path && document.activeElement !== path) path.scrollLeft = path.scrollWidth
		listRef.current?.querySelector('[data-cursor]')?.scrollIntoView({ block: 'nearest' })
	}, [listing])

	// Whether the typed folder name is taken by an entry of the listed directory, hidden ones included.
	const folderTaken =
		naming &&
		!!listing &&
		nameTaken(
			listing.path,
			folder.trim(),
			listing.entries.map((entry) => entry.name),
		)

	// Creates the folder named in the listed directory, then lists it again with the new folder selected.
	async function createFolder() {
		const folderName = folder?.trim()
		if (!folderName || folderTaken || !listing?.path || creating) return
		setCreating(true)
		setFolderError(undefined)

		try {
			const created = await createDirectory(listing.path, folderName)
			setFolder(undefined)
			listRef.current?.focus()
			await browse(listing.path, { select: created.path })
		} catch (e) {
			setFolderError(e instanceof Error ? e.message : 'Unable to reach the server')
		} finally {
			setCreating(false)
		}
	}

	// Stops naming a folder and gives the focus back to the list.
	function cancelFolder() {
		setFolder(undefined)
		setFolderError(undefined)
		listRef.current?.focus()
	}

	// Goes up to the parent directory, with the cursor on the directory left.
	function goUp() {
		if (listing?.parent !== undefined) void browse(listing.parent, { select: listing.path })
	}

	// Hands the chosen paths to the caller, in the shape of its mode.
	function choose(paths: readonly string[], directory: string) {
		if (props.multiple === true) props.onChoose(paths, directory)
		else if (paths.length > 0) props.onChoose(paths[0], directory)
	}

	// Files listed, the checked files, and those of them listed here.
	const files = entries.filter((entry) => !entry.directory)
	const checkedFiles = [...checked.keys()]
	const checkedHere = files.filter((entry) => checked.has(entry.path)).length

	// Chooses the checked files in multiple mode, or the file under the cursor when none is checked.
	function chooseChecked() {
		if (!listing || busy) return
		const cursor = files.find((entry) => entry.path === selected)
		const paths = checkedFiles.length > 0 ? checkedFiles : cursor ? [cursor.path] : []
		if (paths.length > 0) choose(paths, listing.path)
	}

	// Opens a directory, or chooses a file: alone, with the checked ones in multiple mode, or as the file saved to.
	function activate(entry: FileEntry) {
		if (entry.directory) void browse(entry.path)
		else if (multiple) chooseChecked()
		else if (listing) choose([entry.path], listing.path)
	}

	// Checks or unchecks a file in multiple mode, and moves the cursor to it.
	function toggle(entry: FileEntry) {
		if (!listing) return
		const next = new Map(checked)
		if (next.has(entry.path)) next.delete(entry.path)
		else next.set(entry.path, listing.path)
		setChecked(next)
		setSelected(entry.path)
	}

	// Checks the files from the cursor to an entry, both included, in multiple mode, and moves the cursor to it.
	function checkRange(entry: FileEntry) {
		if (!listing) return
		const from = entries.findIndex((candidate) => candidate.path === selected)
		const to = entries.indexOf(entry)
		const next = new Map(checked)

		for (const candidate of entries.slice(Math.min(from < 0 ? to : from, to), Math.max(from, to) + 1)) {
			if (!candidate.directory) next.set(candidate.path, listing.path)
		}

		setChecked(next)
		setSelected(entry.path)
	}

	// Moves the cursor to an entry; in save mode a file also gives its name.
	function select(entry: FileEntry) {
		setSelected(entry.path)
		if (saving && !entry.directory) setName(entry.name)
	}

	// Handles a click on a row: a tap opens a directory, a click in multiple mode checks a file (Shift checks the range
	// from the cursor), a click on the selected directory in directory mode unselects it, and any other click selects.
	// The focus moves to the list so its keys act on the row clicked.
	function handleRowClick(e: MouseEvent<HTMLButtonElement>, entry: FileEntry) {
		listRef.current?.focus({ preventScroll: true })
		const tapped = (e.nativeEvent as PointerEvent).pointerType === 'touch'

		if (entry.directory && tapped) void browse(entry.path)
		else if (multiple && !entry.directory && e.shiftKey) checkRange(entry)
		else if (multiple && !entry.directory) toggle(entry)
		else if (choosingDirectory && entry.path === selected) setSelected(undefined)
		else select(entry)
	}

	// Moves the cursor to the next entry whose name starts with the letters typed in a row, starting after the cursor when
	// a single letter is repeated, so pressing it again cycles through the names starting with it.
	function typeToFind(key: string) {
		const now = Date.now()
		const state = typeAhead.current
		state.text = now - state.time > TYPE_AHEAD_TIMEOUT ? key : state.text + key
		state.time = now
		const text = state.text.toLowerCase()
		const repeated = text.split('').every((letter) => letter === text[0])
		const prefix = repeated ? text[0] : text
		const current = entries.findIndex((entry) => entry.path === selected)
		const start = repeated ? current + 1 : Math.max(current, 0)

		for (let i = 0; i < entries.length; i++) {
			const entry = entries[(start + i) % entries.length]

			if (entry.name.toLowerCase().startsWith(prefix)) {
				select(entry)
				listRef.current?.querySelector(`[data-path="${CSS.escape(entry.path)}"]`)?.scrollIntoView({ block: 'nearest' })
				return
			}
		}
	}

	function handleListKeyDown(e: KeyboardEvent<HTMLDivElement>) {
		// Keys typed in the folder name belong to it.
		if (e.target instanceof HTMLInputElement) return
		const current = entries.findIndex((entry) => entry.path === selected)
		const index = moveIndex(current, entries.length, e.key === 'ArrowLeft' || e.key === 'ArrowRight' ? '' : e.key)
		const entry = entries[current]

		if (index !== undefined) {
			e.preventDefault()
			const target = entries[index]
			if (multiple && e.shiftKey && !target.directory && listing) setChecked(new Map(checked).set(target.path, checked.get(target.path) ?? listing.path))
			select(target)
			listRef.current?.querySelector(`[data-path="${CSS.escape(target.path)}"]`)?.scrollIntoView({ block: 'nearest' })
		} else if (e.key === 'Enter') {
			if (!entry && !(multiple && checkedFiles.length > 0)) return
			e.preventDefault()
			if (entry) activate(entry)
			else chooseChecked()
		} else if (e.key === ' ') {
			e.preventDefault()
			if (entry && multiple && !entry.directory) toggle(entry)
		} else if (e.key === 'Backspace') {
			e.preventDefault()
			goUp()
		} else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
			e.preventDefault()
			typeToFind(e.key)
		}
	}

	const chosen = entries.find((entry) => entry.path === selected && !entry.directory)
	// Name typed in save mode, trimmed; a listing of drives has no directory to save in.
	const fileName = name.trim()
	const saveDirectory = listing?.path ? listing.path : undefined
	// Directory chosen in directory mode: the selected one, or else the listed one (none for the drives).
	const chosenDirectory = choosingDirectory ? (entries.find((entry) => entry.path === selected)?.path ?? saveDirectory) : undefined
	// Extensions listed, as the operator reads them; absent when every file is.
	const filter = extensions && extensions.length > 0 ? filterLabel(extensions) : undefined
	// Shortcuts: the remembered directory, unless it is one of the server's places, then those places.
	const shortcuts: readonly Place[] = [...(initialPath && !places?.places.some((place) => place.path === initialPath) ? [{ name: 'Last Used', path: initialPath }] : []), ...(places?.places ?? [])]

	// Text of the footer: what the confirm button acts on, or what to choose.
	const status = choosingDirectory
		? (chosenDirectory ?? 'Choose a folder')
		: saving
			? saveDirectory
				? `Saving in ${saveDirectory}`
				: 'Choose a folder'
			: multiple
				? checkedFiles.length === 0
					? `Check the ${filter ? `${filter} ` : ''}files to ${action.toLowerCase()}`
					: checkedFiles.length === checkedHere
						? `${checkedHere} of ${files.length} checked`
						: files.length === 0
							? `${checkedFiles.length} checked in other folders`
							: `${checkedFiles.length} checked, ${checkedHere} of ${files.length} here`
				: (chosen?.name ?? `Choose a ${filter ? `${filter} ` : ''}file`)

	return (
		<Modal open={open} onClose={onClose} title={title} fit className="max-w-3xl">
			<form
				className="flex items-center gap-2"
				onSubmit={(e) => {
					e.preventDefault()
					void browse(typed.trim())
				}}
			>
				<IconButton icon="arrow" label={listing?.parent === undefined ? 'Parent directory: this is the top' : 'Parent directory (Backspace)'} disabled={listing?.parent === undefined || !!error} onClick={goUp} className="pointer-coarse:size-[44px]" />
				<input
					ref={pathRef}
					value={typed}
					onChange={(e) => setTyped(e.target.value)}
					placeholder={places ? (listing?.path === '' ? `Drives of ${places.host}` : `Path on ${places.host}`) : 'Path on the server'}
					title="Press Enter to list this path"
					enterKeyHint="go"
					autoCapitalize="off"
					spellCheck={false}
					className={cn(inputClassName, 'pointer-coarse:h-[44px]')}
				/>
				<IconButton icon="refresh" label="Refresh" disabled={loading || !listing} onClick={() => listing && void browse(listing.path, { keep: true })} className="pointer-coarse:size-[44px]" />
				<IconButton icon="newFolder" label={listing?.path ? 'New folder' : 'New folder: choose a drive first'} pressed={naming} disabled={!listing?.path || !!error} onClick={() => (naming ? cancelFolder() : setFolder(''))} className="pointer-coarse:size-[44px]" />
			</form>
			{shortcuts.length > 0 && (
				<div className="no-scrollbar -mx-1 mt-2 flex flex-none gap-1.5 overflow-x-auto px-1 pb-0.5">
					{shortcuts.map((place) => (
						<button
							key={place.name}
							type="button"
							title={place.path || place.name}
							onClick={() => void browse(place.path)}
							className={buttonClassName({
								variant: 'secondary',
								size: 'sm',
								className: cn('flex-none pointer-coarse:min-h-[44px]', listing?.path === place.path && !error ? 'border-ink-300 bg-base-300' : 'text-ink-200'),
							})}
						>
							{place.name}
						</button>
					))}
				</div>
			)}
			<div
				ref={listRef}
				tabIndex={0}
				data-autofocus={saving ? undefined : true}
				onKeyDown={handleListKeyDown}
				className="mt-3 h-[min(26rem,calc(100dvh-19rem))] min-h-40 overflow-y-auto overscroll-contain rounded-sm border border-line-100 bg-base-100 outline-hidden focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
			>
				{error ? (
					<div className="flex flex-col items-center gap-3 p-6 text-center">
						<p className="m-0 text-sm break-all text-danger">{error}</p>
						{listing && (
							<Button variant="secondary" onClick={() => void browse(listing.path)}>
								Back to {listing.path || 'Drives'}
							</Button>
						)}
					</div>
				) : !listing ? (
					<p className="m-0 p-6 text-center text-sm text-ink-300">Loading…</p>
				) : (
					<>
						<div className={cn(ROW_GRID, 'sticky top-0 z-1 border-b border-line-100 bg-base-100 px-3 py-1.5')}>
							<span />
							<span>
								<SortHeader direction={order.by === 'name' ? (order.descending ? 'down' : 'up') : undefined} title={order.by === 'name' ? 'Reverse the order of the names' : 'Order by name'} onClick={() => setOrder({ by: 'name', descending: order.by === 'name' && !order.descending })}>
									Name
								</SortHeader>
							</span>
							<span className="max-sm:hidden">
								<SortHeader
									direction={order.by === 'modified' ? (order.descending ? 'down' : 'up') : undefined}
									title={order.by === 'modified' ? 'Reverse the order of the times' : 'Order by modification time, newest first'}
									onClick={() => setOrder({ by: 'modified', descending: order.by !== 'modified' || !order.descending })}
								>
									Modified
								</SortHeader>
							</span>
							<span className="text-right text-xs font-medium text-ink-300 max-sm:hidden">Size</span>
						</div>
						{naming && (
							<form
								className="border-b border-line-100 px-2 py-2"
								onSubmit={(e) => {
									e.preventDefault()
									void createFolder()
								}}
							>
								<div className="flex items-center gap-2">
									<Icon name="newFolder" className="ml-1 size-4 flex-none text-ink-200" />
									<input
										ref={folderRef}
										value={folder}
										placeholder="New folder name"
										onChange={(e) => {
											setFolder(e.target.value)
											setFolderError(undefined)
										}}
										onKeyDown={(e) => {
											// Escape stops naming the folder without closing the chooser.
											if (e.key !== 'Escape') return
											e.preventDefault()
											e.stopPropagation()
											cancelFolder()
										}}
										autoCapitalize="off"
										spellCheck={false}
										className={cn(inputClassName, 'pointer-coarse:h-[44px]')}
									/>
									<Button type="submit" variant="secondary" disabled={!folder.trim() || folderTaken || creating} title={folderTaken ? 'A file or folder already has this name' : undefined}>
										{creating ? 'Creating…' : 'Create'}
									</Button>
									<Button variant="secondary" onClick={cancelFolder}>
										Cancel
									</Button>
								</div>
								{(folderTaken || folderError) && <p className="m-0 mt-1.5 ml-7 text-sm break-all text-danger">{folderTaken ? `${folder.trim()} already exists here.` : folderError}</p>}
							</form>
						)}
						{entries.length === 0 ? (
							<p className="m-0 p-6 text-center text-sm text-ink-300">{loading ? 'Loading…' : choosingDirectory ? 'No folders here.' : filter ? `No folders or ${filter} files here.` : 'This folder is empty.'}</p>
						) : (
							<ul className={cn('m-0 list-none p-1 transition-opacity duration-150 motion-reduce:transition-none', loading && 'opacity-60')}>
								{entries.map((entry) => {
									const cursor = entry.path === selected
									const isChecked = checked.has(entry.path)
									const [head, tail] = splitName(entry.name)
									const modified = formatModified(entry, timeZone)
									const size = entry.size !== undefined ? formatByteSize(entry.size) : ''

									return (
										<li key={entry.path}>
											<button
												type="button"
												tabIndex={-1}
												data-path={entry.path}
												data-cursor={cursor || undefined}
												title={entry.name}
												onClick={(e) => handleRowClick(e, entry)}
												onDoubleClick={() => (!multiple || entry.directory) && activate(entry)}
												className={cn(
													ROW_GRID,
													'w-full cursor-pointer rounded-sm border-0 px-2 py-1.5 text-left font-mono text-sm leading-5 select-none pointer-coarse:min-h-[44px]',
													multiple && !entry.directory
														? cn(isChecked ? 'bg-accent-subtle text-ink-100' : 'bg-transparent text-ink-100 hover:bg-base-300', cursor && 'outline-1 -outline-offset-1 outline-line-200')
														: cursor
															? 'bg-accent-subtle text-accent'
															: 'bg-transparent text-ink-100 hover:bg-base-300',
												)}
											>
												{multiple && !entry.directory ? (
													<span className={cn('flex size-3.5 items-center justify-center justify-self-center rounded-[3px] border', isChecked ? 'border-accent bg-accent text-on-accent' : 'border-line-200 bg-base-200')}>
														{isChecked && <Icon name="check" strokeWidth={3} className="size-3" />}
													</span>
												) : (
													<Icon name={entry.directory ? 'folder' : 'file'} className={cn('size-4', cursor ? 'text-accent' : entry.directory ? 'text-ink-200' : 'text-ink-300')} />
												)}
												<span className="flex min-w-0">
													<span className="truncate">{head}</span>
													{tail && <span className="flex-none whitespace-pre">{tail}</span>}
												</span>
												{(modified || size) && <span className="col-start-2 truncate text-xs leading-4 text-ink-300 tabular-nums sm:hidden">{[modified, size].filter(Boolean).join(' · ')}</span>}
												<span className="truncate text-xs text-ink-300 tabular-nums max-sm:hidden">{modified}</span>
												<span className="text-right text-xs text-ink-300 tabular-nums max-sm:hidden">{size}</span>
											</button>
										</li>
									)
								})}
							</ul>
						)}
					</>
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
					<input value={name} onChange={(e) => setName(e.target.value)} data-autofocus autoCapitalize="off" spellCheck={false} className={cn(inputClassName, 'pointer-coarse:h-[44px]')} />
				</form>
			)}
			{message && <p className="m-0 mt-3 text-sm text-danger">{message}</p>}
			<ModalActions>
				<span className="min-w-0 basis-full truncate self-center text-sm text-ink-300 tabular-nums sm:mr-auto sm:basis-0 sm:grow" title={status}>
					{status}
				</span>
				{multiple && (
					<>
						<Button variant="secondary" disabled={files.length === 0 || checkedHere === files.length} onClick={() => listing && setChecked(new Map([...checked, ...files.map((entry) => [entry.path, listing.path] as const)]))}>
							Select All
						</Button>
						<Button variant="secondary" disabled={checkedFiles.length === 0} onClick={() => setChecked(new Map())}>
							Select None
						</Button>
					</>
				)}
				<Button variant="secondary" onClick={onClose}>
					Cancel
				</Button>
				{choosingDirectory ? (
					<Button disabled={!chosenDirectory || busy} title={chosenDirectory ? undefined : 'Open a drive first'} onClick={() => chosenDirectory && listing && choose([chosenDirectory], listing.path)}>
						Use This Folder
					</Button>
				) : saving ? (
					<Button disabled={!fileName || !saveDirectory || busy} title={!saveDirectory ? 'Open a folder to save in' : !fileName ? 'Type a file name' : undefined} onClick={() => saveDirectory && choose([joinPath(saveDirectory, fileName)], saveDirectory)}>
						{busy ? 'Saving…' : 'Save'}
					</Button>
				) : multiple ? (
					<Button disabled={checkedFiles.length === 0 || busy} title={checkedFiles.length === 0 ? 'Check the files first' : undefined} onClick={chooseChecked}>
						{checkedFiles.length === 0 ? `${action} Files` : `${action} ${checkedFiles.length} ${checkedFiles.length === 1 ? 'File' : 'Files'}`}
					</Button>
				) : (
					<Button disabled={!chosen} title={chosen ? undefined : 'Select a file first'} onClick={() => chosen && listing && choose([chosen.path], listing.path)}>
						{action}
					</Button>
				)}
			</ModalActions>
		</Modal>
	)
}
