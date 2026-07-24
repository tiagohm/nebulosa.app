export interface ListDirectory {
	path?: string
	filter?: string
	directoryOnly?: boolean
}

export interface DirectoryEntry {
	name: string
	path: string
}

export interface CreateDirectory extends DirectoryEntry {
	recursive?: boolean | undefined
	mode?: string | number | undefined
}

export interface FileEntry extends DirectoryEntry {
	directory: boolean
	size: number
	updatedAt: number
}

export interface FileSystem {
	path: string
	tree: DirectoryEntry[]
	entries: FileEntry[]
}
