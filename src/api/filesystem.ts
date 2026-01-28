import { Glob } from 'bun'
import { mkdir, readdir, stat } from 'fs/promises'
import { basename, dirname, join, normalize } from 'path'
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
		const glob = req?.filter ? new Glob(req.filter) : undefined
		const entries: FileEntry[] = []

		// Read the directory entries
		for (const entry of await readdir(path, { withFileTypes: true })) {
			const { name, parentPath } = entry
			const path = join(parentPath, name)
			const isDirectory = entry.isDirectory()

			// Include only files and directories
			if (isDirectory || entry.isFile()) {
				// Include only directories if it is a directory-only request
				if (!req?.directoryOnly || isDirectory) {
					// Include only files that match the glob pattern (if present)
					if (!glob || isDirectory || glob.match(name)) {
						const { size, mtimeMs: updatedAt } = await stat(path)
						entries.push({ name, path, directory: isDirectory, size, updatedAt })
					}
				}
			}
		}

		entries.sort(FileEntryComparator)

		return { path, tree, entries }
	}

	async create(req: CreateDirectory) {
		const { path: parent } = await this.directory(req.path)
		const path = join(parent, req.name.trim())
		await mkdir(path, req)
		return { path }
	}

	async directory(req?: string) {
		return { path: (await findDirectory(req)) || Bun.env.homeDir }
	}

	async exists(req: Partial<DirectoryEntry>) {
		const path = await findDirectory(req.path || Bun.env.homeDir)
		if (!path) return false
		if (!req.name) return true
		return await Bun.file(join(path, req.name)).exists()
	}

	join(req: readonly string[]) {
		return { path: join(...req) }
	}
}

export function fileSystem(fileSystem: FileSystemHandler): Endpoints {
	return {
		'/filesystem/list': { POST: async (req) => response(await fileSystem.list(await req.json())) },
		'/filesystem/create': { POST: async (req) => response(await fileSystem.create(await req.json())) },
		'/filesystem/directory': { POST: async (req) => response(await fileSystem.directory(await req.json())) },
		'/filesystem/exists': { POST: async (req) => response(await fileSystem.exists(await req.json())) },
		'/filesystem/join': { POST: async (req) => response(fileSystem.join(await req.json())) },
	}
}

export async function findDirectory(path?: string, parent?: string) {
	// If no path is provided, return
	if (!path) return undefined
	else if (path === parent) return path
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
