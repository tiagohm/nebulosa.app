import { expect } from 'bun:test'
import type { Messager } from 'src/api/message'

export type SocketMessage<T = unknown> = {
	readonly type: string
	readonly body: T
}

export class SocketMessager implements Messager {
	readonly messages: SocketMessage[] = []

	public sendText(data: string) {
		const separator = data.indexOf('@')
		const type = data.slice(0, separator)
		const payload = data.slice(separator + 1)
		this.messages.push({ type, body: payload ? JSON.parse(payload) : undefined })
	}

	public clear() {
		this.messages.length = 0
	}

	public some<T>(predicate: (message: SocketMessage<T>) => void) {
		return this.messages.some((e) => predicate(e as SocketMessage<T>))
	}

	public find<T>(predicate: (message: SocketMessage<T>) => void) {
		return this.messages.find((e) => predicate(e as SocketMessage<T>)) as SocketMessage<T> | undefined
	}

	public filter<T>(predicate: (message: SocketMessage<T>) => void) {
		return this.messages.filter((e) => predicate(e as SocketMessage<T>)) as SocketMessage<T>[]
	}
}

export async function json<T>(response: Response, expectedStatus = 200) {
	expect(response.status).toBe(expectedStatus)
	return (await response.json()) as T
}

export async function noContent(response: Response, expectedStatus = 200) {
	expect(response.status).toBe(expectedStatus)
	expect(await response.text()).toBe('')
}

export async function waitUntil(condition: () => boolean, timeout = 1500) {
	const start = performance.now()

	while (!condition()) {
		if (performance.now() - start >= timeout) return false
		await Bun.sleep(10)
	}

	return true
}
