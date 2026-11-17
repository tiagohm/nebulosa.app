import { existsSync } from 'fs'
import { mkdir, readdir, stat } from 'fs/promises'
import { basename, dirname, extname, join, resolve } from 'path'
import { errorResponse } from './http'
import { errorCode } from './util'

// Browsing of the server's filesystem, so a client on another machine can choose files the server reads,
// such as images to open, and creation of a directory to save in. Any directory the server process can read is
// listed, and any it can write gets a new directory, for any client that can reach the API; like every other input,
// the requested path is not restricted.

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
		const code = errorCode(cause)
		const missing = code === 'ENOENT' || code === 'ENOTDIR'
		super(missing ? `Directory not found: ${path}` : `Unable to read directory: ${path}`, { cause })
		this.status = missing ? 404 : 403
	}
}

// Stable codes of the errors of the file browser: notFound (a directory, or the parent of a new one, does not exist),
// forbidden (it cannot be read or written), exists (a new directory's name is already taken).
export type FileErrorCode = 'notFound' | 'forbidden' | 'exists'

// Body of the creation of a directory.
export interface CreateDirectoryRequest {
	// Absolute path of the existing directory to create it in.
	readonly parent: string
	// Name of the new directory.
	readonly name: string
}

// Error of a directory that cannot be created: its parent is missing, its name is taken, or the parent is not writable.
export class CreateDirectoryError extends Error {
	// HTTP status matching the failure: 404 when the parent does not exist, 409 when the name is taken, 403 otherwise.
	readonly status: 404 | 409 | 403
	// Stable code of the failure.
	readonly code: FileErrorCode

	// Creates the error of a failed creation of path.
	constructor(path: string, cause: unknown) {
		const code = errorCode(cause)
		const exists = code === 'EEXIST'
		const missing = code === 'ENOENT' || code === 'ENOTDIR'
		super(exists ? `Already exists: ${path}` : missing ? `Directory not found: ${dirname(path)}` : `Unable to create directory: ${path}`, { cause })
		this.status = exists ? 409 : missing ? 404 : 403
		this.code = exists ? 'exists' : missing ? 'notFound' : 'forbidden'
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

// Creates a directory named name in the existing directory parent (resolved against the server's working directory),
// never its missing ancestors, and resolves to its entry. Throws CreateDirectoryError.
export async function createDirectory({ parent, name }: CreateDirectoryRequest): Promise<FileEntry> {
	const path = join(resolve(parent || '.'), name)

	try {
		await mkdir(path)
	} catch (error) {
		throw new CreateDirectoryError(path, error)
	}

	const created = await entry(dirname(path), basename(path))
	return created ?? { name: basename(path), path, directory: true }
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
			// Creates a directory (CreateDirectoryRequest): responds 201 with its FileEntry, 404 when the parent does not
			// exist, 409 when the name is taken, and 403 when the parent cannot be written.
			POST: async (req) => {
				try {
					return Response.json(await createDirectory((await req.json()) as CreateDirectoryRequest), { status: 201 })
				} catch (error) {
					if (error instanceof CreateDirectoryError) return errorResponse(error.message, error.status, error.code)
					throw error
				}
			},
		},
	} as const satisfies Bun.Serve.Routes<undefined, string>
}
