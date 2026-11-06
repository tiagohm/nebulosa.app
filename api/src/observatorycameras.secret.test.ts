import { describe, expect, test } from 'bun:test'
import { type CameraKey, type CameraSecretStorage, CameraSecretKey, decryptSource, encryptSource } from './observatorycameras.secret'

const SOURCE = 'rtsp://admin:p%40ss@192.0.2.10:554/cam/realmonitor?channel=1&subtype=0&token=xyz'

function memoryStorage(initial: string | null = null) {
	let value = initial
	const storage: CameraSecretStorage = {
		get: () => Promise.resolve(value),
		set: (next) => {
			value = next
			return Promise.resolve()
		},
	}
	return { storage, read: () => value }
}

const BROKEN: CameraSecretStorage = { get: () => Promise.reject(new Error('no secret service')), set: () => Promise.reject(new Error('no secret service')) }

async function keyOf(resolver: CameraSecretKey): Promise<CameraKey> {
	const outcome = await resolver.resolve(true)
	if (outcome.status !== 'available') throw new Error(outcome.message)
	return outcome.key
}

describe('key', () => {
	test('the variable wins over the storage', async () => {
		const variable = new Uint8Array(32).fill(7).toBase64()
		const { storage, read } = memoryStorage()
		const key = await keyOf(new CameraSecretKey(variable, storage))
		expect(key.id).toHaveLength(16)
		expect(read()).toBeNull()
	})

	test('an invalid variable is reported, never replaced', async () => {
		const { storage } = memoryStorage()
		expect(await new CameraSecretKey('c2hvcnQ=', storage).resolve(true)).toMatchObject({ status: 'invalid' })
		expect(await new CameraSecretKey('not base64!', storage).resolve(true)).toMatchObject({ status: 'invalid' })
	})

	test('the storage makes a key only when asked to, then keeps using it', async () => {
		const { storage, read } = memoryStorage()
		expect(await new CameraSecretKey(undefined, storage).resolve(false)).toMatchObject({ status: 'unavailable' })
		expect(read()).toBeNull()

		const first = await keyOf(new CameraSecretKey(undefined, storage))
		expect(read()).not.toBeNull()
		const again = await keyOf(new CameraSecretKey('', storage))
		expect(again.id).toBe(first.id)
	})

	test('a storage that cannot be used is unavailable', async () => {
		const outcome = await new CameraSecretKey(undefined, BROKEN).resolve(true)
		expect(outcome.status).toBe('unavailable')
		if (outcome.status !== 'available') expect(outcome.message).toContain('NEBULOSA_CAMERA_SECRET_KEY')
	})

	test('concurrent resolutions make a single key', async () => {
		const { storage } = memoryStorage()
		let sets = 0
		const counting: CameraSecretStorage = { get: storage.get, set: (value) => (sets++, storage.set(value)) }
		const resolver = new CameraSecretKey(undefined, counting)
		const [a, b] = await Promise.all([keyOf(resolver), keyOf(resolver)])
		expect(a.id).toBe(b.id)
		expect(sets).toBe(1)
	})
})

describe('encryption', () => {
	test('round trip, without the address in the ciphertext', async () => {
		const key = await keyOf(new CameraSecretKey(undefined, memoryStorage().storage))
		const encrypted = await encryptSource(key, 'cam-1', SOURCE)
		expect(encrypted.nonce).toHaveLength(12)
		expect(encrypted.keyId).toBe(key.id)
		expect(new TextDecoder().decode(encrypted.ciphertext)).not.toContain('admin')
		expect(await decryptSource(key, 'cam-1', encrypted)).toBe(SOURCE)
	})

	test('every encryption has its own nonce', async () => {
		const key = await keyOf(new CameraSecretKey(undefined, memoryStorage().storage))
		const a = await encryptSource(key, 'cam-1', SOURCE)
		const b = await encryptSource(key, 'cam-1', SOURCE)
		expect(a.nonce).not.toEqual(b.nonce)
		expect(a.ciphertext).not.toEqual(b.ciphertext)
	})

	test('another camera, another key, or altered data fail', async () => {
		const key = await keyOf(new CameraSecretKey(undefined, memoryStorage().storage))
		const other = await keyOf(new CameraSecretKey(undefined, memoryStorage().storage))
		const encrypted = await encryptSource(key, 'cam-1', SOURCE)

		await expect(decryptSource(key, 'cam-2', encrypted)).rejects.toThrow()
		await expect(decryptSource(other, 'cam-1', encrypted)).rejects.toThrow('another key')

		const altered = new Uint8Array(encrypted.ciphertext)
		altered[0] ^= 1
		await expect(decryptSource(key, 'cam-1', { ...encrypted, ciphertext: altered })).rejects.toThrow()
	})
})
