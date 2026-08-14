import { statSync } from 'fs'
import { dirname, resolve } from 'path'
import { isCamera, isCover, isDome, isFlatPanel, isFocuser, isGuideOutput, isMount, isRotator, isWheel } from 'nebulosa/src/devices/indi/device'
import type { Camera, Device, GuideOutput } from 'nebulosa/src/devices/indi/device'
import type { SequencerDeviceRole } from '#/sequencer'
import type { SequencerDiagnostic, SequencerPlan } from '#/sequencer.plan'
import { localGuiderCameraKey, localGuiderOutputKey, remoteGuiderKey } from './guider.session'
import type { ResourceKey, ResourceRequest } from './resource'
import { resourceKey } from './resource'
import { sequencerPlanNodes } from './sequencer.compiler'
import { sequencerNightSegment } from './sequencer.path'
import type { SequencerBlockRegistry } from './sequencer.registry'

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

	const { connection } = plan.guider

	if (connection.mode === 'remote') return [{ key: remoteGuiderKey(connection.host, connection.port) }]

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

// Everything the session start resolved, frozen for the whole life of the session.
export interface SequencerResolvedSession {
	// Devices bound to roles and the key set to reserve.
	readonly resources: SequencerResolvedResources
	// Handler version per block type, as resolved right now.
	readonly handlers: Readonly<Record<string, number>>
	// Directory segment of the automatic per-night subdirectory, absent when the mode is off. It is resolved
	// once and never re-evaluated, so a session crossing the boundary keeps writing to the same directory.
	readonly nightSegment?: string
}

// Outcome of the session start resolution.
export type SequencerSessionResolution = { readonly ok: true; readonly session: SequencerResolvedSession } | { readonly ok: false; readonly diagnostics: readonly SequencerDiagnostic[] }

// Environment the session start resolution reads, injectable so a test can describe an observatory instead
// of needing one.
export interface SequencerSessionEnvironment {
	// Finds the device currently answering for a device id.
	readonly lookup: SequencerDeviceLookup
	// Registry the handler versions are demanded from again.
	readonly registry: SequencerBlockRegistry
	// Wall-clock instant the session starts at, in milliseconds since the epoch. Defaults to now.
	readonly startedAt?: number
	// Identity of the filesystem holding a path, used to compare the temporary directory with the root.
	// Defaults to the device number reported by the nearest existing ancestor of the path.
	readonly filesystemId?: (path: string) => number | undefined
}

// Filesystem holding a path, or the nearest ancestor that exists, since the runtime creates the directories
// it writes to and a directory that does not exist yet still lands on the filesystem of its parent. Returns
// undefined when nothing along the chain can be inspected.
function filesystemIdOf(path: string) {
	let current = resolve(path)

	for (;;) {
		try {
			return statSync(current).dev
		} catch {
			const parent = dirname(current)
			if (parent === current) return undefined
			current = parent
		}
	}
}

// Re-checks that every block type of the plan still resolves to the version it was compiled against.
//
// This is the only check that also runs while compiling, and it has to run twice: the registry can change
// between validating a definition and starting it, so the first run keeps an invalid definition from being
// saved and the second keeps a stale plan from being executed.
function checkHandlerVersions(diagnostics: SequencerDiagnostic[], plan: SequencerPlan, registry: SequencerBlockRegistry) {
	const types = new Set<string>()

	for (const node of sequencerPlanNodes(plan.root)) {
		if (node.kind === 'action') types.add(node.type)
	}

	const resolution = registry.resolve(
		types
			.values()
			.toArray()
			.map((type) => ({ type, version: plan.handlers?.[type] })),
	)

	if (resolution.ok) return resolution.versions

	for (const issue of resolution.issues) {
		if (issue.kind === 'missing') diagnostics.push({ path: `handlers.${issue.type}`, message: `no handler is registered for the block type "${issue.type}"` })
		else diagnostics.push({ path: `handlers.${issue.type}`, message: `the block type "${issue.type}" was compiled against version ${issue.expected} and version ${issue.actual} is registered` })
	}

	return undefined
}

// Checks that the temporary directory shares a filesystem with the storage root.
//
// The commit of an artifact is a rename from the temporary file to the final path, and a rename across
// filesystems is a copy: it stops being atomic, so an interrupted commit can leave a partial file under the
// final name. Refusing to start is the honest outcome; degrading the rename silently is not.
function checkTemporaryDirectory(diagnostics: SequencerDiagnostic[], plan: SequencerPlan, filesystemId: (path: string) => number | undefined) {
	const { root, temporaryDirectory } = plan.storage

	if (temporaryDirectory === undefined) return

	const rootId = filesystemId(root)
	const temporaryId = filesystemId(temporaryDirectory)

	if (rootId === undefined || temporaryId === undefined) diagnostics.push({ path: 'storage.temporaryDirectory', message: 'the temporary directory and the storage root cannot be inspected' })
	else if (rootId !== temporaryId) diagnostics.push({ path: 'storage.temporaryDirectory', message: 'the temporary directory is on another filesystem than the storage root, which would turn the atomic commit into a copy' })
}

// Resolves a compiled plan against the observatory as it is right now, once, before the first startup action.
//
// This is where everything the lowering could not decide because it is pure gets decided: which hardware
// answers for each role, whether the handlers are still the ones the plan was compiled against, whether the
// atomic commit will really be atomic, and which night the session belongs to. None of it needs a device in
// motion, which is why all of it fits before the startup pipeline.
//
// A failure carries every reason at once and resolves nothing, so the caller keeps the session idle and
// unwinds whatever it had already set up rather than starting a session that is half configured.
export function resolveSession(plan: SequencerPlan, environment: SequencerSessionEnvironment): SequencerSessionResolution {
	// A plan compiled without a registry is the pre-flight product, and it is not startable: its roles are only
	// the ones the definition itself implies, because no handler was asked which devices its block commands, so
	// a handler declaring an extra role contributed nothing to `plan.roles` and the session would reserve less
	// than it later commands. Re-validating the nodes here would resolve that, but it would also mean lowering
	// decisions being taken outside the compiler, so the plan is refused instead of repaired.
	if (plan.handlers === undefined) return { ok: false, diagnostics: [{ path: 'handlers', message: 'the plan was compiled without a registry, so no handler declared the roles its block commands and the session would reserve less than it commands' }] }

	const resolution = resolveResources(plan, environment.lookup)

	if (!resolution.ok) return resolution

	const diagnostics: SequencerDiagnostic[] = []
	const handlers = checkHandlerVersions(diagnostics, plan, environment.registry)

	checkTemporaryDirectory(diagnostics, plan, environment.filesystemId ?? filesystemIdOf)

	if (diagnostics.length > 0 || handlers === undefined) return { ok: false, diagnostics }

	return { ok: true, session: { resources: resolution.resources, handlers, nightSegment: sequencerNightSegment(plan.storage.autoSubFolderMode, environment.startedAt ?? Date.now()) } }
}
