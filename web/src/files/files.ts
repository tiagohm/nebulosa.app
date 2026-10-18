import type { DirectoryListing } from 'api'
import { responseError } from '../http'

// Client of the server's file browsing API, used to choose files the server reads.

// Extensions of the astronomical image files the Images workspace opens.
export const IMAGE_EXTENSIONS: readonly string[] = ['fit', 'fits', 'fts', 'xisf']

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

// Joins a server directory path and a file name with the directory's own separator (backslash for a
// Windows path, slash otherwise), without doubling a trailing one such as that of C:\.
export function joinPath(directory: string, name: string): string {
	const separator = directory.includes('\\') ? '\\' : '/'
	return directory.endsWith(separator) ? `${directory}${name}` : `${directory}${separator}${name}`
}

// Returns a file size in bytes as a short human-readable text, in binary units.
export function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`
	const units = ['KiB', 'MiB', 'GiB', 'TiB']
	let value = bytes / 1024
	let unit = 0

	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024
		unit++
	}

	return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}
