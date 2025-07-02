import { Glob } from 'bun'
import { molecule } from 'bunshi'
import Elysia from 'elysia'
import fs from 'fs/promises'
import os from 'os'
import { basename, dirname, join } from 'path'
import type { CreateDirectory, DirectoryEntry, FileEntry, FileSystem, ListDirectory } from './types'

// Comparator for sorting file entries
export const FileEntryComparator = (a: FileEntry, b: FileEntry) => {
	if (a.directory === b.directory) return a.path.localeCompare(b.path)
	else if (a.directory) return -1
	else return 1
}

// Molecule for handing file system operations
export const FileSystemMolecule = molecule(() => {
	// Lists directories and files in a specified path
	// If no path is specified, it defaults to the user's home directory
	// It can filter results based on a glob pattern and whether to include only directories
	// Returns a structured response containing the path, directory tree, and entries
	async function list(req?: ListDirectory): Promise<FileSystem> {
		const path = (await findDirectory(req?.path)) || os.homedir()
		const tree = makeDirectoryTree(path)
		const glob = req?.filter ? new Glob(req.filter) : undefined
		const entries: FileEntry[] = []

		for (const entry of await fs.readdir(path, { withFileTypes: true })) {
			const { name, parentPath } = entry
			const path = join(parentPath, name)
			const directory = entry.isDirectory()

			if (directory || entry.isFile()) {
				if (!req?.directoryOnly || directory) {
					if (!glob || directory || glob.match(name)) {
						const { size, atimeMs: updatedAt } = await fs.stat(path)
						entries.push({ name, path, directory, size, updatedAt })
					}
				}
			}
		}

		entries.sort(FileEntryComparator)

		return { path, tree, entries }
	}

	// Creates a new directory at the specified path with the given name
	async function create(req: CreateDirectory) {
		const path = join(req.path, req.name.trim())
		await fs.mkdir(path, req)
		return { path }
	}

	// The endpoints for file system operations
	const app = new Elysia({ prefix: '/fileSystem' })

	app.post('/list', ({ body }) => {
		return list(body as never)
	})

	app.post('/create', ({ body }) => {
		return create(body as never)
	})

	return { list, create, app } as const
})

// Finds the first directory in the path hierarchy
// If the path is undefined or does not exist, it returns undefined
// If the path is not a directory, it recursively checks the parent directory
// Returns the first valid directory found in the hierarchy
export async function findDirectory(path?: string) {
	if (!path) return undefined
	else if (!(await fs.exists(path))) return findDirectory(dirname(path))
	else {
		const stats = await fs.stat(path)
		if (!stats.isDirectory()) return findDirectory(dirname(path))
		else return path
	}
}

// Constructs a directory tree from a given path
// It recursively builds the tree by traversing up the directory structure
// Each node in the tree represents a directory with its name and path
// Returns an array of directory entries representing the tree structure
function makeDirectoryTree(path: string): DirectoryEntry[] {
	const name = basename(path)

	if (!name) return [{ name, path }]

	const parent = dirname(path)
	const tree = makeDirectoryTree(parent)

	tree.push({ name, path })

	return tree
}
