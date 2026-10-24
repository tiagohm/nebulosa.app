import { existsSync } from 'fs'
import { readdir, stat } from 'fs/promises'
import { dirname, extname, join, resolve } from 'path'
import { errorResponse } from './http'

// Browsing of the server's filesystem, so a client on another machine can choose files the server reads,
// such as images to open. Any directory the server process can read is listed to any client that can
// reach the API; like every other input, the requested path is not restricted.

// Entry of a directory listing.
export interface FileEntry {
	// File or directory name; a drive root such as C:\ on Windows.
	readonly name: string
	// Absolute path.
	readonly path: string
	// Whether the entry is a directory (a symbolic link is listed as what it points to).
	readonly directory: boolean
	// Size of a file, in bytes.
	readonly size?: number
	// Time of the last modification, ISO 8601.
	readonly modifiedAt?: string
}

// Contents of a directory.
export interface DirectoryListing {
	// Absolute path of the listed directory; empty for the list of drives on Windows.
	readonly path: string
	// Path of the parent directory: empty for a Windows drive root, whose parent is the list of drives;
	// absent at the top.
	readonly parent?: string
	// Directories first, then files, each sorted by name.
	readonly entries: readonly FileEntry[]
}

// Error of a directory that cannot be listed: missing or not a directory, or not readable.
export class DirectoryError extends Error {
	// HTTP status matching the failure: 404 when the directory does not exist, 403 otherwise.
	readonly status: 404 | 403

	// Creates the error of a failed listing of path.
	constructor(path: string, cause: unknown) {
		const code = Error.isError(cause) && 'code' in cause ? cause.code : undefined
		const missing = code === 'ENOENT' || code === 'ENOTDIR'
		super(missing ? `Directory not found: ${path}` : `Unable to read directory: ${path}`, { cause })
		this.status = missing ? 404 : 403
	}
}

// Whether the server runs on Windows, whose filesystem has one root per drive.
const WINDOWS = process.platform === 'win32'

// Drive letters probed for the list of Windows drives.
const DRIVE_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

// Sorts names the way file managers do: case-insensitive, with numbers in numeric order.
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

// Returns the existing Windows drives as directory entries.
function drives(): FileEntry[] {
	const entries: FileEntry[] = []

	for (const letter of DRIVE_LETTERS) {
		const path = `${letter}:\\`
		if (existsSync(path)) entries.push({ name: path, path, directory: true })
	}

	return entries
}

// Returns the entry of a directory child, or undefined when it cannot be read (such as a broken link).
async function entry(directory: string, name: string): Promise<FileEntry | undefined> {
	const path = join(directory, name)

	try {
		const stats = await stat(path)
		return stats.isDirectory() ? { name, path, directory: true, modifiedAt: stats.mtime.toISOString() } : { name, path, directory: false, size: stats.size, modifiedAt: stats.mtime.toISOString() }
	} catch {
		return undefined
	}
}

// Lists a directory, resolved against the server's working directory; empty or "." is the working
// directory, except that empty lists the drives on Windows. When extensions is given (lowercase, without
// the dot), only files with one of them are listed, along with every directory. Throws DirectoryError.
export async function listDirectory(path: string, extensions?: ReadonlySet<string>): Promise<DirectoryListing> {
	if (WINDOWS && path === '') return { path: '', entries: drives() }

	const directory = resolve(path || '.')
	let names: string[]

	try {
		names = await readdir(directory)
	} catch (error) {
		throw new DirectoryError(directory, error)
	}

	const entries: FileEntry[] = []

	for (const child of await Promise.all(names.map((name) => entry(directory, name)))) {
		if (child && (child.directory || !extensions || extensions.has(extname(child.name).slice(1).toLowerCase()))) entries.push(child)
	}

	entries.sort((a, b) => (a.directory === b.directory ? collator.compare(a.name, b.name) : a.directory ? -1 : 1))

	const up = dirname(directory)
	const parent = up !== directory ? up : WINDOWS ? '' : undefined
	return parent === undefined ? { path: directory, entries } : { path: directory, parent, entries }
}

// Routes of the server filesystem browser.
export function createFileRoutes() {
	return {
		'/api/files': {
			// Lists a directory of the server (?path=<directory>&extensions=<ext,ext>): responds with the DirectoryListing,
			// 404 when the directory does not exist, and 403 when it cannot be read.
			GET: async (req) => {
				const params = new URL(req.url).searchParams
				const extensions = params.get('extensions')

				try {
					return Response.json(await listDirectory(params.get('path') ?? '.', extensions ? new Set(extensions.toLowerCase().split(',')) : undefined))
				} catch (error) {
					if (error instanceof DirectoryError) return errorResponse(error.message, error.status, error.status === 404 ? 'notFound' : 'forbidden')
					throw error
				}
			},
		},
	} as const satisfies Bun.Serve.Routes<undefined, string>
}
