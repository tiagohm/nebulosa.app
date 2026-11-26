import type { CreateDirectoryRequest, DirectoryListing, FileEntry, FilePlaces } from 'api'
import { jsonInit, responseError } from '../http'

// Client of the server's file browsing API, used to choose files the server reads and to create the directories it
// saves in, and the pure helpers that order and show the entries of a listing.

// Extensions of the astronomical image files the Images workspace opens.
export const IMAGE_EXTENSIONS: readonly string[] = ['fit', 'fits', 'fts', 'xisf']

// Order of the entries of a listing: by name, or by the time of their last modification; directories always come first.
export interface EntryOrder {
	// Property the entries are ordered by.
	readonly by: 'name' | 'modified'
	// Whether the order is reversed: Z to A, or the newest first.
	readonly descending: boolean
}

// Order of a listing until the operator picks another: by name, A to Z, as the server sends it.
export const DEFAULT_ENTRY_ORDER: EntryOrder = { by: 'name', descending: false }

// Sorts names the way file managers do: case-insensitive, with numbers in numeric order.
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

// Longest end of a name kept whole by splitName, in characters.
const MAX_NAME_TAIL = 16

// Lists a server directory; empty lists the drives on Windows. When extensions is given, only files with
// one of them are listed, along with every directory. Throws an Error with the server's message when
// the directory cannot be listed, and an AbortError when signal aborts.
export async function fetchDirectory(path: string, extensions?: readonly string[], signal?: AbortSignal): Promise<DirectoryListing> {
	const params = new URLSearchParams({ path })
	if (extensions) params.set('extensions', extensions.join(','))
	const response = await fetch(`/api/files?${params}`, { signal })
	if (!response.ok) throw new Error(await responseError(response))
	return (await response.json()) as DirectoryListing
}

// Fetches the name of the server's machine, its data directory, and the shortcuts of a chooser. Throws an Error with the
// server's message when it fails, and an AbortError when signal aborts.
export async function fetchPlaces(signal?: AbortSignal): Promise<FilePlaces> {
	const response = await fetch('/api/files/places', { signal })
	if (!response.ok) throw new Error(await responseError(response))
	return (await response.json()) as FilePlaces
}

// Creates a directory named name in the server directory parent and resolves to its entry. Throws an Error with the
// server's message when it cannot be created (its name taken, its parent missing or not writable).
export async function createDirectory(parent: string, name: string): Promise<FileEntry> {
	const response = await fetch('/api/files', jsonInit('POST', { parent, name } satisfies CreateDirectoryRequest))
	if (!response.ok) throw new Error(await responseError(response))
	return (await response.json()) as FileEntry
}

// Joins a server directory path and a file name with the directory's own separator (backslash for a
// Windows path, slash otherwise), without doubling a trailing one such as that of C:\.
export function joinPath(directory: string, name: string): string {
	const separator = directory.includes('\\') ? '\\' : '/'
	return directory.endsWith(separator) ? `${directory}${name}` : `${directory}${separator}${name}`
}

// Whether name is taken in the server directory by one of names: compared without case for a Windows path (one with
// backslash separators), exactly otherwise.
export function nameTaken(directory: string, name: string, names: readonly string[]): boolean {
	if (!directory.includes('\\')) return names.includes(name)
	const lower = name.toLowerCase()
	return names.some((candidate) => candidate.toLowerCase() === lower)
}

// Whether an entry is hidden by the convention of Unix systems: its name starts with a dot.
export function isHidden(entry: FileEntry): boolean {
	return entry.name.startsWith('.')
}

// Returns the time of an entry's last modification in Unix milliseconds, or NaN when the server gave none.
function modifiedTime(entry: FileEntry): number {
	return entry.modifiedAt ? Date.parse(entry.modifiedAt) : Number.NaN
}

// Returns the entries in an order, directories first; ordered by modification time, entries without one come last and
// ties keep the order of the names.
export function sortEntries(entries: readonly FileEntry[], { by, descending }: EntryOrder): FileEntry[] {
	const sign = descending ? -1 : 1

	return entries.toSorted((a, b) => {
		if (a.directory !== b.directory) return a.directory ? -1 : 1
		if (by === 'name') return sign * collator.compare(a.name, b.name)

		const ta = modifiedTime(a)
		const tb = modifiedTime(b)
		if (Number.isNaN(ta) !== Number.isNaN(tb)) return Number.isNaN(ta) ? 1 : -1
		if (!Number.isNaN(ta) && ta !== tb) return sign * (ta - tb)
		return collator.compare(a.name, b.name)
	})
}

// Splits a name into a head that may be cut with an ellipsis and a tail always shown whole, so the part that tells
// frames apart (a sequence number and the extension) stays visible on a narrow screen. The tail starts at the last
// separator (underscore, hyphen, space, or dot) before the extension when that end has at most MAX_NAME_TAIL
// characters, else it is the last MAX_NAME_TAIL characters. A name of at most MAX_NAME_TAIL characters is all head.
export function splitName(name: string): readonly [head: string, tail: string] {
	if (name.length <= MAX_NAME_TAIL) return [name, '']
	const dot = name.lastIndexOf('.')
	const stem = dot > 0 ? name.slice(0, dot) : name
	const separator = Math.max(stem.lastIndexOf('_'), stem.lastIndexOf('-'), stem.lastIndexOf(' '), stem.lastIndexOf('.'))
	const start = separator > 0 && name.length - separator <= MAX_NAME_TAIL ? separator : name.length - MAX_NAME_TAIL
	return [name.slice(0, start), name.slice(start)]
}

// Returns the extensions of a filter as the operator reads them: "FIT, FITS, XISF".
export function filterLabel(extensions: readonly string[]): string {
	return extensions.map((extension) => extension.toUpperCase()).join(', ')
}
