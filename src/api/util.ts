import type { PathLike } from 'fs'
import { readdir } from 'fs/promises'

export async function directoryExists(path: PathLike): Promise<boolean> {
	try {
		await readdir(path)
		return true
	} catch {
		return false
	}
}
