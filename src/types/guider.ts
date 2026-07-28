import { DEFAULT_PHD2_SETTLE } from 'nebulosa/src/devices/guiding/phd2'
import type { PHD2Settle } from 'nebulosa/src/devices/guiding/phd2'
import { DEFAULT_CAMERA_CAPTURE_START } from '#/camera'
import type { CameraCaptureStart } from '#/camera'
import type { HostAndPort } from '#/connection'
import type { OperationResult } from '#/orchestration'

export type GuiderClientMode = 'local' | 'remote'

export type GuiderState = 'idle' | 'calibrating' | 'settling' | 'guiding' | 'looping' | 'starLost' | 'paused'

export interface GuiderRemoteConnect extends Readonly<HostAndPort> {
	readonly dither: GuiderDither
	readonly mode: 'remote'
}

export interface GuiderLocalConnect {
	readonly dither: GuiderDither
	readonly focalLength: number
	readonly camera: string
	readonly guideOutput: string
	readonly capture: Omit<CameraCaptureStart, 'dither'>
	readonly mode: 'local'
}

export type GuiderConnect = GuiderRemoteConnect | GuiderLocalConnect

export type GuiderConnected = OperationResult<GuiderSessionInfo>

export interface GuiderEvent {
	id: string
	state: GuiderState
	rmsRA: number
	rmsDEC: number
	starMass: number
	snr: number
	hfd: number
	readonly step: {
		ra: number | null
		dec: number | null
		raCorrection: number | null
		decCorrection: number | null
		dx: number | null
		dy: number | null
	}
}

export interface GuiderDither {
	amount: number
	raOnly: boolean
	readonly settle: PHD2Settle
}

export interface GuiderStatus {
	connected: boolean
	looping: boolean
	running: boolean
	profile?: string
}

// One open guider session, as the transport enumerates and identifies it. Several may exist at once, so
// every event and every command names one through its id.
export interface GuiderSessionInfo {
	// Stable identifier of the session, which is the id of the operation holding it.
	readonly id: string
	// Whether the session drives local devices or talks to a remote server.
	readonly mode: GuiderClientMode
	// Logical resource key of what the session occupies, which is what refuses a duplicate connection.
	readonly key: string
	// Human-readable description of the target, for listings and diagnostics.
	readonly target: string
	// Latest presentation state.
	readonly state: GuiderState
	// Whether the transport is still attached.
	readonly connected: boolean
	// Whether the guider is looping exposures without guiding.
	readonly looping: boolean
	// Whether the guider is actively guiding.
	readonly running: boolean
}

export const DEFAULT_GUIDER_DITHER: Required<GuiderDither> = {
	amount: 5,
	raOnly: false,
	settle: DEFAULT_PHD2_SETTLE,
}

export const DEFAULT_GUIDER_EVENT: GuiderEvent = {
	id: '',
	state: 'idle',
	rmsRA: 0,
	rmsDEC: 0,
	starMass: 0,
	snr: 0,
	hfd: 0,
	step: {
		ra: null,
		dec: null,
		raCorrection: null,
		decCorrection: null,
		dx: null,
		dy: null,
	},
}

export const DEFAULT_GUIDER_REMOTE_CONNECT: GuiderRemoteConnect = {
	mode: 'remote',
	host: 'localhost',
	port: 4400,
	dither: DEFAULT_GUIDER_DITHER,
}

export const DEFAULT_GUIDER_INTERNAL_CONNECT: GuiderLocalConnect = {
	mode: 'local',
	focalLength: 0,
	camera: '',
	guideOutput: '',
	capture: structuredClone(DEFAULT_CAMERA_CAPTURE_START),
	dither: DEFAULT_GUIDER_DITHER,
}

export function canConnectRemote({ host, port }: HostAndPort) {
	return host.trim().length > 0 && Number.isInteger(port) && port >= 80 && port <= 65535
}
