import { describe, expect, test } from 'bun:test'
import type { Camera, Device, Focuser, GuideOutput, Mount, Wheel } from 'nebulosa/src/devices/indi/device'
import { DEFAULT_CAMERA, DEFAULT_FOCUSER, DEFAULT_GUIDE_OUTPUT, DEFAULT_MOUNT, DEFAULT_WHEEL } from 'nebulosa/src/devices/indi/device'
import { compile } from 'src/api/sequencer.compiler'
import { SequencerBlockRegistry } from 'src/api/sequencer.registry'
import { resolveResources, resolveSession } from 'src/api/sequencer.resolve'
import type { SequencerSessionEnvironment } from 'src/api/sequencer.resolve'
import type { Sequencer } from '#/sequencer'
import type { SequencerPlan } from '#/sequencer.plan'
import { canonical, frame } from './sequencer.fixture'

function device<D extends Device>(defaults: D, name: string, hardwareId: string): D {
	return { ...structuredClone(defaults), id: name, hardwareId, name, connected: true, client: { type: 'SIMULATOR', id: 'client' } }
}

function devices(...list: Device[]) {
	const map = new Map(list.map((it) => [it.name, it]))
	return (id: string) => map.get(id)
}

function observatory() {
	return {
		camera: device<Camera>(DEFAULT_CAMERA, 'Camera Simulator', 'hardware-camera'),
		mount: device<Mount>(DEFAULT_MOUNT, 'Mount Simulator', 'hardware-mount'),
		wheel: device<Wheel>(DEFAULT_WHEEL, 'Wheel Simulator', 'hardware-wheel'),
		focuser: device<Focuser>(DEFAULT_FOCUSER, 'Focuser Simulator', 'hardware-focuser'),
		guideCamera: device<Camera>(DEFAULT_CAMERA, 'Guide Camera Simulator', 'hardware-guide-camera'),
		guideOutput: device<GuideOutput>(DEFAULT_GUIDE_OUTPUT, 'Guide Output Simulator', 'hardware-guide-output'),
	}
}

function plan(definition: Sequencer): SequencerPlan {
	const compilation = compile(definition)
	if (!compilation.ok) throw new Error(`expected a plan, got ${JSON.stringify(compilation.diagnostics)}`)
	return compilation.plan
}

function guided(): Sequencer {
	const definition = canonical()

	return {
		...definition,
		devices: { ...definition.devices, guideCamera: 'Guide Camera Simulator', guideOutput: 'Guide Output Simulator' },
		guiding: { ...definition.guiding, enabled: true, connection: { mode: 'local', focalLength: 0.24, capture: { exposureTime: 2, frameType: 'LIGHT', binX: 1, binY: 1, gain: 100, offset: 10, subframe: { enabled: false, x: 0, y: 0, width: 0, height: 0 }, transferFormat: 'FITS', compressed: false }, owned: true } },
	}
}

describe('resource resolution', () => {
	test('every role resolves to the hardware key of its device', () => {
		const setup = observatory()
		const resolution = resolveResources(plan(canonical()), devices(setup.camera, setup.mount, setup.focuser))

		expect(resolution.ok).toBe(true)
		if (!resolution.ok) return

		expect(resolution.resources.bindings.map((binding) => binding.role)).toEqual(['camera', 'mount', 'focuser'])
		expect(resolution.resources.requests.map((request) => request.key)).toEqual(['hardware-camera', 'hardware-mount', 'hardware-focuser'])
		expect(resolution.resources.requests.every((request) => request.device !== undefined)).toBe(true)
	})

	test('two roles on the same hardware collapse into one key', () => {
		const setup = observatory()
		const wheel = device<Wheel>(DEFAULT_WHEEL, 'Wheel Simulator', setup.camera.hardwareId)
		const definition = canonical()
		const compiled = plan({ ...definition, capture: { ...definition.capture, frames: [frame('lum', { filter: { type: 'position', position: 1 } })] } })
		const resolution = resolveResources(compiled, devices(setup.camera, setup.mount, wheel, setup.focuser))

		expect(resolution.ok).toBe(true)
		if (!resolution.ok) return

		expect(compiled.roles).toContain('wheel')
		expect(resolution.resources.bindings).toHaveLength(4)
		expect(resolution.resources.requests.map((request) => request.key)).toEqual(['hardware-camera', 'hardware-mount', 'hardware-focuser'])
	})

	test('a local guider adds one logical key per guided device', () => {
		const setup = observatory()
		const resolution = resolveResources(plan(guided()), devices(setup.camera, setup.mount, setup.focuser, setup.guideCamera, setup.guideOutput))

		expect(resolution.ok).toBe(true)
		if (!resolution.ok) return

		expect(resolution.resources.requests.map((request) => request.key)).toEqual(['hardware-camera', 'hardware-mount', 'hardware-focuser', 'hardware-guide-camera', 'hardware-guide-output', 'logical:guider:local:camera:hardware-guide-camera', 'logical:guider:local:output:hardware-guide-output'])
	})

	test('a remote guider adds its logical key and no device', () => {
		const setup = observatory()
		const definition = canonical()
		const remote = { ...definition, guiding: { ...definition.guiding, enabled: true, connection: { mode: 'remote', host: 'PHD2.local', port: 4400, owned: true } as const } }
		const resolution = resolveResources(plan(remote), devices(setup.camera, setup.mount, setup.focuser))

		expect(resolution.ok).toBe(true)
		if (!resolution.ok) return

		const guider = resolution.resources.requests.at(-1)

		expect(guider?.key).toBe('logical:guider:remote:phd2.local:4400')
		expect(guider?.device).toBeUndefined()
	})

	test('a role no device answers for is refused', () => {
		const setup = observatory()
		const resolution = resolveResources(plan(canonical()), devices(setup.camera, setup.focuser))

		expect(resolution.ok).toBe(false)
		if (!resolution.ok) expect(resolution.diagnostics).toEqual([{ path: 'devices.mount', message: 'no device named "Mount Simulator" is available for the mount role' }])
	})

	test('a device that cannot do what the role requires is refused', () => {
		const setup = observatory()
		const impostor = device<Camera>(DEFAULT_CAMERA, 'Mount Simulator', 'hardware-impostor')
		const resolution = resolveResources(plan(canonical()), devices(setup.camera, impostor, setup.focuser))

		expect(resolution.ok).toBe(false)
		if (!resolution.ok) expect(resolution.diagnostics).toEqual([{ path: 'devices.mount', message: 'the device "Mount Simulator" does not support the mount role' }])
	})

	test('every unresolvable role is reported at once', () => {
		const setup = observatory()
		const resolution = resolveResources(plan(canonical()), devices(setup.camera))

		expect(resolution.ok).toBe(false)
		if (!resolution.ok) expect(resolution.diagnostics.map((diagnostic) => diagnostic.path)).toEqual(['devices.mount', 'devices.focuser'])
	})
})

describe('session start resolution', () => {
	function registry(version = 1) {
		const registry = new SequencerBlockRegistry()

		for (const type of ['slew', 'center', 'capture.frame', 'trigger.autofocus', 'trigger.dither', 'trigger.meridianFlip', 'lifecycle.connectDevices', 'lifecycle.unparkMount', 'lifecycle.parkMount', 'lifecycle.warmCamera']) {
			registry.register({ type, version, validate: (configuration) => ({ ok: true, configuration }), resources: () => [], execute: () => Promise.resolve({ type: 'completed', value: undefined } as const) })
		}

		return registry
	}

	function environment(overrides?: Partial<SequencerSessionEnvironment>): SequencerSessionEnvironment {
		const setup = observatory()
		return { lookup: devices(setup.camera, setup.mount, setup.focuser), registry: registry(), filesystemId: () => 1, startedAt: Date.parse('2026-08-10T22:30:00'), ...overrides }
	}

	function compiled(definition: Sequencer, options?: { readonly registry?: SequencerBlockRegistry }): SequencerPlan {
		const compilation = compile(definition, options)
		if (!compilation.ok) throw new Error(`expected a plan, got ${JSON.stringify(compilation.diagnostics)}`)
		return compilation.plan
	}

	test('the resolution binds the devices, the handlers and the night segment', () => {
		const resolution = resolveSession(compiled(canonical(), { registry: registry() }), environment())

		expect(resolution.ok).toBe(true)
		if (!resolution.ok) return

		expect(resolution.session.resources.requests.map((request) => request.key)).toEqual(['hardware-camera', 'hardware-mount', 'hardware-focuser'])
		expect(resolution.session.handlers['capture.frame']).toBe(1)
		expect(resolution.session.nightSegment).toBe('2026-08-10')
	})

	test('a handler version that changed since compilation refuses the start', () => {
		const resolution = resolveSession(compiled(canonical(), { registry: registry() }), environment({ registry: registry(2) }))

		expect(resolution.ok).toBe(false)
		if (!resolution.ok) expect(resolution.diagnostics).toContainEqual({ path: 'handlers.slew', message: 'the block type "slew" was compiled against version 1 and version 2 is registered' })
	})

	test('a handler removed since compilation refuses the start', () => {
		const resolution = resolveSession(compiled(canonical(), { registry: registry() }), environment({ registry: new SequencerBlockRegistry() }))

		expect(resolution.ok).toBe(false)
		if (!resolution.ok) expect(resolution.diagnostics.map((diagnostic) => diagnostic.path)).toContain('handlers.slew')
	})

	test('a plan compiled without a registry accepts whatever version is registered', () => {
		const resolution = resolveSession(compiled(canonical()), environment({ registry: registry(9) }))

		expect(resolution.ok).toBe(true)
		if (resolution.ok) expect(resolution.session.handlers.slew).toBe(9)
	})

	test('a temporary directory on another filesystem refuses the start', () => {
		const definition = canonical()
		const plan = compiled({ ...definition, storage: { ...definition.storage, temporaryDirectory: '/tmp/nebulosa' } }, { registry: registry() })
		const resolution = resolveSession(plan, environment({ filesystemId: (path) => (path === '/tmp/nebulosa' ? 2 : 1) }))

		expect(resolution.ok).toBe(false)
		if (!resolution.ok) expect(resolution.diagnostics).toEqual([{ path: 'storage.temporaryDirectory', message: 'the temporary directory is on another filesystem than the storage root, which would turn the atomic commit into a copy' }])
	})

	test('a temporary directory on the same filesystem starts', () => {
		const definition = canonical()
		const plan = compiled({ ...definition, storage: { ...definition.storage, temporaryDirectory: '/data/nebulosa/.tmp' } }, { registry: registry() })

		expect(resolveSession(plan, environment()).ok).toBe(true)
	})

	test('the night segment of the noon mode keeps one night in one directory', () => {
		const plan = compiled(canonical(), { registry: registry() })
		const evening = resolveSession(plan, environment({ startedAt: Date.parse('2026-08-10T22:30:00') }))
		const morning = resolveSession(plan, environment({ startedAt: Date.parse('2026-08-11T03:15:00') }))

		expect(evening.ok && evening.session.nightSegment).toBe('2026-08-10')
		expect(morning.ok && morning.session.nightSegment).toBe('2026-08-10')
	})

	test('the night segment of the midnight mode is the calendar date', () => {
		const definition = canonical()
		const plan = compiled({ ...definition, storage: { ...definition.storage, autoSubFolderMode: 'midnight' } }, { registry: registry() })
		const resolution = resolveSession(plan, environment({ startedAt: Date.parse('2026-08-11T03:15:00') }))

		expect(resolution.ok && resolution.session.nightSegment).toBe('2026-08-11')
	})

	test('the night segment is absent when the mode is off', () => {
		const definition = canonical()
		const plan = compiled({ ...definition, storage: { ...definition.storage, autoSubFolderMode: 'off' } }, { registry: registry() })
		const resolution = resolveSession(plan, environment())

		expect(resolution.ok && resolution.session.nightSegment).toBeUndefined()
	})

	test('an unresolvable device stops the start before anything else is resolved', () => {
		const setup = observatory()
		const resolution = resolveSession(compiled(canonical(), { registry: registry() }), environment({ lookup: devices(setup.camera), registry: new SequencerBlockRegistry() }))

		expect(resolution.ok).toBe(false)
		if (!resolution.ok) expect(resolution.diagnostics.map((diagnostic) => diagnostic.path)).toEqual(['devices.mount', 'devices.focuser'])
	})
})

describe('guider ownership', () => {
	test('a guider session owned by another component is refused at compilation', () => {
		const definition = canonical()
		const compilation = compile({ ...definition, guiding: { ...definition.guiding, enabled: true, connection: { mode: 'existing', guider: 'phd2', owned: false } } })

		expect(compilation.ok).toBe(false)
		if (!compilation.ok) expect(compilation.diagnostics).toEqual([{ path: 'guiding.connection.mode', message: 'a guider session owned by another component cannot be reserved by this session' }])
	})

	test('an unowned remote guider is refused at compilation', () => {
		const definition = canonical()
		const compilation = compile({ ...definition, guiding: { ...definition.guiding, enabled: true, connection: { mode: 'remote', host: 'localhost', port: 4400, owned: false } } })

		expect(compilation.ok).toBe(false)
		if (!compilation.ok) expect(compilation.diagnostics).toEqual([{ path: 'guiding.connection.owned', message: 'the session must own the guider session it reserves' }])
	})

	test('a plan that does not guide reserves no logical key', () => {
		const setup = observatory()
		const resolution = resolveResources(plan(canonical()), devices(setup.camera, setup.mount, setup.focuser))

		expect(resolution.ok).toBe(true)
		if (resolution.ok) expect(resolution.resources.requests.every((request) => !request.key.startsWith('logical:'))).toBe(true)
	})
})
