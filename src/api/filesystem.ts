import { Glob } from 'bun'
import Elysia from 'elysia'
import fs from 'fs/promises'
import os from 'os'
import { basename, dirname, join, normalize } from 'path'
import type { CreateDirectory, DirectoryEntry, FileEntry, FileSystem, ListDirectory } from '../shared/types'

export const FileEntryComparator = (a: FileEntry, b: FileEntry) => {
	// Sort directories before files, then sort by name
	if (a.directory === b.directory) return a.name.localeCompare(b.name)
	else if (a.directory) return -1
	else return 1
}

export class FileSystemManager {
	async list(req?: ListDirectory): Promise<FileSystem> {
		// Find the directory path from request or use the home directory
		const path = (await findDirectory(req?.path)) || os.homedir()
		// Make the directory tree from current path
		const tree = makeDirectoryTree(path)
		// Prepare the glob to filter
		const glob = req?.filter ? new Glob(req.filter) : undefined
		const entries: FileEntry[] = []

		// Read the directory entries
		for (const entry of await fs.readdir(path, { withFileTypes: true })) {
			const { name, parentPath } = entry
			const path = join(parentPath, name)
			const isDirectory = entry.isDirectory()

			// Include only files and directories
			if (isDirectory || entry.isFile()) {
				// Include only directories if it is a directory-only request
				if (!req?.directoryOnly || isDirectory) {
					// Include only files that match the glob pattern (if present)
					if (!glob || isDirectory || glob.match(name)) {
						const { size, atimeMs: updatedAt } = await fs.stat(path)
						entries.push({ name, path, directory: isDirectory, size, updatedAt })
					}
				}
			}
		}

		entries.sort(FileEntryComparator)

		return { path, tree, entries }
	}

	async create(req: CreateDirectory) {
		const path = join(req.path, req.name.trim())
		await fs.mkdir(path, req)
		return { path }
	}

	async directory(req: string) {
		const path = await findDirectory(req)
		return { path }
	}

	async exists(req: CreateDirectory) {
		const path = await findDirectory(req.path)
		return path ? fs.exists(join(path, req.name.trim())) : false
	}

	join(req: string[]) {
		const path = join(...req)
		return { path }
	}
}

export function fileSystem(fileSystem: FileSystemManager) {
	const app = new Elysia({ prefix: '/filesystem' })
		// Endpoints!
		.post('/list', ({ body }) => fileSystem.list(body as never))
		.post('/create', ({ body }) => fileSystem.create(body as never))
		.post('/directory', ({ body }) => fileSystem.directory(body as never))
		.post('/exists', ({ body }) => fileSystem.exists(body as never))
		.post('/join', ({ body }) => fileSystem.join(body as never))

	return app
}

export async function findDirectory(path?: string) {
	// If no path is provided, return
	if (!path) return undefined
	// If the path does not exist, go up until a directory is found
	else if (!(await fs.exists(path))) return findDirectory(dirname(path))
	// If the path exists, return if it is a directory, otherwise go up
	else {
		const stats = await fs.stat(path)
		if (!stats.isDirectory()) return findDirectory(dirname(path))
		else return normalize(path)
	}
}

function makeDirectoryTree(path: string): DirectoryEntry[] {
	const name = basename(path)

	// Return the root directory
	if (!name) return [{ name, path }]

	// Create the parent directory entry
	const parent = dirname(path)
	const tree = makeDirectoryTree(parent)

	tree.push({ name, path })

	return tree
}
