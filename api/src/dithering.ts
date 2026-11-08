import type { EquatorialCoordinate } from 'nebulosa/src/astronomy/coordinates/coordinate'
import { localSiderealTime } from 'nebulosa/src/astronomy/observer/location'
import { timeUnix } from 'nebulosa/src/astronomy/time/time'
import type { GuideOutputCommander } from 'nebulosa/src/devices/commanders/guideoutput'
import type { MountCommander } from 'nebulosa/src/devices/commanders/mount'
import { expectedPierSide, type GuideOutput, type Mount } from 'nebulosa/src/devices/indi/device'
import { type FailedOperationResult, failedOperationResult, type OperationResult, successfulOperationResult } from 'nebulosa/src/devices/orchestration/operation'
import { type ResourceRequest, type ResourceReservation, resourceKey } from 'nebulosa/src/devices/orchestration/resource'
import type { Random } from 'nebulosa/src/math/numerical/random'
import { arcsec } from 'nebulosa/src/math/units/angle'
import type { DitherMode } from 'nebulosa/src/observation/guiding/dither'
import { type DitherAmount, type DitherPhase, type DitherRequest, MountDitherer, settleOnAbort } from 'nebulosa/src/observation/guiding/ditherer'
import type { GuideDirectionDEC, GuideDirectionRA } from 'nebulosa/src/observation/guiding/guider'
import type { GuidingSettle } from 'nebulosa/src/observation/guiding/session'
import { type ClientResolver, type CommandErrorCode, type CommandRefusal, type DeviceContext, refusal, resolveConnected } from './commands'
import type { DeviceRegistry } from './devices'
import type { GuidingSessions } from './guiding'
import type { MeridianFlipService } from './meridianflip'
import type { OperationDevice, OperationRegistry, ToolInvocation } from './operations'

// Automatic dithering of Camera Acquisition: the preflight, the device coordination, and the execution of the dithers a
// capture asks for between its frames, by the method its request names and never another. The capture owns the
// cadence (which frame boundary dithers, see ditherBoundary); this service owns how each dither runs, and what the
// capture holds for it from its admission to its end. A failed dither ends the capture: there is no fallback to another
// method and no skipped dither.
//
// Guided dithers are commands of the running native guiding session, whose dither commands the capture claims for its
// whole life (GuidingSessions.claimDither), so no other dither shifts the lock meanwhile; each resolves with the outcome
// of that exact command, once the guider settled. Nothing physical is held for them: the guider finishes its own settle
// after a stop or an abort. Guided amounts are guide-camera pixels, settle tolerances guide pixels, settle times seconds.
//
// Mount dithers move an unguided mount with the toolkit's MountDitherer, one per capture so its pattern runs across the
// capture: timed pulses through the guide output of the Equipment Setup or a small exact GoTo, never corrected by a pointing
// model, then a fixed mechanical wait, which measures nothing. The Equipment Setup is the truth about the setup: its
// GUIDE_OUTPUT drives its MOUNT, whether it is the mount's own port or the ST4 port of a camera, and nothing here second-
// guesses it. The mount and that guide output are reserved in the arbiter for the whole capture (unless the caller's
// invocation already reserves them), so no manual motion or pulse interleaves, and guiding through that guide output is
// held off. A GoTo dither never flips a German equatorial mount knowingly: on evidence, never the time alone (a flip
// candidate of the Meridian Flip Monitor, or a target whose expected pier side differs from the reported one), the
// capture is refused and a dither fails before the mount moves, and a GoTo after which the mount reports another pier
// side fails the capture. Pulses take the guide directions of the request, the nominal East and North unless the
// operator reversed one. The ST4 port of the camera the capture exposes pulses beside its exposures, since the arbiter
// grants the sensor and the port apart. The end of the capture drains the motion in flight and waits for the observed
// end of its pulses before the reservation is given back. Mount amounts are arcseconds on the sky, settle times seconds,
// pulse durations milliseconds.

// Automatic dither of a capture through the guiding session that guides its setup.
export interface GuidedCaptureDither {
	readonly method: 'guided'
	// Frames taken between two dithers, an integer >= 1.
	readonly everyFrames: number
	// Id of the living native guiding session the dithers are commanded to; it must be guiding.
	readonly guidingSessionId: string
	// Size of each dither, in guide-camera pixels or as an angle in radians.
	readonly amount: DitherAmount
	// Whether each dither moves the RA axis only.
	readonly raOnly: boolean
	// Guided settle each dither waits for: guide error within pixels (guide pixels) for time seconds, at most timeout
	// seconds.
	readonly settle: GuidingSettle
}

// Fields of every automatic dither of a capture that moves an unguided mount.
interface MountCaptureDitherFields {
	readonly method: 'mount'
	// Frames taken between two dithers, an integer >= 1.
	readonly everyFrames: number
	// Mount the dithers move, by its exact connection and device ids.
	readonly mount: OperationDevice
	// Size of each dither on the sky, in arcseconds; > 0.
	readonly amount: number
	// Whether each dither moves the RA axis only.
	readonly raOnly: boolean
	// Pattern of the successive offsets, restarted by every capture.
	readonly pattern: DitherMode
	// Mechanical settle after each motion, in seconds; >= 0.
	readonly settleTime: number
	// Guide output that drives the mount (the GUIDE_OUTPUT of the Equipment Setup), reserved and kept from guiding for the
	// whole capture; absent when the setup has none.
	readonly guideOutput?: OperationDevice
}

// Mount dither by a small exact GoTo of the mount, which must be able to go to a position, unparked and tracking.
export interface SlewCaptureDither extends MountCaptureDitherFields {
	readonly movement: 'slew'
}

// Mount dither by one timed guide pulse per axis, through a guide output that drives the mount.
export interface PulseCaptureDither extends MountCaptureDitherFields {
	readonly movement: 'pulse'
	// Guide output the pulses are sent through: the GUIDE_OUTPUT of the Equipment Setup, which drives the mount.
	readonly guideOutput: OperationDevice
	// Longest pulse of one axis, in milliseconds; > 0. A dither needing a longer one fails without moving.
	readonly maxPulseDuration: number
	// Guide direction that moves the mount toward a positive (east) right ascension offset, as the operator declared it.
	readonly rightAscensionDirection: GuideDirectionRA
	// Guide direction that moves the mount toward a positive (north) declination offset, as the operator declared it.
	readonly declinationDirection: GuideDirectionDEC
}

// Automatic dither of a capture moving an unguided mount.
export type MountCaptureDither = SlewCaptureDither | PulseCaptureDither

// Automatic dither of a capture, by the method it names; absent from a request, the capture never dithers.
export type CaptureDither = GuidedCaptureDither | MountCaptureDither

// Dithers a capture prepared, from its admission to its end.
export interface CaptureDitherPlan {
	readonly ok: true
	// Frames taken between two dithers, an integer >= 1.
	readonly everyFrames: number
	// Dithers once and resolves after the settle, or with the failure that must end the capture; never rejects. token
	// identifies this dither, so a repeated boundary never dithers twice. An abort of signal resolves at once, while the
	// motion it interrupted is drained by finish. onPhase reports the progress synchronously.
	readonly dither: (token: string, signal: AbortSignal, onPhase: (phase: DitherPhase) => void) => Promise<OperationResult<void>>
	// Drains what a dither may still move and gives back what the capture held for its dithers. Idempotent; never rejects.
	readonly finish: () => Promise<void>
	// Lends what the capture reserved for its dithers to another reservation, at once, while the capture is paused between
	// two frames and no dither runs; nothing is lent by a plan that reserved nothing of its own (guided dithers, or mount
	// dithers under the caller's invocation). Refused while a dither holds the mount or the guide output.
	readonly lend: (to: ResourceReservation) => CaptureDitherLending
}

// What the dither reservation of a capture lent to another reservation, to give back before the capture dithers again.
export interface CaptureDitherLoan {
	// Moves the lent mount and guide output back to the reservation of the capture, at once. Returns whether they came
	// back: not while an operation of the borrower still holds one, nor once the capture finished and gave its reservation
	// up, and then what was lent stays in the borrower's reservation until it is released.
	readonly return: () => boolean
}

// Outcome of lending the dither reservation of a capture: the loan, absent when the plan had nothing to lend, or why
// nothing moved.
export type CaptureDitherLending = { readonly ok: true; readonly loan?: CaptureDitherLoan } | { readonly ok: false; readonly error: string }

// Refusal codes of a dither preflight besides the command codes: notGuiding, the guiding session is not guiding;
// guidingActive, guiding corrects a mount the capture would move itself; meridianFlip, a GoTo dither could flip the mount.
export type CaptureDitherErrorCode = 'notGuiding' | 'guidingActive' | 'meridianFlip'

// Outcome of preparing the dithers of a capture: its plan, or why the capture is refused.
export type CaptureDitherPreparation = CaptureDitherPlan | CommandRefusal<CommandErrorCode | CaptureDitherErrorCode>

// Guiding sessions as the dithering service uses them.
export type CaptureDitheringGuiding = Pick<GuidingSessions, 'summaryOf' | 'claimDither' | 'runsOn' | 'hold'>

// Commanders the mount dithers move the mount with, shared with the mount and guide output commands so their manual
// motions and the dithers see the same pulses and slews.
export interface CaptureDitheringCommanders {
	// Slews of the GoTo dithers.
	readonly mount: MountCommander
	// Pulses of the pulse dithers, and the observation of their end.
	readonly guideOutput: GuideOutputCommander
}

// Meridian Flip Monitors as the dithering service reads them.
export type CaptureDitheringMeridianFlip = Pick<MeridianFlipService, 'monitor'>

// Name the dithering service holds guiding commands under, meant for people.
const HOLDER = 'Camera Acquisition'

// Kind of the reservation of the mount and guide output a capture dithering by itself holds, for diagnostics.
const RESERVATION_KIND = 'camera.capture.dither'

// Longest pulse a GoTo ditherer is configured with, in milliseconds: a slew sends no pulse, so any finite positive value
// is never used.
const SLEW_MAX_PULSE_DURATION = 1

// Whether the frame opening generation (the first frame is 1) is preceded by a dither of a capture dithering every
// everyFrames frames: never before the first frame, then before every frame that follows everyFrames frames taken.
export function ditherBoundary(generation: number, everyFrames: number) {
	return generation > 1 && (generation - 1) % everyFrames === 0
}

// Maps a failed dither to the failure that ends its capture, its detail prefixed so the capture says what failed.
function ditherFailure(result: OperationResult<unknown>): OperationResult<void> {
	return result.ok ? successfulOperationResult(undefined) : failedOperationResult(result.reason, `Dither failed: ${result.error ?? result.reason}`)
}

// Dithering service of the camera captures.
export class CaptureDithering implements DeviceContext {
	// Creates the service over the devices of every open connection. client resolves an open connection id to its client,
	// operations arbitrates the mounts and guide outputs the mount dithers reserve, guiding receives the guided dithers and
	// holds guiding off the mounts the capture moves, commanders move the mounts, and random replaces Math.random as the
	// source of the random dither patterns, for reproducible tests.
	constructor(
		readonly devices: DeviceRegistry,
		readonly client: ClientResolver,
		readonly operations: OperationRegistry,
		readonly guiding: CaptureDitheringGuiding,
		readonly commanders: CaptureDitheringCommanders,
		readonly meridianFlip: CaptureDitheringMeridianFlip,
		readonly random?: Random,
	) {}

	// Why a GoTo dither of mount (device, its exact ids) to target (JNOW, radians) could flip its pier side, and the status refusing a capture
	// for it, or undefined when nothing suggests a flip. Evidence only, never the time alone: the Meridian Flip Monitor
	// of the mount reporting a flip candidate, or the pier side a German equatorial mount uses for the target (from the
	// hour angle at the site and the host clock) differing from the one it reports. An altazimuth or fork mount never
	// flips; any other mount must report its pier side and its site, or a flip could not be ruled out.
	#flipRisk(mount: Mount, device: OperationDevice, target: EquatorialCoordinate): { readonly message: string; readonly status: 409 | 422 } | undefined {
		if (mount.mountType === 'ALTAZ' || mount.mountType === 'EQ_FORK') return undefined
		if (this.meridianFlip.monitor(device.connectionId, device.deviceId)?.mechanical === 'flipCandidate') return { message: `The Meridian Flip Monitor of ${mount.name} reports that a flip may be due`, status: 409 }
		if (!mount.hasPierSide || mount.pierSide === 'NEITHER') return { message: `${mount.name} reports no pier side, so a meridian flip of a GoTo could not be ruled out`, status: 422 }
		if (!mount.hasGeographicCoordinate) return { message: `${mount.name} reports no site, so a meridian flip of a GoTo could not be ruled out`, status: 422 }

		const lst = localSiderealTime(timeUnix(Date.now() / 1000, true), mount.geographicCoordinate.longitude)
		const expected = expectedPierSide(target.rightAscension, target.declination, lst)
		if (expected !== 'NEITHER' && expected !== mount.pierSide) return { message: `A GoTo of ${mount.name} there would cross the meridian and could flip it`, status: 409 }
		return undefined
	}

	// Refuses a dither GoTo of mount to target whose meridian flip cannot be ruled out (see #flipRisk), without moving it.
	#refuseFlip(mount: Mount, device: OperationDevice, target: EquatorialCoordinate): FailedOperationResult | undefined {
		const risk = this.#flipRisk(mount, device, target)
		return risk && failedOperationResult('unexpectedState', risk.message)
	}

	// Prepares the dithers of a capture before it is admitted, under the reservation of invocation when a caller
	// composing tools admits it: checks the method can dither now and takes what the capture holds for its dithers.
	// Synchronous, so nothing changes between the checks and the admission. Refused with 404 for an unknown guiding
	// session, mount, or guide output; 409 notGuiding while the guiding session is not guiding, guidingActive while guiding
	// corrects the mount to move, disconnected for a disconnected device, and busy while another claimant holds the
	// guided dithers or another operation holds the mount or the guide output; 422 unsupported when the mount or the guide
	// output cannot move as asked.
	prepare(dither: CaptureDither, invocation?: ToolInvocation): CaptureDitherPreparation {
		return dither.method === 'guided' ? this.#guided(dither) : this.#mount(dither, invocation)
	}

	// Prepares guided dithers: the session must be guiding, and its dither commands are claimed until finish.
	#guided({ everyFrames, guidingSessionId, amount, raOnly, settle }: GuidedCaptureDither): CaptureDitherPreparation {
		const summary = this.guiding.summaryOf(guidingSessionId)
		if (!summary) return refusal('No guiding session is running with this id', 404, 'notFound')
		if (summary.state !== 'guiding') return refusal(`${summary.cameraName} is not guiding`, 409, 'notGuiding')

		const claim = this.guiding.claimDither(guidingSessionId, HOLDER)
		if (!claim.ok) return claim

		return {
			ok: true,
			everyFrames,
			dither: async (token, signal, onPhase) => {
				onPhase('dithering')
				const admitted = claim.admitDither({ token, amount, raOnly, settle })
				if (!admitted.ok) return failedOperationResult(admitted.code === 'busy' ? 'busy' : 'unexpectedState', `Dither failed: ${admitted.error}`)

				const settled = admitted.settled.then((status): OperationResult<void> => (status.state === 'succeeded' ? successfulOperationResult(undefined) : failedOperationResult(status.reason ?? 'commandFailed', `Dither failed: ${status.error ?? status.reason ?? 'the guider did not settle'}`)))
				const result = await settleOnAbort(settled, signal)
				if (result.ok) onPhase('settled')
				return result
			},
			finish: () => {
				claim[Symbol.dispose]()
				return Promise.resolve()
			},
			lend: () => ({ ok: true }),
		}
	}

	// Prepares mount dithers: resolves the mount and the guide output that drives it, refuses while guiding through that
	// guide output corrects the mount or when the mount cannot move as asked, reserves both unless the caller's invocation
	// already does, and holds guiding through the guide output off.
	#mount(dither: MountCaptureDither, invocation?: ToolInvocation): CaptureDitherPreparation {
		const resolvedMount = resolveConnected(this, dither.mount.connectionId, 'mount', dither.mount.deviceId, 'Mount')
		if (!resolvedMount.ok) return resolvedMount
		const mount = resolvedMount.device

		let guideOutput: GuideOutput | undefined

		if (dither.guideOutput) {
			const resolved = resolveConnected(this, dither.guideOutput.connectionId, 'guideOutput', dither.guideOutput.deviceId, 'Guide output')
			if (!resolved.ok) return resolved
			guideOutput = resolved.device
			if (this.guiding.runsOn(dither.guideOutput).length > 0) return refusal('Guiding is correcting the mount; dither through it, or stop it first', 409, 'guidingActive')
		}

		if (dither.movement === 'slew') {
			if (!mount.canGoTo) return refusal(`${mount.name} cannot go to a position`, 422, 'unsupported')
			if (mount.parked || mount.parking) return refusal(`${mount.name} is parked`, 422, 'unsupported')
			if (!mount.tracking) return refusal(`${mount.name} is not tracking`, 422, 'unsupported')
			// The pointing itself is the first target: a mount that would flip on a GoTo to it never starts dithering by GoTo.
			const risk = this.#flipRisk(mount, dither.mount, mount.equatorialCoordinate)
			if (risk) return refusal(risk.message, risk.status, risk.status === 409 ? 'meridianFlip' : 'unsupported')
		} else if (guideOutput && !guideOutput.canPulseGuide) {
			return refusal(`${guideOutput.name} cannot pulse`, 422, 'unsupported')
		}

		// The ST4 port of the camera the capture exposes is a capability of its own, apart from the sensor the capture holds, so it
		// is reserved and pulsed like any other guide output.
		const devices = guideOutput ? [mount, guideOutput] : [mount]
		const requests: ResourceRequest[] = devices.map((device) => ({ key: resourceKey(device), device }))
		const owner = { id: Bun.randomUUIDv7(), kind: RESERVATION_KIND }
		let reserved: ToolInvocation | undefined

		if (invocation) {
			if (!devices.every((device) => this.operations.reserves(device, invocation))) return refusal('The mount or the guide output is not reserved by the invocation', 409, 'busy')
		} else {
			if (!devices.every((device) => this.operations.available(device))) return refusal('The mount or the guide output is busy', 409, 'busy')
			const reservation = this.operations.arbiter.reserve(owner, requests)
			if (!reservation.ok) return refusal('The mount or the guide output is busy', 409, 'busy')
			reserved = { reservation: reservation.reservation }
		}

		// The dithers run as roots of the reservation, beside the capture, which holds the camera through its own scope.
		const scope = this.operations.scope(invocation ?? reserved)
		const hold = dither.guideOutput && this.guiding.hold(dither.guideOutput, HOLDER)

		const ditherer = new MountDitherer(
			mount,
			guideOutput,
			{ mountCommander: this.commanders.mount, guideOutputCommander: this.commanders.guideOutput },
			dither.movement === 'pulse'
				? { method: 'pulse', pattern: dither.pattern, random: this.random, maxPulseDuration: dither.maxPulseDuration, rightAscensionDirection: dither.rightAscensionDirection, declinationDirection: dither.declinationDirection }
				: { method: 'slew', pattern: dither.pattern, random: this.random, maxPulseDuration: SLEW_MAX_PULSE_DURATION, beforeSlew: (target) => this.#refuseFlip(mount, dither.mount, target) },
		)

		const request: DitherRequest = { amount: { unit: 'angle', value: arcsec(dither.amount) }, raOnly: dither.raOnly, settle: { kind: 'mechanical', time: dither.settleTime } }
		let inFlight: Promise<unknown> | undefined
		let finished: Promise<void> | undefined

		return {
			ok: true,
			everyFrames: dither.everyFrames,
			dither: async (_, signal, onPhase) => {
				// A device lost since the previous dither leaves its reservation in place, so its absence is told before it is commanded.
				if (!ditherer.ready()) return failedOperationResult('disconnected', `Dither failed: ${mount.name} or its guide output is not ready`)

				const pierSide = mount.pierSide
				const handle = scope.start('captureDither', [], (context) => ditherer.dither(context, request, onPhase))
				const cancel = () => void handle.cancel()
				signal.addEventListener('abort', cancel, { once: true })
				if (signal.aborted) cancel()
				inFlight = handle.result

				try {
					const result = await handle.result
					// A GoTo the checks let through may still flip a mount whose driver decides otherwise: the field turned, so the
					// capture must not go on as if nothing happened.
					if (result.ok && dither.movement === 'slew' && mount.pierSide !== pierSide) return failedOperationResult('unexpectedState', `Dither failed: ${mount.name} changed its pier side from ${pierSide} to ${mount.pierSide}, so the field turned`)
					return ditherFailure(result)
				} finally {
					signal.removeEventListener('abort', cancel)
				}
			},
			finish: () => {
				finished ??= (async () => {
					await inFlight
					// A pulse cancelled in flight keeps its guide output unavailable until its end was observed, within the release bound.
					const quiescent = await ditherer.awaitPulseQuiescence(new AbortController().signal)
					if (!quiescent.ok) console.error(`the end of the dither pulses of ${guideOutput?.name} could not be observed:`, quiescent.error ?? quiescent.reason)
					if (reserved) {
						await this.operations.coordinator.cancelByReservationOwner(owner)
						reserved.reservation.release()
					}
					hold?.[Symbol.dispose]()
				})()

				return finished
			},
			lend: (to) => {
				if (!reserved) return { ok: true }

				const own = reserved.reservation
				const keys = requests.map((request) => request.key)
				const lent = this.operations.arbiter.transfer(own, to, keys)
				if (!lent.ok) return { ok: false, error: 'A dither still holds the mount or the guide output' }

				return { ok: true, loan: { return: () => this.operations.arbiter.transfer(to, own, keys).ok } }
			},
		}
	}
}
