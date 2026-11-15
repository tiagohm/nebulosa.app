import type { CreateDirectoryRequest, DirectoryListing, FileEntry } from 'api'
import { jsonInit, responseError } from '../http'

// Client of the server's file browsing API, used to choose files the server reads and to create the directories it
// saves in.

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
