import { DEFAULT_PHD2_SETTLE } from 'nebulosa/src/devices/guiding/phd2'
import type { PHD2Settle } from 'nebulosa/src/devices/guiding/phd2'
import { DEFAULT_CAMERA_CAPTURE_START } from '#/camera'
import type { CameraCaptureStart } from '#/camera'
import type { HostAndPort } from '#/connection'
import type { OperationResult } from '#/orchestration'

export type GuiderClientMode = 'local' | 'remote'

export type GuiderState = 'idle' | 'calibrating' | 'settling' | 'guiding' | 'looping' | 'starLost' | 'paused'

export interface GuiderRemoteConnect extends Readonly<HostAndPort> {
	readonly mode: 'remote'
}

export interface GuiderLocalConnect {
	readonly focalLength: number
	readonly camera: string
	readonly guideOutput: string
	readonly mode: 'local'
}

export type GuiderConnect = GuiderRemoteConnect | GuiderLocalConnect

export type GuiderConnected = OperationResult<GuiderSessionInfo>

export interface GuiderLoopStart {
	readonly capture: CameraCaptureStart
	readonly settle: PHD2Settle
}

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
}

// Progress of one dither, from the command until its terminal settle. It is reported back to whoever asked
// for the dither through the call itself, so a caller never has to tell its own progress apart from the
// progress of another session.
export type GuiderDitherPhase = 'dithering' | 'dithered' | 'settling' | 'settled'

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
	// Logical key identifying what the session occupies. A local session reserves its camera and its guide
	// output separately, so this names the pair for listings rather than being the single lease it holds.
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
}

export const DEFAULT_GUIDER_INTERNAL_CONNECT: GuiderLocalConnect = {
	mode: 'local',
	focalLength: 0,
	camera: '',
	guideOutput: '',
}

export const DEFAULT_GUIDER_LOOP_START: GuiderLoopStart = {
	capture: DEFAULT_CAMERA_CAPTURE_START,
	settle: DEFAULT_PHD2_SETTLE,
}

export function canConnectRemote({ host, port }: HostAndPort) {
	return host.trim().length > 0 && Number.isInteger(port) && port >= 80 && port <= 65535
}
