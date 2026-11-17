import { mkdir, open, rename, rm } from 'fs/promises'
import { dirname } from 'path'

// Small helpers of the server: atomic writes of the files it keeps from external providers, such as the IERS tables,
// filesystem error codes, and the yield of long computations to the event loop. Operational state lives in the
// database, never in files written here.

// Replaces a file so it never appears partially written: the content is written to a temporary file next
// to it, readable and writable by the server's user only, synced to the disk, then renamed over it, so a crash or
// a power loss leaves either the previous content or the new one, never an empty file. Creates the directory when
// missing. Throws when the file cannot be written; the previous file is then left as it was.
export async function writeAtomically(file: string, text: string) {
	await mkdir(dirname(file), { recursive: true })
	const temporary = `${file}.${Bun.randomUUIDv7()}.tmp`

	try {
		const handle = await open(temporary, 'w', 0o600)

		try {
			await handle.writeFile(text)
			await handle.sync()
		} finally {
			await handle.close()
		}

		await rename(temporary, file)
	} catch (error) {
		await rm(temporary, { force: true })
		throw error
	}
}

// Lets the event loop run, so a long computation on the main thread answers other requests between two of its pieces.
export function yieldToEventLoop(): Promise<void> {
	return new Promise<void>((resolve) => {
		setImmediate(resolve)
	})
}

// Error code of a failed filesystem call, if any.
export function errorCode(error: unknown) {
	return Error.isError(error) && 'code' in error ? (error.code as string) : undefined
}
