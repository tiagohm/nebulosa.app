import type { AppDatabase } from './database'
import type { ObservatoryCamera, RtspTransport } from './observatorycameras'
import type { EncryptedSource } from './observatorycameras.secret'

// Definitions of the observatory cameras in the operational database (observatory_cameras): what the operators saved,
// which is the state the media gateway is brought to. The RTSP address is kept only encrypted, with the host it names
// apart as a label; nothing read from here for a client carries the address. Writes are synchronous transactions, so
// the encryption, which is asynchronous, happens before them.

// Settings of a camera besides its address, as a save writes them.
export interface CameraFields {
	// Name shown to people; not empty.
	readonly name: string
	// Observing site the camera belongs to; undefined for a camera shared by every site.
	readonly observingSiteId?: string
	// Whether the gateway may read the camera.
	readonly enabled: boolean
	// How the gateway reads the RTSP stream.
	readonly rtspTransport: RtspTransport
	// Position in the list, ascending; undefined keeps it, or puts a new camera last.
	readonly sortOrder?: number
}

// New address of a camera, encrypted, with the host it names.
export interface CameraSourceUpdate extends EncryptedSource {
	// Host name or address of the camera, without user, password, port, path, or query.
	readonly host: string
}

// Address of an enabled camera as the gateway needs it, still encrypted.
export interface StoredCameraSource extends EncryptedSource {
	// Id of the camera.
	readonly id: string
	// How the gateway reads the RTSP stream.
	readonly rtspTransport: RtspTransport
	// Revision of the camera, so a change of its address or transport is told apart.
	readonly revision: number
}

// Outcome of a save: saved (and whether its address or transport changed), refused because another revision was saved
// since (with the current camera, null when it no longer exists), or refused because a new camera has no address.
export type CameraSaveOutcome = { readonly status: 'saved'; readonly camera: ObservatoryCamera; readonly sourceChanged: boolean } | { readonly status: 'conflict'; readonly current: ObservatoryCamera | null } | { readonly status: 'sourceRequired' }

// Row of a camera without its address.
interface CameraRow {
	readonly id: string
	readonly name: string
	readonly observingSiteId: string | null
	readonly enabled: number
	readonly sortOrder: number
	readonly sourceHost: string
	readonly rtspTransport: RtspTransport
	readonly revision: number
}

// Row of the encrypted address of a camera.
interface SourceRow {
	readonly id: string
	readonly rtspTransport: RtspTransport
	readonly revision: number
	readonly ciphertext: Uint8Array
	readonly nonce: Uint8Array
	readonly keyId: string
}

// Columns of a camera without its address, named as the API names them.
const CAMERA_COLUMNS = 'id, name, observing_site_id AS observingSiteId, enabled, sort_order AS sortOrder, source_host AS sourceHost, rtsp_transport AS rtspTransport, revision'

// Returns the camera of a row.
function cameraOf({ id, name, observingSiteId, enabled, sortOrder, sourceHost, rtspTransport, revision }: CameraRow): ObservatoryCamera {
	return { id, name, ...(observingSiteId !== null && { observingSiteId }), enabled: enabled === 1, sortOrder, sourceConfigured: true, sourceHost, rtspTransport, revision }
}

// Camera definitions of the operational database.
export class ObservatoryCameraStore {
	// Creates the store over database.
	constructor(readonly database: AppDatabase) {}

	// Returns every camera, by position then creation.
	list(): ObservatoryCamera[] {
		return this.database.db.query<CameraRow, []>(`SELECT ${CAMERA_COLUMNS} FROM observatory_cameras ORDER BY sort_order, created_at`).all().map(cameraOf)
	}

	// Returns a camera, or undefined when it does not exist.
	get(id: string): ObservatoryCamera | undefined {
		const row = this.database.db.query<CameraRow, [string]>(`SELECT ${CAMERA_COLUMNS} FROM observatory_cameras WHERE id = ?`).get(id)
		return row ? cameraOf(row) : undefined
	}

	// Returns the encrypted addresses of the enabled cameras, by position.
	sources(): StoredCameraSource[] {
		return this.database.db
			.query<SourceRow, []>('SELECT id, rtsp_transport AS rtspTransport, revision, source_ciphertext AS ciphertext, source_nonce AS nonce, source_key_id AS keyId FROM observatory_cameras WHERE enabled = 1 ORDER BY sort_order, created_at')
			.all()
			.map(({ id, rtspTransport, revision, ciphertext, nonce, keyId }) => ({ id, rtspTransport, revision, keyId, ciphertext: new Uint8Array(ciphertext), nonce: new Uint8Array(nonce) }))
	}

	// Creates a camera (revision 0, which needs source) or edits it from revision; without source an edit keeps the
	// saved address. Throws when the database cannot be written.
	save(id: string, { name, observingSiteId, enabled, rtspTransport, sortOrder }: CameraFields, source: CameraSourceUpdate | undefined, revision: number, now: number = Date.now()): CameraSaveOutcome {
		return this.database.write((): CameraSaveOutcome => {
			const current = this.get(id)
			if ((current?.revision ?? 0) !== revision) return { status: 'conflict', current: current ?? null }

			if (current) {
				const order = sortOrder ?? current.sortOrder
				const sourceChanged = source !== undefined || current.rtspTransport !== rtspTransport

				if (source) {
					this.database.db
						.query('UPDATE observatory_cameras SET name = ?, observing_site_id = ?, enabled = ?, sort_order = ?, rtsp_transport = ?, source_ciphertext = ?, source_nonce = ?, source_key_id = ?, source_host = ?, revision = ?, updated_at = ? WHERE id = ?')
						.run(name, observingSiteId ?? null, enabled ? 1 : 0, order, rtspTransport, source.ciphertext, source.nonce, source.keyId, source.host, revision + 1, now, id)
				} else {
					this.database.db.query('UPDATE observatory_cameras SET name = ?, observing_site_id = ?, enabled = ?, sort_order = ?, rtsp_transport = ?, revision = ?, updated_at = ? WHERE id = ?').run(name, observingSiteId ?? null, enabled ? 1 : 0, order, rtspTransport, revision + 1, now, id)
				}

				return { status: 'saved', camera: this.get(id)!, sourceChanged }
			}

			if (!source) return { status: 'sourceRequired' }

			const order = sortOrder ?? this.database.db.query<{ next: number }, []>('SELECT coalesce(max(sort_order) + 1, 0) AS next FROM observatory_cameras').get()!.next
			this.database.db
				.query('INSERT INTO observatory_cameras (id, observing_site_id, name, enabled, sort_order, source_ciphertext, source_nonce, source_key_id, source_host, rtsp_transport, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)')
				.run(id, observingSiteId ?? null, name, enabled ? 1 : 0, order, source.ciphertext, source.nonce, source.keyId, source.host, rtspTransport, now, now)

			return { status: 'saved', camera: this.get(id)!, sourceChanged: true }
		})
	}

	// Deletes a camera. Returns whether it existed.
	remove(id: string): boolean {
		return this.database.write(() => this.database.db.query('DELETE FROM observatory_cameras WHERE id = ?').run(id).changes > 0)
	}
}
