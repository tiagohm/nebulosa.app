import type { GatewayState, ObservatoryCamera, ObservatoryCameraStream } from 'api'
import type { StatusTone } from '../../ui/StatusBadge'
import { STREAM_CODE_LABELS } from './observatorycameras'
import type { PlayerEntry } from './player'

// What the status of a camera shows: the state of this tab's player when there is one, else the state of its stream on
// the server; each in words, never a color alone.

// Status of a camera as shown.
export interface CameraStatus {
	// Tone of the badge.
	readonly tone: StatusTone
	// State in words.
	readonly label: string
	// Explanation, such as why it failed.
	readonly detail?: string
}

// Returns the status of a camera from its definition, its stream on the server, its player in this tab, and the gateway.
export function cameraStatus(camera: ObservatoryCamera, stream: ObservatoryCameraStream | undefined, player: Pick<PlayerEntry, 'status' | 'error' | 'docked'> | undefined, gateway: GatewayState | undefined): CameraStatus {
	if (!camera.enabled) return { tone: 'muted', label: 'Disabled' }

	if (player) {
		switch (player.status) {
			case 'playing':
				return { tone: 'success', label: player.docked ? 'Live in mini-player' : 'Live' }
			case 'connecting':
				return { tone: 'active', label: 'Connecting' }
			case 'reconnecting':
				return { tone: 'warning', label: 'Reconnecting', detail: player.error }
			case 'paused':
				return { tone: 'neutral', label: 'Paused', detail: 'The preview resumes when it is shown again.' }
			case 'failed':
				return { tone: 'danger', label: 'Failed', detail: player.error }
		}
	}

	if (gateway?.status === 'notInstalled') return { tone: 'muted', label: 'Gateway not installed' }
	if (stream?.state === 'unavailable') return { tone: 'danger', label: stream.code ? STREAM_CODE_LABELS[stream.code] : 'Unavailable' }
	if (stream?.state === 'ready') return { tone: 'success', label: 'Live elsewhere' }
	if (stream?.state === 'connecting') return { tone: 'active', label: 'Connecting elsewhere' }
	return { tone: 'neutral', label: 'Idle' }
}

// Formats an elapsed time in seconds as m:ss, or h:mm:ss past an hour.
export function formatElapsed(seconds: number) {
	const total = Math.max(0, Math.floor(seconds))
	const hours = Math.floor(total / 3600)
	const minutes = Math.floor((total % 3600) / 60)
	const rest = String(total % 60).padStart(2, '0')
	return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`
}
