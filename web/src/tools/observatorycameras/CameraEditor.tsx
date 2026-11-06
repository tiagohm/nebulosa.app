import type { ObservatoryCamera, RtspTransport } from 'api'
import { useState } from 'react'
import { useSnapshot } from 'valtio'
import { siteState } from '../../location/site'
import { Button } from '../../ui/Button'
import { Checkbox } from '../../ui/Checkbox'
import { ConfirmButton } from '../../ui/ConfirmButton'
import { Modal, ModalActions } from '../../ui/Modal'
import { Notice } from '../../ui/Notice'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { Select } from '../../ui/Select'
import { TextInput } from '../../ui/TextInput'
import { observatoryCamerasState, removeCamera, saveCamera } from './observatorycameras'
import { stopPlayer } from './player'

// Editor of an observatory camera: its name, site, RTSP address, transport, and whether it is enabled. The address is
// write-only: the server never gives it back, so editing a camera starts with an empty address, which keeps the saved
// one, and typing one replaces it. Saving sends the revision the editor opened with, so a camera changed meanwhile by
// another client is reported instead of overwritten.

// Value of the site field of a camera shared by every site.
const SHARED = ''

// Transports offered.
const TRANSPORTS: readonly RtspTransport[] = ['tcp', 'automatic']

// Text of each transport.
const TRANSPORT_LABELS: Readonly<Record<RtspTransport, string>> = { tcp: 'TCP', automatic: 'Automatic' }

// Props of the editor.
export interface CameraEditorProps {
	// Camera edited; undefined to add one.
	readonly camera?: ObservatoryCamera
	// Site a new camera starts in; undefined for every site.
	readonly defaultSiteId?: string
	// Closes the editor.
	readonly onClose: () => void
}

// Editor of a camera in a dialog; mounted while open.
export function CameraEditor({ camera, defaultSiteId, onClose }: CameraEditorProps) {
	const { sites } = useSnapshot(siteState)
	const [id] = useState(() => camera?.id ?? crypto.randomUUID())
	const [name, setName] = useState(camera?.name ?? '')
	const [siteId, setSiteId] = useState(camera ? (camera.observingSiteId ?? SHARED) : (defaultSiteId ?? SHARED))
	const [source, setSource] = useState('')
	const [enabled, setEnabled] = useState(camera?.enabled ?? true)
	const [transport, setTransport] = useState<RtspTransport>(camera?.rtspTransport ?? 'tcp')
	const [saving, setSaving] = useState(false)
	const [error, setError] = useState<string>()
	const siteOptions = [SHARED, ...sites.map((site) => site.id)]
	const valid = name.trim().length > 0 && (camera !== undefined || source.trim().length > 0)

	async function save() {
		setSaving(true)
		setError(undefined)
		const result = await saveCamera(observatoryCamerasState, id, { name: name.trim(), observingSiteId: siteId || undefined, enabled, rtspTransport: transport, source }, camera?.revision ?? 0)
		setSaving(false)
		if (result.status === 'saved') onClose()
		else setError(result.status === 'conflict' ? 'The camera was changed by another client. Close and edit it again.' : result.error)
	}

	async function remove() {
		if (!camera) return
		stopPlayer(camera.id)
		const failure = await removeCamera(observatoryCamerasState, camera.id)
		if (failure) setError(failure)
		else onClose()
	}

	return (
		<Modal open onClose={onClose} title={camera ? 'Edit Camera' : 'Add Camera'} className="max-w-lg">
			<form
				className="flex flex-col gap-4"
				onSubmit={(event) => {
					event.preventDefault()
					if (valid && !saving) void save()
				}}
			>
				<TextInput label="Name" value={name} onChange={(event) => setName(event.target.value)} data-autofocus maxLength={80} />
				<Select label="Observing Site" options={siteOptions} value={siteId} onChange={setSiteId} format={(value) => (value === SHARED ? 'Every site' : (sites.find((site) => site.id === value)?.name ?? value))} />
				<TextInput label="RTSP Address" value={source} onChange={(event) => setSource(event.target.value)} placeholder={camera ? 'Saved; type a new address to replace it' : 'rtsp://user:password@host:554/path'} autoComplete="off" spellCheck={false} />
				<SegmentedControl label="RTSP Transport" options={TRANSPORTS} value={transport} onChange={setTransport} format={(value) => TRANSPORT_LABELS[value]} />
				<Checkbox label="Enabled" checked={enabled} onChange={setEnabled} />
				<Notice>The address is stored encrypted on the server and never shown again. Prefer an H.264 stream without B-frames, such as a substream of the camera; video is relayed as the camera sends it, never transcoded.</Notice>
				{error && <Notice error>{error}</Notice>}
				<ModalActions>
					{camera && (
						<ConfirmButton title="Delete the camera?" message={`${camera.name} and its address are deleted from the server.`} confirmLabel="Delete" onConfirm={() => void remove()}>
							Delete
						</ConfirmButton>
					)}
					<Button variant="secondary" onClick={onClose}>
						Cancel
					</Button>
					<Button type="submit" disabled={!valid || saving}>
						{saving ? 'Saving…' : 'Save'}
					</Button>
				</ModalActions>
			</form>
		</Modal>
	)
}
