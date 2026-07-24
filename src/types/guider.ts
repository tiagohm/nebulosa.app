import { DEFAULT_PHD2_SETTLE } from 'nebulosa/src/devices/guiding/phd2'
import type { PHD2Settle } from 'nebulosa/src/devices/guiding/phd2'
import { DEFAULT_CAMERA_CAPTURE_START } from '#/camera'
import type { CameraCaptureStart } from '#/camera'
import type { HostAndPort } from '#/connection'

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

export interface GuiderEvent {
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
	readonly amount: number
	readonly raOnly: boolean
	readonly settle: PHD2Settle
}

export interface GuiderStatus {
	connected: boolean
	looping: boolean
	running: boolean
	profile?: string
}

export const DEFAULT_GUIDER_DITHER: Required<GuiderDither> = {
	amount: 5,
	raOnly: false,
	settle: DEFAULT_PHD2_SETTLE,
}

export const DEFAULT_GUIDER_EVENT: GuiderEvent = {
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
