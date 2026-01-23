import type { PathLike } from 'fs'
import { readdir } from 'fs/promises'

const ONE_SECOND = 1000

export async function directoryExists(path: PathLike): Promise<boolean> {
	try {
		await readdir(path)
		return true
	} catch {
		return false
	}
}

export async function waitFor(ms: number, callback: (remainingTime: number) => boolean) {
	let remainingTime = Math.trunc(ms)

	if (remainingTime >= ONE_SECOND) {
		while (true) {
			if (remainingTime <= 0) {
				return callback(0)
			} else if (!callback(remainingTime)) {
				return false
			}

			// Sleep for until 1 second
			await Bun.sleep(Math.min(ONE_SECOND, remainingTime))

			// Subtract 1 second from remaining time
			remainingTime -= ONE_SECOND
		}
	}

	return true
}
