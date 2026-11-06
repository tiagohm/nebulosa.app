// Encryption at rest of the RTSP addresses of the observatory cameras. The whole address is a secret: its user, password,
// path, and query may all carry credentials, so the database keeps it only as AES-256-GCM ciphertext bound to the id of
// its camera. The 32-byte master key never lives in the database: it comes from NEBULOSA_CAMERA_SECRET_KEY (base64) when
// that variable is set, else from the credential storage of the operating system (Bun.secrets), where it is generated on
// the first save. A database copied without its key cannot give the addresses back, and a key that changed is told
// apart from damaged data by the id of the key each row was written with.

// Name of the environment variable that supplies the master key, base64 of 32 bytes.
export const CAMERA_SECRET_KEY_VARIABLE = 'NEBULOSA_CAMERA_SECRET_KEY'

// Service name under which the master key is kept in the credential storage of the operating system.
const SECRET_SERVICE = 'nebulosa'

// Length of the master key, in bytes (AES-256).
const KEY_LENGTH = 32

// Length of the nonce of each encryption, in bytes, as AES-GCM recommends.
export const SOURCE_NONCE_LENGTH = 12

// Availability of the master key: available; unavailable, when no variable is set and the credential storage of the
// operating system cannot be used (or holds no key yet, before the first save); or invalid, when the variable is not
// the base64 of 32 bytes.
export type CameraSecretKeyStatus = 'available' | 'unavailable' | 'invalid'

// Credential storage holding the master key as base64 text; Bun.secrets in the server, a fake in tests.
export interface CameraSecretStorage {
	// Reads the key, or null when none is stored. Rejects when the storage cannot be used.
	readonly get: () => Promise<string | null>
	// Stores the key. Rejects when the storage cannot be used.
	readonly set: (value: string) => Promise<void>
}

// Master key ready to encrypt and decrypt.
export interface CameraKey {
	// AES-GCM key, usable for encrypt and decrypt only.
	readonly key: CryptoKey
	// Id of the key: the first 16 hexadecimal digits of the SHA-256 of its bytes; never reveals the key.
	readonly id: string
}

// Outcome of resolving the master key: the key, or why there is none with a message meant for people.
export type CameraKeyOutcome = { readonly status: 'available'; readonly key: CameraKey } | { readonly status: 'unavailable' | 'invalid'; readonly message: string }

// Encrypted RTSP address of a camera, as the database keeps it.
export interface EncryptedSource {
	// AES-GCM ciphertext followed by its 16-byte authentication tag.
	readonly ciphertext: Uint8Array<ArrayBuffer>
	// Nonce of the encryption, SOURCE_NONCE_LENGTH bytes, never reused with the same key.
	readonly nonce: Uint8Array<ArrayBuffer>
	// Id of the key that encrypted it (CameraKey.id).
	readonly keyId: string
}

// Returns the credential storage of the operating system for the database file, so that servers with other data
// directories (and the tests) never share a key.
export function systemSecretStorage(databaseFile: string): CameraSecretStorage {
	const name = `observatory-cameras:${databaseFile}`
	return {
		get: () => Bun.secrets.get({ service: SECRET_SERVICE, name }),
		set: (value) => Bun.secrets.set({ service: SECRET_SERVICE, name, value }),
	}
}

// Returns the id of a key from its bytes.
function keyId(bytes: Uint8Array) {
	return new Bun.CryptoHasher('sha256').update(bytes).digest('hex').slice(0, 16)
}

// Imports raw key bytes as a CameraKey.
async function importKey(bytes: Uint8Array<ArrayBuffer>): Promise<CameraKey> {
	const key = await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt'])
	return { key, id: keyId(bytes) }
}

// Decodes base64 text into exactly KEY_LENGTH bytes, or undefined.
function decodeKey(text: string): Uint8Array<ArrayBuffer> | undefined {
	try {
		const bytes = Uint8Array.fromBase64(text.trim())
		return bytes.length === KEY_LENGTH ? bytes : undefined
	} catch {
		return undefined
	}
}

// Master key of the camera addresses, resolved once and then kept in memory. The variable, when set, always wins; the
// credential storage is read only without it.
export class CameraSecretKey {
	// Key resolved, kept for the life of the server.
	#key?: CameraKey
	// Resolution in progress, shared by concurrent callers.
	#pending?: Promise<CameraKeyOutcome>

	// Creates the resolver of the key from the value of the variable (undefined or empty when not set) and storage.
	constructor(
		readonly variable: string | undefined,
		readonly storage: CameraSecretStorage,
	) {}

	// Resolves the key. With create, a storage that holds no key yet gets a new random one, which is how the first save
	// makes the key; without it, such a storage is unavailable. Never rejects.
	resolve(create: boolean): Promise<CameraKeyOutcome> {
		if (this.#key) return Promise.resolve({ status: 'available', key: this.#key })
		if (this.#pending) return this.#pending.then((outcome) => (outcome.status === 'unavailable' && create ? this.resolve(create) : outcome))

		const pending = this.#resolve(create).finally(() => {
			this.#pending = undefined
		})

		this.#pending = pending
		return pending
	}

	// Resolves the key from the variable, else from the storage.
	async #resolve(create: boolean): Promise<CameraKeyOutcome> {
		if (this.variable?.trim()) {
			const bytes = decodeKey(this.variable)
			if (!bytes) return { status: 'invalid', message: `${CAMERA_SECRET_KEY_VARIABLE} is not the base64 of 32 bytes.` }
			return this.#keep(await importKey(bytes))
		}

		try {
			const stored = await this.storage.get()

			if (stored) {
				const bytes = decodeKey(stored)
				if (!bytes) return { status: 'invalid', message: 'The key kept by the operating system is not the base64 of 32 bytes.' }
				return this.#keep(await importKey(bytes))
			}

			if (!create) return { status: 'unavailable', message: 'No key was made yet; the first camera saved makes one.' }

			const bytes = crypto.getRandomValues(new Uint8Array(KEY_LENGTH))
			await this.storage.set(bytes.toBase64())
			return this.#keep(await importKey(bytes))
		} catch {
			return { status: 'unavailable', message: `The credential storage of the operating system cannot be used; set ${CAMERA_SECRET_KEY_VARIABLE} to the base64 of 32 random bytes.` }
		}
	}

	// Keeps a resolved key and returns it.
	#keep(key: CameraKey): CameraKeyOutcome {
		this.#key = key
		return { status: 'available', key }
	}
}

// Encrypts the RTSP address of a camera, binding it to the camera's id, with a new random nonce.
export async function encryptSource({ key, id }: CameraKey, cameraId: string, source: string): Promise<EncryptedSource> {
	const nonce = crypto.getRandomValues(new Uint8Array(SOURCE_NONCE_LENGTH))
	const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: new TextEncoder().encode(cameraId) }, key, new TextEncoder().encode(source))
	return { ciphertext: new Uint8Array(ciphertext), nonce, keyId: id }
}

// Decrypts the RTSP address of a camera. Rejects when it was written with another key, belongs to another camera, or
// was altered.
export async function decryptSource({ key, id }: CameraKey, cameraId: string, { ciphertext, nonce, keyId }: EncryptedSource): Promise<string> {
	if (keyId !== id) throw new Error('The address was encrypted with another key')
	const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce, additionalData: new TextEncoder().encode(cameraId) }, key, ciphertext)
	return new TextDecoder().decode(plain)
}
