import { mkdir, readdir, stat } from 'fs/promises'
import { basename, dirname, isAbsolute, join, normalize } from 'path'
import { Glob } from 'bun'
import type { CreateDirectory, DirectoryEntry, FileEntry, FileSystem, ListDirectory } from '../shared/types'
import { type Endpoints, response } from './http'
import { directoryExists } from './util'

const FileEntryComparator = (a: FileEntry, b: FileEntry) => {
	// Sort directories before files, then sort by name
	if (a.directory === b.directory) return a.name.localeCompare(b.name)
	else if (a.directory) return -1
	else return 1
}

export class FileSystemHandler {
	async list(req?: ListDirectory): Promise<FileSystem> {
		// Find the directory path from request or use the home directory
		const { path } = await this.directory(req?.path)
		// Make the directory tree from current path
		const tree = makeDirectoryTree(path)
		// Prepare the glob to filter
		const glob = makeGlob(req?.filter)
		const entries: FileEntry[] = []

		// Read the directory entries
		for (const entry of await readdir(path, { withFileTypes: true })) {
			const { name, parentPath } = entry
			const entryPath = join(parentPath, name)
			const isDirectory = entry.isDirectory()

			// Include only files and directories
			if (isDirectory || entry.isFile()) {
				// Include only directories if it is a directory-only request
				if (!req?.directoryOnly || isDirectory) {
					// Include only files that match the glob pattern (if present)
					if (!glob || isDirectory || glob.match(name)) {
						const stats = await statEntry(entryPath)
						if (stats) entries.push({ name, path: entryPath, directory: isDirectory, size: stats.size, updatedAt: stats.mtimeMs })
					}
				}
			}
		}

		entries.sort(FileEntryComparator)

		return { path, tree, entries }
	}

	async create(req: CreateDirectory) {
		const { path: parent } = await this.directory(req.path)
		const name = directoryName(req.name)
		const path = join(parent, name)
		await mkdir(path, { mode: req.mode, recursive: req.recursive })
		return { path }
	}

	async directory(req?: string) {
		return { path: (await findDirectory(req)) || Bun.env.homeDir }
	}

	async exists(req?: Partial<DirectoryEntry>) {
		const path = await findDirectory(req?.path || Bun.env.homeDir)
		if (!path) return false
		if (req?.name === undefined) return true
		const name = fileName(req.name)
		return !!name && (await statEntry(join(path, name))) !== undefined
	}

	join(req: readonly unknown[]) {
		const parts = Array.isArray(req) ? req.filter((e) => typeof e === 'string' && e.length > 0) : []
		return { path: parts.length > 0 ? join(...parts) : '' }
	}
}

export function fileSystem(fileSystem: FileSystemHandler) {
	return {
		'/filesystem/list': { POST: async (req) => response(await fileSystem.list(await req.json())) },
		'/filesystem/create': { POST: async (req) => response(await fileSystem.create(await req.json())) },
		'/filesystem/directory': { POST: async (req) => response(await fileSystem.directory(await req.json())) },
		'/filesystem/exists': { POST: async (req) => response(await fileSystem.exists(await req.json())) },
		'/filesystem/join': { POST: async (req) => response(fileSystem.join(await req.json())) },
	} as const satisfies Endpoints
}

export async function findDirectory(path?: string, parent?: string) {
	// If no path is provided, return
	if (!path) return undefined
	else if (path === parent) return (await directoryExists(path)) ? normalize(path) : undefined
	// If the path does not exist, go up until a directory is found
	else if (!(await directoryExists(path))) return findDirectory(dirname(path), path)
	// If the path exists, return if it is a directory, otherwise go up
	else {
		const stats = await stat(path)
		if (!stats.isDirectory()) return findDirectory(dirname(path), path)
		else return normalize(path)
	}
}

function makeDirectoryTree(path: string): DirectoryEntry[] {
	const name = basename(path)

	if (name) {
		// Create the parent directory entry
		const parent = dirname(path)

		if (parent !== path) {
			const tree = makeDirectoryTree(parent)
			tree.push({ name, path })
			return tree
		}
	}

	// Return the root directory
	return [{ name, path }]
}

async function statEntry(path: string) {
	try {
		return await stat(path)
	} catch {
		return undefined
	}
}

function makeGlob(filter: unknown) {
	if (typeof filter !== 'string' || !filter) return undefined

	try {
		return new Glob(filter)
	} catch {
		return undefined
	}
}

function directoryName(name: unknown) {
	const normalized = fileName(name)

	if (!normalized) {
		throw new Error('invalid directory name')
	}

	return normalized
}

function fileName(name: unknown) {
	if (typeof name !== 'string') return undefined

	const normalized = name.trim()
	if (!normalized || normalized === '.' || normalized === '..' || isAbsolute(normalized) || normalized.includes('/') || normalized.includes('\\')) return undefined

	return normalized
}
