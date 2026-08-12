import { isCamera, isCover, isFlatPanel, isFocuser, isMount, isRotator, isWheel } from 'nebulosa/src/devices/indi/device'
import type { Wheel } from 'nebulosa/src/devices/indi/device'
import { toDeg } from 'nebulosa/src/math/units/angle'
import type { Angle } from 'nebulosa/src/math/units/angle'
import { failedOperationResult, successfulOperationResult } from '#/orchestration'
import type { OperationResult } from '#/orchestration'
import type { SequencerCooling, SequencerCover, SequencerFilterFocusOffset, SequencerFilterReference, SequencerFlatPanel, SequencerRotator } from '#/sequencer'
import type { SequencerPlanFrameGroup } from '#/sequencer.plan'
import type { CoverCommander } from './cover.commander'
import type { FlatPanelCommander } from './flatpanel.commander'
import type { FocuserCommander } from './focuser.commander'
import type { MountCommander } from './mount.commander'
import { abortableDelay } from './operation.wait'
import type { RotatorCommander } from './rotator.commander'
import { sequencerActionFailure, sequencerDeviceOf, sequencerSettle } from './sequencer.action'
import { sequencerFilterSlot, sequencerFocusOffsetShift } from './sequencer.optics'
import type { SequencerActionContext, SequencerActionResult } from './sequencer.registry'
import type { WheelCommander } from './wheel.commander'

// Frame preparation as the reconciliation of the optical path with what the selected frame requires.
//
// Preparing is not "changing the filter". It is the difference between what the devices report right now and
// the physical context the frame demands, which is derived from its type, its filter and the declared
// policies. Only the differences are commanded. That is what makes a flat followed by a light work with no
// rule written for it: the light does not undo the flat, it simply requires the panel off and the cover open,
// and the difference produces both actions. A restoration would have to know where it came from, and would be
// wrong on every transition it did not anticipate.
//
// The device is the authority on the current state, never a hint kept in the checkpoint: a session resumed
// after a crash, or a cover someone moved by hand, must be read from the hardware and not from what the last
// frame believed.
//
// The order inside the step is fixed, and it exists for physical safety: the panel is turned off first and lit
// last, so the cover never travels with the light on and the light never comes on with the cover open. The
// thermal wait sits at the end, after everything that can warm or cool the sensor and before the lamp is lit,
// so no lamp hours are spent waiting.
//
// The camera overrides of the frame — gain, offset, binning, region, format — are part of the same context but
// are not reconciled here: they travel inside the capture request itself, already merged over the declared
// defaults, so there is nothing to command ahead of the exposure.
//
// Angles are radians in the definition and degrees on the rotator; temperatures are degrees Celsius; declared
// timeouts and settles are seconds, while the commanders below take milliseconds.

// One reconciliation the preparation actually commanded, in the order they are issued.
export type SequencerPreparationStep = 'tracking' | 'panelOff' | 'cover' | 'filter' | 'focusOffset' | 'rotator' | 'cooling' | 'panelOn'

// Physical context one frame requires, derived from the frame and the declared policies.
//
// Every dimension is optional, and absent means the frame requires nothing of it: either the role is not part
// of the session, or the policy that would demand something is disabled. Absent is never "restore to a
// default", which is the distinction the whole step is built on.
export interface SequencerFrameContext {
	// Cover position the frame requires.
	readonly cover?: 'open' | 'closed'
	// Whether the panel must be lit, and at which brightness in the panel's own intensity units when it must.
	readonly panel?: { readonly lit: boolean; readonly brightness: number }
	// Whether the mount must be tracking, required by light frames and indifferent for every other type.
	readonly tracking?: boolean
	// Filter the frame is exposed through, absent when the frame names none.
	readonly filter?: SequencerFilterReference
	// Sky position angle the frame requires, in radians.
	readonly angle?: Angle
	// Sensor temperature the frame requires to be within tolerance of, in degrees Celsius.
	readonly temperature?: number
}

// Which roles the session actually carries, which decides what the context is allowed to require.
//
// A dimension only exists when its role does: a definition without a cover generates no cover reconciliation
// rather than failing on a device it never had. The panel decides more than its own dimension, because a flat
// is only a panel flat when a panel is there to light it; a flat without one collects sky and requires the
// cover open exactly like a light does.
export interface SequencerFrameDevices {
	// Wheel the session commands, used to resolve the per-filter brightness table.
	readonly wheel?: Wheel
	// Whether the session commands a cover.
	readonly cover: boolean
	// Whether the session commands a flat panel.
	readonly flatPanel: boolean
}

// Selected frame and the declared policies its context is derived from.
export interface SequencerFramePreparation {
	// Frame group about to be exposed, with its type, its filter and its camera settings already resolved.
	readonly group: SequencerPlanFrameGroup
	// Cover policy, absent when the definition declares no cover feature.
	readonly cover?: Omit<SequencerCover, 'enabled'>
	// Flat panel policy, absent when the definition declares no panel feature.
	readonly flatPanel?: Omit<SequencerFlatPanel, 'enabled'>
	// Rotator policy, absent when the definition declares no rotator feature.
	readonly rotator?: Omit<SequencerRotator, 'enabled'>
	// Thermal policy, absent when the definition declares no cooling feature. The preparation only ever waits
	// on it; commanding the setpoint belongs to the startup pipeline.
	readonly cooling?: Omit<SequencerCooling, 'enabled'>
	// Focuser offsets per filter, in device steps, applied when the reconciliation moves the wheel.
	readonly filterOffsets: readonly SequencerFilterFocusOffset[]
}

// Collaborators the preparation commands, one per dimension of the context.
export interface SequencerPreparationServices {
	// Owner of the wheel, which the required filter is reached through.
	readonly wheelCommander: WheelCommander
	// Owner of the focuser, used only to carry the focus across a filter change.
	readonly focuserCommander: FocuserCommander
	// Owner of the cover.
	readonly coverCommander: CoverCommander
	// Owner of the flat panel.
	readonly flatPanelCommander: FlatPanelCommander
	// Owner of the rotator.
	readonly rotatorCommander: RotatorCommander
	// Owner of the mount, used only to put tracking back on for a light frame.
	readonly mountCommander: MountCommander
}

// What the preparation left behind, which is the difference it had to command and nothing else.
export interface SequencerPreparationOutcome {
	// Context the frame required, as it was derived.
	readonly context: SequencerFrameContext
	// Reconciliations actually issued, in order. A frame taken right after another one of the same group
	// commands nothing and reports an empty list.
	readonly commanded: readonly SequencerPreparationStep[]
	// Slot the wheel was left standing at, 0-based, absent when the session commands no wheel or the frame
	// names no filter.
	readonly slot?: number
	// Focuser correction applied across a filter change, in device steps, absent when none was.
	readonly focusShift?: number
	// Sensor temperature observed when a thermal wait ended, in degrees Celsius, absent when none was made.
	readonly temperature?: number
}

// Milliseconds between two samples of the sensor temperature during the thermal wait.
//
// The preparation holds device references rather than a subscription, so convergence is sampled instead of
// awaited. A cooler moves a few degrees per minute, which this interval is two orders of magnitude below.
const SEQUENCER_THERMAL_SAMPLE = 1000

// Brightness the panel must be lit at for one frame, in the panel's own intensity units.
//
// The per-filter table wins when it names the filter of the frame, since a narrowband flat needs far more
// light than a broadband one, and the declared default answers for every filter the table does not name. A
// reference neither the wheel nor the table can resolve falls back to the default, for the same reason it is
// ignored everywhere else: it names a filter this wheel does not carry.
function panelBrightness(panel: Omit<SequencerFlatPanel, 'enabled'>, wheel: Wheel | undefined, filter: SequencerFilterReference | undefined): number {
	if (wheel === undefined || filter === undefined) return panel.brightness

	const slot = sequencerFilterSlot(wheel, filter)

	if (slot === undefined) return panel.brightness

	for (const entry of panel.brightnessByFilter) {
		if (sequencerFilterSlot(wheel, entry.filter) === slot) return entry.brightness
	}

	return panel.brightness
}

// Shortest angular distance between two rotator angles, in degrees within 0..180.
//
// A rotator angle is circular, so the difference of the two numbers is not the distance between them: 359.5°
// and 0.5° are one degree apart mechanically and 359 degrees apart arithmetically. Compared without the wrap,
// a field already inside tolerance reads as a whole turn away, and the preparation commands a full rotation
// plus its settle before every frame that lands near the origin.
function angularDistance(from: number, to: number): number {
	const delta = Math.abs(from - to) % 360
	return delta > 180 ? 360 - delta : delta
}

// Derives the physical context of one frame from its type and the declared policies.
//
// The frame type decides the cover, the panel and the tracking; the filter, the angle and the temperature are
// required by every type alike. Nothing here reads the `calibration` block: the selected frame is the only
// source of truth, so a dark written by hand into the plan does not change meaning with a policy block it
// never came from.
export function sequencerFrameContext(preparation: SequencerFramePreparation, devices: SequencerFrameDevices): SequencerFrameContext {
	const { group, cover, flatPanel, rotator, cooling } = preparation
	const dark = group.frameType === 'DARK' || group.frameType === 'BIAS'
	const light = group.frameType === 'LIGHT'

	// A flat is a panel flat only when the session carries a panel to light it.
	const lit = group.frameType === 'FLAT' && flatPanel !== undefined && devices.flatPanel

	// Frames whose light comes from the sky, which is the light and the flat no panel lights. The cover has to
	// be open for both: a sky flat taken behind the cover the darks closed is a dark with a flat's name on it,
	// and leaving the cover where it is only looks harmless when the frame before it was another flat.
	const sky = light || (group.frameType === 'FLAT' && !lit)

	return {
		cover: !devices.cover || cover === undefined ? undefined : lit || (dark && cover.closeForDarkFrames) ? 'closed' : sky && cover.openBeforeCapture ? 'open' : undefined,
		panel: !devices.flatPanel || flatPanel === undefined ? undefined : { lit, brightness: lit ? panelBrightness(flatPanel, devices.wheel, group.filter) : 0 },
		tracking: light ? true : undefined,
		filter: group.filter,
		angle: rotator?.angle,
		temperature: cooling === undefined || !cooling.waitForTarget ? undefined : cooling.temperature,
	}
}

// Reconciles the optical path with the context of the selected frame, commanding only the differences.
//
// A preparation that fails is a failure of the safe point and consumes an attempt of the slot: the frame
// cannot be exposed through a path that is not the one it declared, and taking it anyway would put a frame of
// the wrong context inside the group.
export async function runFramePreparation(services: SequencerPreparationServices, context: SequencerActionContext, preparation: SequencerFramePreparation): Promise<SequencerActionResult<SequencerPreparationOutcome>> {
	const camera = sequencerDeviceOf(context, 'camera', isCamera)
	const wheel = sequencerDeviceOf(context, 'wheel', isWheel)
	const focuser = sequencerDeviceOf(context, 'focuser', isFocuser)
	const cover = sequencerDeviceOf(context, 'cover', isCover)
	const panel = sequencerDeviceOf(context, 'flatPanel', isFlatPanel)
	const rotator = sequencerDeviceOf(context, 'rotator', isRotator)
	const mount = sequencerDeviceOf(context, 'mount', isMount)

	const required = sequencerFrameContext(preparation, { wheel, cover: cover !== undefined, flatPanel: panel !== undefined })
	const commanded: SequencerPreparationStep[] = []
	let slot: number | undefined
	let focusShift: number | undefined
	let temperature: number | undefined

	// Tracking comes before the optical path because it is the only dimension that keeps the field from
	// drifting while the rest of the preparation runs, and because it moves nothing the order below protects.
	if (required.tracking === true && mount !== undefined && !mount.tracking) {
		context.progress({ detail: 'resuming tracking' })

		const tracked = await services.mountCommander.setTracking(context.scope, mount, true)

		if (!tracked.ok) return sequencerActionFailure(tracked, 'the mount did not resume tracking')

		commanded.push('tracking')
	}

	if (panel !== undefined && required.panel?.lit === false && panel.enabled) {
		context.progress({ detail: 'turning the flat panel off' })

		const disabled = await services.flatPanelCommander.disable(context.scope, panel)

		if (!disabled.ok) return sequencerActionFailure(disabled, 'the flat panel did not turn off')

		commanded.push('panelOff')
	}

	if (cover !== undefined && required.cover !== undefined && cover.parked !== (required.cover === 'closed')) {
		const closing = required.cover === 'closed'
		const timeout = preparation.cover === undefined ? undefined : preparation.cover.timeout * 1000

		context.progress({ detail: closing ? 'closing the cover' : 'opening the cover' })

		const moved = closing ? await services.coverCommander.park(context.scope, cover, { timeout }) : await services.coverCommander.unpark(context.scope, cover, { timeout })

		if (!moved.ok) return sequencerActionFailure(moved, `the cover did not ${closing ? 'close' : 'open'}`)

		commanded.push('cover')
	}

	if (wheel !== undefined && required.filter !== undefined) {
		const target = sequencerFilterSlot(wheel, required.filter)

		// A filter the wheel does not carry is a frame that cannot be exposed as declared. Falling back to the
		// installed slot would produce a frame through the wrong filter, which is worse than no frame at all,
		// and no retry of the same node would change what the carousel holds.
		if (target === undefined) return { type: 'fatalFailure', reason: 'unexpectedState', detail: 'the wheel does not carry the filter the frame requires' }

		slot = target

		if (wheel.position !== target) {
			const installed = wheel.position

			context.progress({ detail: 'moving the wheel' })

			const moved = await services.wheelCommander.moveTo(context.scope, wheel, target)

			if (!moved.ok) return sequencerActionFailure(moved, 'the wheel did not reach the filter the frame requires')

			commanded.push('filter')

			// A focus measured through one filter serves another once the difference between their declared
			// path offsets is added, which is what keeps a filter change from requiring a focus run.
			const shift = sequencerFocusOffsetShift(wheel, preparation.filterOffsets, installed, target)

			if (shift !== 0 && focuser !== undefined) {
				context.progress({ detail: 'applying the focus offset of the filter' })

				const focused = await services.focuserCommander.moveTo(context.scope, focuser, focuser.position.value + shift)

				if (!focused.ok) {
					// The shift is the difference between two filters and not a position any device publishes, so it
					// exists only while the transition is being made. A retry arriving with the wheel already at the
					// target derives no shift at all and exposes the frame at the focus of the filter before it.
					// Putting the wheel back is what keeps the pair atomic without remembering anything: the next
					// attempt sees the same difference this one saw and commands both halves again. Nothing is
					// reported about the restore — the focuser failure is what explains the preparation, and a wheel
					// that did not come back leaves the retry deriving its offset from wherever the wheel is.
					await services.wheelCommander.moveTo(context.scope, wheel, installed)

					return sequencerActionFailure(focused, 'the focuser did not take the offset of the new filter')
				}

				focusShift = shift
				commanded.push('focusOffset')
			}
		}
	}

	if (rotator !== undefined && required.angle !== undefined && preparation.rotator !== undefined) {
		const target = toDeg(required.angle)

		if (angularDistance(rotator.angle.value, target) > toDeg(preparation.rotator.tolerance)) {
			context.progress({ detail: 'rotating the field' })

			const rotated = await services.rotatorCommander.moveTo(context.scope, rotator, target)

			if (!rotated.ok) return sequencerActionFailure(rotated, 'the rotator did not reach the angle the frame requires')

			commanded.push('rotator')

			const settled = await sequencerSettle(context, preparation.rotator.settle)

			if (!settled.ok) return sequencerActionFailure(settled, 'the settle after the rotation was interrupted')
		}
	}

	// A camera publishing no temperature has nothing to converge, so the wait is not made rather than spent on
	// a reading that never moves.
	if (camera !== undefined && camera.hasThermometer && required.temperature !== undefined && preparation.cooling !== undefined) {
		const waited = await waitForTemperature(context, camera, required.temperature, preparation.cooling)

		if (!waited.ok) return sequencerActionFailure(waited, 'the sensor did not reach the temperature the frame requires')

		if (waited.value !== undefined) {
			temperature = waited.value
			commanded.push('cooling')
		}
	}

	// The lamp is the last thing to come on, with the cover already where it belongs.
	if (panel !== undefined && required.panel?.lit === true) {
		context.progress({ detail: 'lighting the flat panel' })

		const brightness = await services.flatPanelCommander.intensity(context.scope, panel, required.panel.brightness)

		if (!brightness.ok) return sequencerActionFailure(brightness, 'the flat panel did not take the brightness the frame requires')

		if (!panel.enabled) {
			const enabled = await services.flatPanelCommander.enable(context.scope, panel)

			if (!enabled.ok) return sequencerActionFailure(enabled, 'the flat panel did not turn on')
		}

		commanded.push('panelOn')
	}

	return { type: 'completed', value: { context: required, commanded, slot, focusShift, temperature } }
}

// Waits for the sensor to enter the declared tolerance of the setpoint, bounded by the declared timeout.
//
// This is the only step of the preparation that waits for a convergence instead of commanding a position, and
// the only one that can fail to end on its own. The preparation never commands the cooler: the setpoint is
// commanded by the startup pipeline, and a wait for a target nobody asked for is the session that hangs before
// its first frame, which is why the compiler refuses that combination instead of this wait guarding against it.
//
// The temperature is read live from the device on every sample, in degrees Celsius. Returns the observed
// temperature, or `undefined` when the sensor was already inside the tolerance and nothing was waited for.
async function waitForTemperature(context: SequencerActionContext, camera: { readonly temperature: number }, target: number, cooling: Omit<SequencerCooling, 'enabled'>): Promise<OperationResult<number | undefined>> {
	if (Math.abs(camera.temperature - target) <= cooling.tolerance) return successfulOperationResult(undefined)

	const deadline = context.now() + cooling.timeout * 1000

	context.progress({ detail: 'waiting for the sensor temperature' })

	while (Math.abs(camera.temperature - target) > cooling.tolerance) {
		if (context.now() >= deadline) return failedOperationResult('timeout', `the sensor stayed at ${camera.temperature.toFixed(1)} °C`)

		const waited = await abortableDelay(SEQUENCER_THERMAL_SAMPLE, context.signal)

		if (!waited.ok) return waited
	}

	return successfulOperationResult(camera.temperature)
}
