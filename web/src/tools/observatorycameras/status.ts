import type { GatewayState, ObservatoryCamera, ObservatoryCameraStream } from 'api'
import type { StatusTone } from '../../ui/StatusBadge'
import { STREAM_CODE_LABELS } from './observatorycameras'
import type { PlayerEntry } from './player'

// What the status of a camera shows: the state of this tab's player when there is one, else the state of its stream on
// the server; each in words, never a color alone. A failure the operator fixes in the editor says so. Also the text of a
// frame without video and the viewers line of a camera.

// Status of a camera as shown.
export interface CameraStatus {
	// Tone of the badge.
	readonly tone: StatusTone
	// State in words.
	readonly label: string
	// Explanation, such as why it failed and how to fix it.
	readonly detail?: string
}

// Explanation of each code of the server that refuses a stream, with the way out; a code without one shows the message of
// the server.
const CODE_HINTS: Readonly<Record<string, string>> = {
	sourceAuthFailed: 'The camera refused the user or password of its address. Correct the address in Edit.',
	sourceNotFound: 'The camera has no stream at the path of its address. Correct the address in Edit.',
	sourceUnreachable: 'The server cannot reach the camera. Check that it is on and on the network of the server, or correct its address in Edit.',
	secretKeyMismatch: 'The address was saved with another key. Type it again in Edit.',
	unsupportedCodec: 'The browser cannot play what the camera sends. Choose an H.264 stream without B-frames, such as a substream, in Edit.',
}

// Returns the explanation of a failure: the hint of its code when there is one, else the message given.
function failureDetail(code: string | undefined, message: string | undefined) {
	return (code !== undefined ? CODE_HINTS[code] : undefined) ?? message
}

// Returns the status of a camera from its definition, its stream on the server, its player in this tab, and the gateway.
export function cameraStatus(camera: ObservatoryCamera, stream: ObservatoryCameraStream | undefined, player: Pick<PlayerEntry, 'status' | 'error' | 'code'> | undefined, gateway: GatewayState | undefined): CameraStatus {
	if (!camera.enabled) return { tone: 'muted', label: 'Disabled' }

	if (player) {
		switch (player.status) {
			case 'playing':
				return { tone: 'success', label: 'Live' }
			case 'connecting':
				return { tone: 'active', label: 'Connecting' }
			case 'reconnecting':
				return { tone: 'warning', label: 'Reconnecting', detail: player.error }
			case 'paused':
				return { tone: 'neutral', label: 'Paused', detail: 'The preview resumes when it is shown again.' }
			case 'failed':
				return { tone: 'danger', label: 'Failed', detail: failureDetail(player.code, player.error) }
		}
	}

	if (gateway?.status === 'notInstalled') return { tone: 'muted', label: 'MediaMTX not installed' }
	if (stream?.state === 'unavailable') return { tone: 'danger', label: stream.code ? STREAM_CODE_LABELS[stream.code] : 'Unavailable', detail: failureDetail(stream.code, undefined) }
	if (stream?.state === 'ready') return { tone: 'success', label: 'Live elsewhere' }
	if (stream?.state === 'connecting') return { tone: 'active', label: 'Connecting elsewhere' }
	return { tone: 'neutral', label: 'Idle' }
}

// Returns the text of the frame of a camera while it shows no video: picture-in-picture, the state of the player until
// its first frame, or a stopped preview.
export function frameText(player: Pick<PlayerEntry, 'status'> | undefined, inPictureInPicture: boolean): string {
	if (inPictureInPicture) return 'Playing in picture-in-picture'

	switch (player?.status) {
		case 'connecting':
			return 'Connecting…'
		case 'reconnecting':
			return 'Reconnecting…'
		case 'paused':
			return 'Paused'
		case 'failed':
			return 'Failed'
		case 'playing':
			return 'Live'
		default:
			return 'Preview stopped'
	}
}

// Returns the viewers of a camera other than this tab, from the readers the gateway counts (this tab's session among
// them while it has one), as words; undefined when there are none.
export function otherViewers(readers: number, watching: boolean): string | undefined {
	const others = readers - (watching ? 1 : 0)
	if (others <= 0) return undefined
	return `${others} other ${others === 1 ? 'viewer' : 'viewers'}`
}
