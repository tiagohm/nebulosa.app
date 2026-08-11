import { isCamera, isCover, isDome, isFlatPanel, isFocuser, isGuideOutput, isMount, isRotator, isWheel } from 'nebulosa/src/devices/indi/device'
import type { Camera, Device, GuideOutput } from 'nebulosa/src/devices/indi/device'
import type { SequencerDeviceRole } from '#/sequencer'
import type { SequencerDiagnostic, SequencerPlan } from '#/sequencer.plan'
import { localGuiderCameraKey, localGuiderOutputKey, remoteGuiderKey } from './guider.session'
import type { ResourceKey, ResourceRequest } from './resource'
import { resourceKey } from './resource'

// Resolution of a compiled plan against the devices that exist right now.
//
// This is the impure counterpart of the compiler. Lowering answers what the definition says; this module
// answers what the observatory currently is, which is why it cannot run while the user edits and has to run
// again every time a session starts: a device present an hour ago may be gone now.
//
// Its product is the set of resource keys the session reserves atomically at start. The set covers both
// halves of the key space, physical and logical, because reserving only the physical half leaves the session
// unprotected exactly where it depends on exclusivity the most.

// One role of the plan bound to the device that currently answers for it.
export interface SequencerRoleBinding {
	// Role as declared by the definition.
	readonly role: SequencerDeviceRole
	// Device id the definition declared for the role.
	readonly id: string
	// Device that currently answers for the id.
	readonly device: Device
	// Physical resource key of that device, which is its hardware id.
	readonly key: ResourceKey
}

// Everything the session needs to reserve, resolved once at start.
export interface SequencerResolvedResources {
	// Bindings in the role order of the plan, one per declared role.
	readonly bindings: readonly SequencerRoleBinding[]
	// Requests handed to the arbiter as one atomic reservation. Roles resolving to the same hardware appear
	// once, because the union is computed over resolved keys rather than over roles.
	readonly requests: readonly ResourceRequest[]
}

// Outcome of resolving a plan. A failure carries every reason at once, so an operator fixing a setup sees
// the whole list instead of discovering one missing device per attempt.
export type SequencerResolution = { readonly ok: true; readonly resources: SequencerResolvedResources } | { readonly ok: false; readonly diagnostics: readonly SequencerDiagnostic[] }

// Finds the device currently answering for a device id, or undefined when nothing does.
export type SequencerDeviceLookup = (id: string) => Device | undefined

// Interface each role requires the resolved device to advertise. A device that does not advertise it cannot
// execute the commands the role exists to issue, and finding that out at the first command means finding it
// out with the observatory already open.
const SEQUENCER_ROLE_INTERFACE: Record<SequencerDeviceRole, (device: Device) => boolean> = {
	camera: isCamera,
	mount: isMount,
	wheel: isWheel,
	focuser: isFocuser,
	rotator: isRotator,
	guideCamera: isCamera,
	guideOutput: isGuideOutput,
	cover: isCover,
	flatPanel: isFlatPanel,
	dome: isDome,
}

// Narrowed guide camera of a resolved binding set. The interface check of the resolution already refused
// anything that is not a camera, so the narrowing only restates what the binding guarantees.
function guideCameraOf(bindings: readonly SequencerRoleBinding[]): Camera | undefined {
	const device = bindings.find((binding) => binding.role === 'guideCamera')?.device
	return device !== undefined && isCamera(device) ? device : undefined
}

// Narrowed guide output of a resolved binding set, for the same reason as the camera above.
function guideOutputOf(bindings: readonly SequencerRoleBinding[]): GuideOutput | undefined {
	const device = bindings.find((binding) => binding.role === 'guideOutput')?.device
	return device !== undefined && isGuideOutput(device) ? device : undefined
}

// Logical keys of the guider the plan owns, which the session reserves alongside the physical ones.
//
// `guider.session.ts` reserves a guiding session by `logical:guider:*` keys and deliberately leaves the
// physical device acquirable, so the guider's own operations can lease it. Reserving only the physical half
// therefore produces a half state that is worse than a clean failure: a guider opened by hand during the
// session connects successfully, because the logical keys are free, and only fails at its first command.
// A local guider is reserved one device at a time rather than as a pair, because a key naming both would
// differ for every combination and two sessions sharing only the camera would both be accepted.
function guiderKeysOf(plan: SequencerPlan, bindings: readonly SequencerRoleBinding[]): ResourceRequest[] {
	if (plan.guider === undefined) return []

	if (plan.guider.mode === 'remote') return [{ key: remoteGuiderKey(plan.guider.host, plan.guider.port) }]

	const camera = guideCameraOf(bindings)
	const guideOutput = guideOutputOf(bindings)
	const requests: ResourceRequest[] = []

	if (camera !== undefined) requests.push({ key: localGuiderCameraKey(camera) })
	if (guideOutput !== undefined) requests.push({ key: localGuiderOutputKey(guideOutput) })

	return requests
}

// Resolves every role of a plan into the key set the session reserves.
//
// Reservation is by session and not by action: a cover or a focuser used only during finalization has to be
// held from the start, because a manual command taking it during the capture makes the finalization fail as
// busy at the end of the night, which is exactly when nobody is watching.
//
// Returns the bindings in plan role order and the deduplicated requests, or a diagnostic per role that no
// device answers for or whose device cannot do what the role requires.
export function resolveResources(plan: SequencerPlan, lookup: SequencerDeviceLookup): SequencerResolution {
	const diagnostics: SequencerDiagnostic[] = []
	const bindings: SequencerRoleBinding[] = []

	for (const role of plan.roles) {
		const id = plan.devices[role]

		if (id === undefined) {
			diagnostics.push({ path: `devices.${role}`, message: `the plan commands the ${role} role, which the definition does not declare` })
			continue
		}

		const device = lookup(id)

		if (device === undefined) {
			diagnostics.push({ path: `devices.${role}`, message: `no device named "${id}" is available for the ${role} role` })
			continue
		}

		if (!SEQUENCER_ROLE_INTERFACE[role](device)) {
			diagnostics.push({ path: `devices.${role}`, message: `the device "${id}" does not support the ${role} role` })
			continue
		}

		bindings.push({ role, id, device, key: resourceKey(device) })
	}

	if (diagnostics.length > 0) return { ok: false, diagnostics }

	const requests: ResourceRequest[] = []
	const keys = new Set<ResourceKey>()

	for (const binding of bindings) {
		if (keys.has(binding.key)) continue
		keys.add(binding.key)
		requests.push({ key: binding.key, device: binding.device })
	}

	for (const request of guiderKeysOf(plan, bindings)) {
		if (keys.has(request.key)) continue
		keys.add(request.key)
		requests.push(request)
	}

	return { ok: true, resources: { bindings, requests } }
}
