import { describe, expect, test } from 'bun:test'
import type { SequencerCapture, SequencerCenter, SequencerLifecycle, SequencerMeridianFlipTrigger } from 'src/api/sequencer.compiler'
import { compile, sequencerNodeId, sequencerPlanNodes } from 'src/api/sequencer.compiler'
import { SequencerBlockRegistry } from 'src/api/sequencer.registry'
import type { Sequencer, SequencerDeviceRole } from '#/sequencer'
import type { SequencerPlanAction, SequencerPlanLoop, SequencerPlanSequence } from '#/sequencer.plan'
import { action, camera, canonical, frame, retry } from './sequencer.fixture'

function handlers(roles: Record<string, readonly SequencerDeviceRole[]> = {}) {
	const registry = new SequencerBlockRegistry()

	for (const type of ['slew', 'center', 'capture.frame', 'trigger.autofocus', 'trigger.dither', 'trigger.meridianFlip', 'lifecycle.connectDevices', 'lifecycle.unparkMount', 'lifecycle.parkMount', 'lifecycle.coolCamera', 'lifecycle.warmCamera']) {
		const declared = (roles[type] ?? []).map((role) => ({ role }))

		registry.register({
			type,
			version: 1,
			validate: (configuration) => ({ ok: true, configuration }),
			resources: () => declared,
			execute: () => Promise.resolve({ type: 'completed', value: undefined } as const),
		})
	}

	return registry
}

function ok(definition: Sequencer) {
	const compilation = compile(definition)
	if (!compilation.ok) throw new Error(`expected a plan, got ${JSON.stringify(compilation.diagnostics)}`)
	return compilation
}

describe('lowering', () => {
	test('startup, target and finalize are siblings of the root', () => {
		const { plan } = ok(canonical())

		expect(plan.root.kind).toBe('sequence')
		expect(plan.root.children.map((node) => node.id)).toEqual(['startup', 'target[m42]', 'finalize'])
		expect(plan.definitionId).toBe('definition-1')
		expect(plan.definitionRevision).toBe(7)
	})

	test('the target block lowers slew, center and the capture loop in order', () => {
		const { plan } = ok(canonical())
		const target = plan.root.children[1] as SequencerPlanSequence

		expect(target.children.map((node) => node.id)).toEqual(['target[m42].slew', 'target[m42].center', 'target[m42].capture.loop'])
		expect(target.children.map((node) => node.kind)).toEqual(['action', 'action', 'loop'])
	})

	test('the capture loop carries the cycle body with triggers before frames', () => {
		const { plan } = ok(canonical())
		const target = plan.root.children[1] as SequencerPlanSequence
		const loop = target.children[2] as SequencerPlanLoop

		expect(loop.repeat).toBe(2)
		expect(loop.order).toBe('sequential')
		expect(loop.body.id).toBe('target[m42].capture.cycle')
		expect(loop.body.children.map((node) => node.id)).toEqual(['target[m42].trigger.meridianFlip', 'target[m42].trigger.autofocus', 'target[m42].trigger.dither', 'target[m42].capture.frame[lum]', 'target[m42].capture.frame[red]'])
	})

	test('a disabled trigger produces no node', () => {
		const definition = canonical()
		const { plan } = ok({ ...definition, dither: { ...definition.dither, enabled: false }, meridianFlip: { ...definition.meridianFlip, enabled: false } })
		const target = plan.root.children[1] as SequencerPlanSequence
		const loop = target.children[2] as SequencerPlanLoop

		expect(loop.body.children.map((node) => node.id)).toEqual(['target[m42].trigger.autofocus', 'target[m42].capture.frame[lum]', 'target[m42].capture.frame[red]'])
	})

	test('a flip that recenters carries the centering of the target', () => {
		const { plan } = ok(canonical())
		const target = plan.root.children[1] as SequencerPlanSequence
		const loop = target.children[2] as SequencerPlanLoop
		const center = target.children[1] as SequencerPlanAction
		const flip = loop.body.children[0] as SequencerPlanAction

		expect((flip.configuration as SequencerMeridianFlipTrigger).centering).toEqual(center.configuration as SequencerCenter)
	})

	test('a flip that does not recenter carries no centering', () => {
		const definition = canonical()
		const { plan } = ok({ ...definition, meridianFlip: { ...definition.meridianFlip, recenter: false } })
		const target = plan.root.children[1] as SequencerPlanSequence
		const loop = target.children[2] as SequencerPlanLoop
		const flip = loop.body.children[0] as SequencerPlanAction

		expect((flip.configuration as SequencerMeridianFlipTrigger).centering).toBeUndefined()
	})

	test('a flip that focuses carries the autofocus policy of the definition', () => {
		const definition = canonical()
		const { plan } = ok({ ...definition, meridianFlip: { ...definition.meridianFlip, autofocus: true } })
		const target = plan.root.children[1] as SequencerPlanSequence
		const loop = target.children[2] as SequencerPlanLoop
		const flip = loop.body.children[0] as SequencerPlanAction
		const { enabled, ...focusing } = definition.autofocus

		expect((flip.configuration as SequencerMeridianFlipTrigger).focusing).toEqual(focusing)
	})

	test('a flip that does not focus carries no autofocus policy', () => {
		const definition = canonical()
		const { plan } = ok(definition)
		const target = plan.root.children[1] as SequencerPlanSequence
		const loop = target.children[2] as SequencerPlanLoop
		const flip = loop.body.children[0] as SequencerPlanAction

		expect((flip.configuration as SequencerMeridianFlipTrigger).focusing).toBeUndefined()
	})

	test('a flip that focuses is refused when the definition disables autofocus', () => {
		const definition = canonical()
		const compilation = compile({ ...definition, autofocus: { ...definition.autofocus, enabled: false }, meridianFlip: { ...definition.meridianFlip, autofocus: true } })

		expect(compilation.ok).toBe(false)
		if (!compilation.ok) expect(compilation.diagnostics).toEqual([{ path: 'meridianFlip.autofocus', message: 'the flip focuses after crossing, and the definition disables the autofocus block that declares how to focus' }])
	})

	test('a flip that recenters is refused when the target does not center', () => {
		const definition = canonical()
		const compilation = compile({ ...definition, target: { ...definition.target, center: { ...definition.target.center, enabled: false } } })

		expect(compilation.ok).toBe(false)
		if (!compilation.ok) expect(compilation.diagnostics).toEqual([{ path: 'meridianFlip.recenter', message: 'the flip recenters after crossing, and the target declares no centering it could re-establish the pointing with' }])
	})

	test('a disabled slew or centering produces no node', () => {
		const definition = canonical()
		const { plan } = ok({ ...definition, meridianFlip: { ...definition.meridianFlip, recenter: false }, target: { ...definition.target, tracking: { ...definition.target.tracking, enabled: false }, goto: { ...definition.target.goto, enabled: false }, center: { ...definition.target.center, enabled: false } } })
		const target = plan.root.children[1] as SequencerPlanSequence

		expect(target.children.map((node) => node.id)).toEqual(['target[m42].capture.loop'])
	})

	test('lifecycle actions keep the declared order and carry no target segment', () => {
		const { plan } = ok(canonical())
		const startup = plan.root.children[0] as SequencerPlanSequence
		const finalize = plan.root.children[2] as SequencerPlanSequence

		expect(startup.children.map((node) => node.id)).toEqual(['startup.action[connect]', 'startup.action[unpark]', 'startup.action[cool]'])
		expect(finalize.children.map((node) => node.id)).toEqual(['finalize.action[park]', 'finalize.action[warm]'])
		expect(startup.children.every((node) => !node.id.includes('target['))).toBe(true)
		expect(finalize.children.every((node) => !node.id.includes('target['))).toBe(true)
	})

	test('an action commanding the cooler carries the thermal policy', () => {
		const definition = canonical()
		const { plan } = ok(definition)
		const finalize = plan.root.children[2] as SequencerPlanSequence
		const warm = finalize.children[1] as SequencerPlanAction
		const park = finalize.children[0] as SequencerPlanAction

		expect((warm.configuration as SequencerLifecycle).cooling).toEqual(definition.cooling)
		expect((park.configuration as SequencerLifecycle).cooling).toBeUndefined()
	})

	test('an action starting tracking carries the tracking policy of the target', () => {
		const definition = canonical()
		const { enabled, ...tracking } = definition.target.tracking
		const { plan } = ok({ ...definition, startup: { ...definition.startup, actions: [...definition.startup.actions, action('track', { type: 'startTracking' })] } })
		const startup = plan.root.children[0] as SequencerPlanSequence
		const track = startup.children[3] as SequencerPlanAction
		const unpark = startup.children[1] as SequencerPlanAction

		expect((track.configuration as SequencerLifecycle).tracking).toEqual(tracking)
		expect((unpark.configuration as SequencerLifecycle).tracking).toBeUndefined()
	})

	test('an action starting tracking is refused when the target declares no tracking', () => {
		const definition = canonical()
		const compilation = compile({ ...definition, target: { ...definition.target, tracking: { ...definition.target.tracking, enabled: false } }, startup: { ...definition.startup, actions: [...definition.startup.actions, action('track', { type: 'startTracking' })] } })

		expect(compilation.ok).toBe(false)
		if (!compilation.ok) expect(compilation.diagnostics).toEqual([{ path: 'target.tracking.enabled', message: 'a lifecycle action starts tracking, and the target block it reads the tracking mode and rates from is disabled' }])
	})

	test('a disabled pipeline or a pipeline with no enabled action produces no block', () => {
		const definition = canonical()
		const { plan } = ok({ ...definition, cooling: { ...definition.cooling, enabled: false }, startup: { ...definition.startup, enabled: false }, shutdown: { ...definition.shutdown, actions: [action('park', { type: 'parkMount', enabled: false })] } })

		expect(plan.root.children.map((node) => node.id)).toEqual(['target[m42]'])
		expect(plan.startup).toBeUndefined()
		expect(plan.finalize).toBeUndefined()
	})

	test('the finalize block records the terminal states it runs for', () => {
		const { plan } = ok(canonical())

		expect(plan.finalize).toEqual({ continueOnFailure: true, runOn: ['completed', 'stopped'] })
		expect(plan.startup).toEqual({ continueOnFailure: false })
	})

	test('frame groups resolve the camera overrides and the delay', () => {
		const definition = canonical()
		const frames = [frame('lum'), frame('red', { delay: 12, camera: { binX: 2, binY: 2 }, filter: { type: 'name', name: 'R' } })]
		const { plan } = ok({ ...definition, capture: { ...definition.capture, frames } })

		expect(plan.groups.map((group) => group.id)).toEqual(['lum', 'red'])
		expect(plan.groups[0].delay).toBe(4)
		expect(plan.groups[0].camera).toEqual(camera())
		expect(plan.groups[1].delay).toBe(12)
		expect(plan.groups[1].camera).toEqual({ ...camera(), binX: 2, binY: 2 })
		expect(plan.groups[1].filter).toEqual({ type: 'name', name: 'R' })
		expect(plan.groups[1].nodeId).toBe('target[m42].capture.frame[red]')
	})

	test('a disabled frame produces no group', () => {
		const definition = canonical()
		const { plan } = ok({ ...definition, capture: { ...definition.capture, frames: [frame('lum'), frame('red', { enabled: false })] } })

		expect(plan.groups.map((group) => group.id)).toEqual(['lum'])
	})

	test('the plan collects the roles it commands', () => {
		const definition = canonical()
		const { plan } = ok({ ...definition, capture: { ...definition.capture, frames: [frame('lum', { filter: { type: 'position', position: 1 } })] } })

		expect(plan.roles).toEqual(['camera', 'mount', 'wheel', 'focuser'])
	})

	test('storage decisions are carried into the plan', () => {
		const { plan } = ok(canonical())

		expect(plan.storage).toEqual({ root: '/data/nebulosa', fileNameTemplate: '{target}-{filter}-{exposure}', directoryTemplate: '{target}/{frameType}', temporaryDirectory: undefined, checksum: 'sha256', autoSubFolderMode: 'noon' })
	})

	test('compiling the same definition twice produces an identical plan', () => {
		const a = ok(canonical())
		const b = ok(canonical())

		expect(JSON.stringify(a.plan)).toBe(JSON.stringify(b.plan))
	})

	test('a definition with no enabled frame is refused', () => {
		const definition = canonical()
		const compilation = compile({ ...definition, capture: { ...definition.capture, frames: [frame('lum', { enabled: false })] } })

		expect(compilation.ok).toBe(false)
		if (!compilation.ok) expect(compilation.diagnostics).toEqual([{ path: 'capture.frames', message: 'the definition has no enabled frame group to capture' }])
	})

	test('a disabled target is refused', () => {
		const definition = canonical()
		const compilation = compile({ ...definition, target: { ...definition.target, enabled: false } })

		expect(compilation.ok).toBe(false)
		if (!compilation.ok) expect(compilation.diagnostics[0].path).toBe('target.enabled')
	})
})

describe('structural validation', () => {
	test('a repeated frame id is refused at the property that repeats it', () => {
		const definition = canonical()
		const compilation = compile({ ...definition, capture: { ...definition.capture, frames: [frame('lum'), frame('lum')] } })

		expect(compilation.ok).toBe(false)
		if (!compilation.ok) expect(compilation.diagnostics).toEqual([{ path: 'capture.frames[1].id', message: 'the frame id "lum" is declared more than once' }])
	})

	test('an empty lifecycle action id is refused', () => {
		const definition = canonical()
		const compilation = compile({ ...definition, shutdown: { ...definition.shutdown, actions: [action('', { type: 'parkMount' })] } })

		expect(compilation.ok).toBe(false)
		if (!compilation.ok) expect(compilation.diagnostics).toEqual([{ path: 'shutdown.actions[0].id', message: 'the shutdown action id is empty and cannot address a node' }])
	})

	test('a target pointing in a frame it declares no coordinate for is refused', () => {
		const definition = canonical()
		const compilation = compile({ ...definition, target: { ...definition.target, type: 'JNOW' } })

		expect(compilation.ok).toBe(false)
		if (!compilation.ok) expect(compilation.diagnostics).toEqual([{ path: 'target.JNOW', message: 'the target points in JNOW and declares no JNOW coordinate to point at' }])
	})

	test('a target with no pointing action needs no coordinate', () => {
		const definition = canonical()
		const compilation = compile({
			...definition,
			meridianFlip: { ...definition.meridianFlip, recenter: false },
			target: { ...definition.target, type: 'JNOW', tracking: { ...definition.target.tracking, enabled: false }, goto: { ...definition.target.goto, enabled: false }, center: { ...definition.target.center, enabled: false } },
		})

		expect(compilation.ok).toBe(true)
	})

	test('a target tracking with nothing to establish it is refused', () => {
		const definition = canonical()
		const compilation = compile({ ...definition, target: { ...definition.target, goto: { ...definition.target.goto, enabled: false } } })

		expect(compilation.ok).toBe(false)
		if (!compilation.ok) expect(compilation.diagnostics).toEqual([{ path: 'target.tracking.enabled', message: 'tracking is established by the slew on arrival or by a startup action that starts it, and the definition declares neither' }])
	})

	test('a startup action that starts tracking establishes it without a slew', () => {
		const definition = canonical()
		const startup = { ...definition.startup, actions: [...definition.startup.actions, action('track', { type: 'startTracking' })] }
		const compilation = compile({ ...definition, startup, target: { ...definition.target, goto: { ...definition.target.goto, enabled: false } } })

		expect(compilation.ok).toBe(true)
	})

	test('a shutdown action that starts tracking does not establish it for the capture', () => {
		const definition = canonical()
		const shutdown = { ...definition.shutdown, actions: [action('track', { type: 'startTracking' }), ...definition.shutdown.actions] }
		const compilation = compile({ ...definition, shutdown, target: { ...definition.target, goto: { ...definition.target.goto, enabled: false } } })

		expect(compilation.ok).toBe(false)
		if (!compilation.ok) expect(compilation.diagnostics.map((diagnostic) => diagnostic.path)).toEqual(['target.tracking.enabled'])
	})

	test('a dither without a guider is refused', () => {
		const definition = canonical()
		const compilation = compile({ ...definition, guiding: { ...definition.guiding, enabled: false }, dither: { ...definition.dither, enabled: true } })

		expect(compilation.ok).toBe(false)
		if (!compilation.ok) expect(compilation.diagnostics).toEqual([{ path: 'dither.enabled', message: 'a dither is a guider command, and the definition declares no guider to send it to' }])
	})

	test('a cooling block no lifecycle action commands is refused', () => {
		const definition = canonical()
		const startup = definition.startup.actions.filter((action) => action.type !== 'coolCamera')
		const shutdown = definition.shutdown.actions.filter((action) => action.type !== 'warmCamera')
		const compilation = compile({ ...definition, startup: { ...definition.startup, actions: startup }, shutdown: { ...definition.shutdown, actions: shutdown } })

		expect(compilation.ok).toBe(false)
		if (!compilation.ok) expect(compilation.diagnostics).toEqual([{ path: 'cooling.enabled', message: 'the cooling block declares the temperature the capture runs at, and no enabled startup action cools the camera to it, so the session would capture at whatever temperature the sensor is already at' }])
	})

	test('a cooling block only a warming action commands is refused', () => {
		const definition = canonical()
		const actions = definition.startup.actions.filter((action) => action.type !== 'coolCamera')
		const compilation = compile({ ...definition, startup: { ...definition.startup, actions } })

		expect(compilation.ok).toBe(false)
		if (!compilation.ok) expect(compilation.diagnostics).toEqual([{ path: 'cooling.enabled', message: 'the cooling block declares the temperature the capture runs at, and no enabled startup action cools the camera to it, so the session would capture at whatever temperature the sensor is already at' }])
	})

	test('a cooling block only a shutdown action commands is refused', () => {
		const definition = canonical()
		const startup = definition.startup.actions.filter((action) => action.type !== 'coolCamera')
		const shutdown = [action('cool', { type: 'coolCamera' }), ...definition.shutdown.actions]
		const compilation = compile({ ...definition, startup: { ...definition.startup, actions: startup }, shutdown: { ...definition.shutdown, actions: shutdown } })

		expect(compilation.ok).toBe(false)
		if (!compilation.ok) expect(compilation.diagnostics).toEqual([{ path: 'cooling.enabled', message: 'the cooling block declares the temperature the capture runs at, and no enabled startup action cools the camera to it, so the session would capture at whatever temperature the sensor is already at' }])
	})

	test('a lifecycle action commanding the cooler is refused without a cooling block', () => {
		const definition = canonical()
		const compilation = compile({ ...definition, cooling: { ...definition.cooling, enabled: false } })

		expect(compilation.ok).toBe(false)
		if (!compilation.ok) expect(compilation.diagnostics).toEqual([{ path: 'cooling.enabled', message: 'a lifecycle action commands the camera cooler, and the cooling block it reads the temperature from is disabled' }])
	})

	test('a session that does not cool the camera needs no cooling block', () => {
		const definition = canonical()
		const startup = definition.startup.actions.filter((action) => action.type !== 'coolCamera')
		const shutdown = definition.shutdown.actions.filter((action) => action.type !== 'warmCamera')
		const compilation = compile({ ...definition, cooling: { ...definition.cooling, enabled: false }, startup: { ...definition.startup, actions: startup }, shutdown: { ...definition.shutdown, actions: shutdown } })

		expect(compilation.ok).toBe(true)
		if (compilation.ok) expect(compilation.plan.cooling).toBeUndefined()
	})

	test('a feature commanding a role the definition does not declare is refused', () => {
		const definition = canonical()
		const compilation = compile({ ...definition, devices: { camera: 'Camera Simulator', mount: 'Mount Simulator', wheel: 'Wheel Simulator' } })

		expect(compilation.ok).toBe(false)
		if (!compilation.ok) expect(compilation.diagnostics).toEqual([{ path: 'devices.focuser', message: 'autofocus requires the focuser role, which the definition does not declare' }])
	})

	test('a lifecycle action commanding a missing role names the role', () => {
		const definition = canonical()
		const compilation = compile({ ...definition, shutdown: { ...definition.shutdown, actions: [action('cover', { type: 'openCover' })] } })

		expect(compilation.ok).toBe(false)
		if (!compilation.ok) expect(compilation.diagnostics).toEqual([{ path: 'devices.cover', message: 'shutdown.actions[0] requires the cover role, which the definition does not declare' }])
	})

	test('a disabled lifecycle action requires no role', () => {
		const definition = canonical()

		expect(ok({ ...definition, shutdown: { ...definition.shutdown, actions: [action('close', { type: 'closeCover', enabled: false })] } }).plan.roles).not.toContain('cover')
	})

	test('a role required twice is reserved once', () => {
		const { plan } = ok(canonical())

		expect(plan.roles).toEqual(['camera', 'mount', 'focuser'])
	})

	test('an auxiliary capture selecting a filter reserves the wheel', () => {
		const definition = canonical()
		const autofocus = { ...definition.autofocus, capture: { ...definition.autofocus.capture, filter: { type: 'name', name: 'L' } as const } }

		expect(ok({ ...definition, autofocus }).plan.roles).toContain('wheel')
	})

	test('an auxiliary capture selecting a filter is refused without a wheel', () => {
		const definition = canonical()
		const center = { ...definition.target.center, capture: { ...definition.target.center.capture, filter: { type: 'name', name: 'L' } as const } }
		const compilation = compile({ ...definition, devices: { camera: 'Camera Simulator', mount: 'Mount Simulator', focuser: 'Focuser Simulator' }, target: { ...definition.target, center } })

		expect(compilation.ok).toBe(false)
		if (!compilation.ok) expect(compilation.diagnostics).toEqual([{ path: 'devices.wheel', message: 'target.center.capture.filter requires the wheel role, which the definition does not declare' }])
	})

	test('without a registry the block types are not resolved', () => {
		expect(ok(canonical()).ok).toBe(true)
	})

	test('an unregistered block type is refused at the node that needs it', () => {
		const registry = new SequencerBlockRegistry()
		const compilation = compile(canonical(), { registry })

		expect(compilation.ok).toBe(false)
		if (!compilation.ok) expect(compilation.diagnostics[0]).toEqual({ path: 'startup.action[connect]', message: 'no handler is registered for the block type "lifecycle.connectDevices"' })
	})

	test('a handler issue is addressed below the node it came from', () => {
		const registry = new SequencerBlockRegistry()

		for (const type of ['slew', 'center', 'capture.frame', 'trigger.autofocus', 'trigger.dither', 'trigger.meridianFlip', 'lifecycle.connectDevices', 'lifecycle.unparkMount', 'lifecycle.parkMount', 'lifecycle.coolCamera', 'lifecycle.warmCamera']) {
			registry.register({
				type,
				version: 1,
				validate: (configuration) => (type === 'slew' ? { ok: false, issues: [{ path: 'tolerance', message: 'the tolerance is below the arrival tolerance' }] } : { ok: true, configuration }),
				resources: () => [],
				execute: () => Promise.resolve({ type: 'completed', value: undefined } as const),
			})
		}

		const compilation = compile(canonical(), { registry })

		expect(compilation.ok).toBe(false)
		if (!compilation.ok) expect(compilation.diagnostics).toEqual([{ path: 'target[m42].slew.tolerance', message: 'the tolerance is below the arrival tolerance' }])
	})

	test('a role declared only by a handler is reserved by the session', () => {
		const compilation = compile(canonical(), { registry: handlers({ 'lifecycle.parkMount': ['wheel'] }) })

		expect(compilation.ok).toBe(true)
		if (compilation.ok) expect(compilation.plan.roles).toEqual(['camera', 'mount', 'wheel', 'focuser'])
	})

	test('the configuration a handler returns replaces the lowered one', () => {
		const registry = new SequencerBlockRegistry()

		for (const type of ['slew', 'center', 'capture.frame', 'trigger.autofocus', 'trigger.dither', 'trigger.meridianFlip', 'lifecycle.connectDevices', 'lifecycle.unparkMount', 'lifecycle.parkMount', 'lifecycle.coolCamera', 'lifecycle.warmCamera']) {
			registry.register({
				type,
				version: 1,
				validate: (configuration) => (type === 'lifecycle.parkMount' ? { ok: true, configuration: { normalized: true } } : { ok: true, configuration }),
				resources: () => [],
				execute: () => Promise.resolve({ type: 'completed', value: undefined } as const),
			})
		}

		const compilation = compile(canonical(), { registry })

		expect(compilation.ok).toBe(true)

		if (compilation.ok) {
			const nodes = [...sequencerPlanNodes(compilation.plan.root)]
			const parked = nodes.find((node) => node.id === 'finalize.action[park]')
			const connected = nodes.find((node) => node.id === 'startup.action[connect]')

			expect(parked?.kind === 'action' && parked.configuration).toEqual({ normalized: true })
			expect(connected?.kind === 'action' && connected.configuration).toMatchObject({ action: { id: 'connect', type: 'connectDevices' }, timeout: 30 })
		}
	})

	test('a group a capture handler rebuilt is the group the scheduler follows', () => {
		const registry = new SequencerBlockRegistry()

		for (const type of ['slew', 'center', 'capture.frame', 'trigger.autofocus', 'trigger.dither', 'trigger.meridianFlip', 'lifecycle.connectDevices', 'lifecycle.unparkMount', 'lifecycle.parkMount', 'lifecycle.coolCamera', 'lifecycle.warmCamera']) {
			registry.register({
				type,
				version: 1,
				validate: (configuration) => {
					if (type !== 'capture.frame') return { ok: true, configuration }
					const capture = configuration as SequencerCapture
					return { ok: true, configuration: { ...capture, group: { ...capture.group, delay: 30 } } }
				},
				resources: () => [],
				execute: () => Promise.resolve({ type: 'completed', value: undefined } as const),
			})
		}

		const compilation = compile(canonical(), { registry })

		expect(compilation.ok).toBe(true)

		if (compilation.ok) {
			const loop = compilation.plan.root.children[1] as SequencerPlanSequence
			const captures = (loop.children.at(-1) as SequencerPlanLoop).body.children.filter((node) => node.kind === 'action' && node.type === 'capture.frame')

			expect(compilation.plan.groups.map((group) => group.delay)).toEqual([30, 30])
			expect((loop.children.at(-1) as SequencerPlanLoop).groups).toEqual(compilation.plan.groups)
			expect(captures.every((node) => node.kind === 'action' && (node.configuration as SequencerCapture).group.delay === 30)).toBe(true)
		}
	})

	test('a group a capture handler rebuilt keeps the bounds the compiler derived', () => {
		const registry = new SequencerBlockRegistry()

		for (const type of ['slew', 'center', 'capture.frame', 'trigger.autofocus', 'trigger.dither', 'trigger.meridianFlip', 'lifecycle.connectDevices', 'lifecycle.unparkMount', 'lifecycle.parkMount', 'lifecycle.coolCamera', 'lifecycle.warmCamera']) {
			registry.register({
				type,
				version: 1,
				validate: (configuration) => {
					if (type !== 'capture.frame') return { ok: true, configuration }
					const capture = configuration as SequencerCapture
					return { ok: true, configuration: { ...capture, group: { ...capture.group, exposureTime: 30, requiredSlots: Number.POSITIVE_INFINITY, abandonmentBudget: Number.MAX_VALUE, slotLimit: Number.POSITIVE_INFINITY, projectedIntegration: Number.POSITIVE_INFINITY } } }
				},
				resources: () => [],
				execute: () => Promise.resolve({ type: 'completed', value: undefined } as const),
			})
		}

		const compilation = compile(canonical(), { registry })

		expect(compilation.ok).toBe(true)

		if (compilation.ok) {
			const target = compilation.plan.root.children[1] as SequencerPlanSequence
			const loop = target.children.at(-1) as SequencerPlanLoop
			const capture = loop.body.children.find((node) => node.kind === 'action' && node.type === 'capture.frame') as SequencerPlanAction
			const group = compilation.plan.groups[0]

			expect(group.exposureTime).toBe(60)
			expect(group.count).toBe(10)
			expect(group.requiredSlots).toBe(10)
			expect(group.abandonmentBudget).toBe(0)
			expect(group.slotLimit).toBe(10)
			expect(group.projectedIntegration).toBe(600)
			expect((capture.configuration as SequencerCapture).group).toEqual(group)
			expect(loop.groups[0]).toEqual(group)
		}
	})

	test('a group a capture handler rebuilt keeps the identifiers of the node that captures it', () => {
		const registry = new SequencerBlockRegistry()

		for (const type of ['slew', 'center', 'capture.frame', 'trigger.autofocus', 'trigger.dither', 'trigger.meridianFlip', 'lifecycle.connectDevices', 'lifecycle.unparkMount', 'lifecycle.parkMount', 'lifecycle.coolCamera', 'lifecycle.warmCamera']) {
			registry.register({
				type,
				version: 1,
				validate: (configuration) => {
					if (type !== 'capture.frame') return { ok: true, configuration }
					const capture = configuration as SequencerCapture
					return { ok: true, configuration: { ...capture, group: { ...capture.group, id: 'rebuilt', nodeId: 'rebuilt' } } }
				},
				resources: () => [],
				execute: () => Promise.resolve({ type: 'completed', value: undefined } as const),
			})
		}

		const compilation = compile(canonical(), { registry })

		expect(compilation.ok).toBe(true)

		if (compilation.ok) {
			const target = compilation.plan.root.children[1] as SequencerPlanSequence
			const loop = target.children.at(-1) as SequencerPlanLoop
			const capture = loop.body.children.find((node) => node.kind === 'action' && node.type === 'capture.frame') as SequencerPlanAction
			const group = compilation.plan.groups[0]

			expect(group.id).toBe('lum')
			expect(group.nodeId).toBe(capture.id)
			expect((capture.configuration as SequencerCapture).group).toEqual(group)
			expect(loop.groups[0]).toEqual(group)
		}
	})

	test('a capture handler cannot shorten the exposure the slots of an integration target were derived from', () => {
		const registry = new SequencerBlockRegistry()

		for (const type of ['slew', 'center', 'capture.frame', 'trigger.autofocus', 'trigger.dither', 'trigger.meridianFlip', 'lifecycle.connectDevices', 'lifecycle.unparkMount', 'lifecycle.parkMount', 'lifecycle.coolCamera', 'lifecycle.warmCamera']) {
			registry.register({
				type,
				version: 1,
				validate: (configuration) => {
					if (type !== 'capture.frame') return { ok: true, configuration }
					const capture = configuration as SequencerCapture
					return { ok: true, configuration: { ...capture, group: { ...capture.group, exposureTime: 30 } } }
				},
				resources: () => [],
				execute: () => Promise.resolve({ type: 'completed', value: undefined } as const),
			})
		}

		const definition = canonical()
		const compilation = compile({ ...definition, capture: { ...definition.capture, frames: [frame('lum', { count: 0, integrationTime: 600, exposureTime: 60 })] } }, { registry })

		expect(compilation.ok).toBe(true)

		if (compilation.ok) {
			const group = compilation.plan.groups[0]

			expect(group.exposureTime).toBe(60)
			expect(group.integrationTime).toBe(600)
			expect(group.requiredSlots).toBe(10)
			expect(group.projectedIntegration).toBe(600)
		}
	})

	test('a role declared only by a handler is refused when no device answers for it', () => {
		const compilation = compile(canonical(), { registry: handlers({ 'lifecycle.parkMount': ['rotator'] }) })

		expect(compilation.ok).toBe(false)
		if (!compilation.ok) expect(compilation.diagnostics).toEqual([{ path: 'devices.rotator', message: 'finalize.action[park] requires the rotator role, which the definition does not declare' }])
	})
})

describe('termination', () => {
	test('a frame count alone decides the slots', () => {
		const { plan } = ok(canonical())

		expect(plan.groups[0].requiredSlots).toBe(10)
		expect(plan.groups[0].abandonmentBudget).toBe(0)
		expect(plan.groups[0].slotLimit).toBe(10)
		expect(plan.groups[0].projectedIntegration).toBe(600)
	})

	test('an integration time alone decides the slots, rounded up', () => {
		const definition = canonical()
		const { plan } = ok({ ...definition, capture: { ...definition.capture, frames: [frame('lum', { count: 0, integrationTime: 500, exposureTime: 60 })] } })

		expect(plan.groups[0].requiredSlots).toBe(9)
		expect(plan.groups[0].projectedIntegration).toBe(540)
	})

	test('an integration time that divides exactly in decimal schedules no extra slot', () => {
		const definition = canonical()
		const { plan } = ok({ ...definition, capture: { ...definition.capture, frames: [frame('lum', { count: 0, integrationTime: 0.07, exposureTime: 0.01 })] } })

		expect(0.07 / 0.01).toBeGreaterThan(7)
		expect(plan.groups[0].requiredSlots).toBe(7)
		expect(plan.groups[0].projectedIntegration).toBeCloseTo(0.07, 12)
	})

	test('a partial slot of a large integration target is not snapped away', () => {
		const definition = canonical()
		const { plan } = ok({ ...definition, capture: { ...definition.capture, frames: [frame('lum', { count: 0, integrationTime: 500000.0004, exposureTime: 0.001 })] } })

		expect(500000.0004 / 0.001).toBeGreaterThan(500000000)
		expect(plan.groups[0].requiredSlots).toBe(500000001)
	})

	test('a large integration target still absorbs the rounding error of its division', () => {
		const definition = canonical()
		const { plan } = ok({ ...definition, capture: { ...definition.capture, frames: [frame('lum', { count: 0, integrationTime: 1234.56, exposureTime: 0.01 })] } })

		expect(1234.56 / 0.01).toBeLessThan(123456)
		expect(plan.groups[0].requiredSlots).toBe(123456)
	})

	test('with both criteria active the cheaper one decides the slots', () => {
		const definition = canonical()
		const { plan } = ok({ ...definition, capture: { ...definition.capture, frames: [frame('lum', { count: 10, integrationTime: 300, exposureTime: 60 }), frame('red', { count: 3, integrationTime: 600, exposureTime: 60 })] } })

		expect(plan.groups.map((group) => group.requiredSlots)).toEqual([5, 3])
	})

	test('the abandonment budget raises the slot limit without raising the target', () => {
		const definition = canonical()
		const { plan } = ok({ ...definition, capture: { ...definition.capture, frames: [frame('lum', { count: 10, abandonmentBudget: 2 })] } })

		expect(plan.groups[0].requiredSlots).toBe(10)
		expect(plan.groups[0].slotLimit).toBe(12)
		expect(plan.groups[0].projectedIntegration).toBe(600)
	})

	test('the exposures of one cycle are bounded by the slot limit times the attempts per slot', () => {
		const { plan } = ok(canonical())
		const group = plan.groups[0]

		expect(group.slotLimit * group.retry.maxAttempts).toBe(30)
	})

	test('a group with neither criterion is disabled', () => {
		const definition = canonical()
		const { plan } = ok({ ...definition, capture: { ...definition.capture, frames: [frame('lum'), frame('red', { count: 0, integrationTime: 0 })] } })

		expect(plan.groups.map((group) => group.id)).toEqual(['lum'])
	})

	test('a definition whose every group is disabled by its criteria is refused', () => {
		const definition = canonical()
		const compilation = compile({ ...definition, capture: { ...definition.capture, frames: [frame('lum', { count: 0, integrationTime: 0 })] } })

		expect(compilation.ok).toBe(false)
		if (!compilation.ok) expect(compilation.diagnostics).toEqual([{ path: 'capture.frames', message: 'the definition has no enabled frame group to capture' }])
	})

	test('an integration time with a zero exposure time is refused', () => {
		const definition = canonical()
		const compilation = compile({ ...definition, capture: { ...definition.capture, frames: [frame('lum', { count: 0, integrationTime: 600, exposureTime: 0 })] } })

		expect(compilation.ok).toBe(false)
		if (!compilation.ok) expect(compilation.diagnostics).toEqual([{ path: 'capture.frames[0].exposureTime', message: 'a frame group with an integration time requires a positive exposure time' }])
	})

	test('an integration target that overflows its slot count is refused', () => {
		const definition = canonical()
		const compilation = compile({ ...definition, capture: { ...definition.capture, frames: [frame('lum', { count: 0, integrationTime: Number.MAX_VALUE, exposureTime: Number.MIN_VALUE })] } })

		expect(compilation.ok).toBe(false)
		if (!compilation.ok) expect(compilation.diagnostics).toEqual([{ path: 'capture.frames[0].integrationTime', message: 'the integration target needs more exposures of this length than a number can count, so the group has no slot limit to stop at' }])
	})

	test('an integration target that overflows is bounded by a frame count', () => {
		const definition = canonical()
		const compilation = compile({ ...definition, capture: { ...definition.capture, frames: [frame('lum', { count: 5, integrationTime: Number.MAX_VALUE, exposureTime: Number.MIN_VALUE })] } })

		expect(compilation.ok).toBe(true)
		if (compilation.ok) expect(compilation.plan.groups[0].requiredSlots).toBe(5)
	})

	test('a slot limit above the safe counting range is refused', () => {
		const definition = canonical()
		const compilation = compile({ ...definition, capture: { ...definition.capture, frames: [frame('lum', { count: Number.MAX_SAFE_INTEGER, abandonmentBudget: 2 })] } })

		expect(compilation.ok).toBe(false)
		if (!compilation.ok) expect(compilation.diagnostics).toEqual([{ path: 'capture.frames[0]', message: 'the slot limit of the group is above the range a number counts one by one, so a scheduler counting slots would stop advancing before reaching it' }])
	})

	test('a slot limit at the end of the safe counting range is accepted', () => {
		const definition = canonical()
		const compilation = compile({ ...definition, capture: { ...definition.capture, frames: [frame('lum', { count: Number.MAX_SAFE_INTEGER })] } })

		expect(compilation.ok).toBe(true)
		if (compilation.ok) expect(compilation.plan.groups[0].slotLimit).toBe(Number.MAX_SAFE_INTEGER)
	})

	test('a group whose projected integration overflows is refused', () => {
		const definition = canonical()
		const compilation = compile({ ...definition, capture: { ...definition.capture, frames: [frame('lum', { count: 2, exposureTime: Number.MAX_VALUE })] } })

		expect(compilation.ok).toBe(false)
		if (!compilation.ok) expect(compilation.diagnostics).toEqual([{ path: 'capture.frames[0].exposureTime', message: 'the slots of the group exposing for this long overflow the range of a number, so the plan would report no projected integration for it' }])
	})

	test('a sequence whose projected integration overflows over the cycles is refused', () => {
		const definition = canonical()
		const compilation = compile({ ...definition, capture: { ...definition.capture, repeat: 1000, frames: [frame('lum', { count: 1, exposureTime: Number.MAX_VALUE / 2 })] } })

		expect(compilation.ok).toBe(false)
		if (!compilation.ok) expect(compilation.diagnostics).toEqual([{ path: 'capture.repeat', message: 'the projected integration of the whole sequence overflows the range of a number, so the plan would report no projection for it' }])
	})

	test('a capture with no cycle is refused', () => {
		const definition = canonical()
		const compilation = compile({ ...definition, capture: { ...definition.capture, repeat: 0 } })

		expect(compilation.ok).toBe(false)
		if (!compilation.ok) expect(compilation.diagnostics).toEqual([{ path: 'capture.repeat', message: 'the capture must run at least one cycle' }])
	})

	test('a cycle count above the counting range is refused', () => {
		const definition = canonical()

		for (const repeat of [Number.MAX_SAFE_INTEGER + 2, Number.POSITIVE_INFINITY]) {
			const compilation = compile({ ...definition, capture: { ...definition.capture, repeat } })

			expect(compilation.ok).toBe(false)
			if (!compilation.ok) expect(compilation.diagnostics).toEqual([{ path: 'capture.repeat', message: 'the cycle count is above the range a number counts one by one, so a loop counting completed cycles would stop advancing before reaching it' }])
		}
	})

	test('a cycle count at the end of the counting range is accepted', () => {
		const definition = canonical()
		const compilation = compile({ ...definition, capture: { ...definition.capture, repeat: Number.MAX_SAFE_INTEGER } })

		expect(compilation.ok).toBe(true)
	})
})

describe('node identity', () => {
	test('every node id is unique', () => {
		const { plan } = ok(canonical())
		const ids = [...sequencerPlanNodes(plan.root)].map((node) => node.id)

		expect(new Set(ids).size).toBe(ids.length)
	})

	test('inserting an action does not rename any other node', () => {
		const definition = canonical()
		const before = [...sequencerPlanNodes(ok(definition).plan.root)].map((node) => node.id)
		const actions = [definition.startup.actions[0], action('stop', { type: 'stopTracking' }), ...definition.startup.actions.slice(1)]
		const after = [...sequencerPlanNodes(ok({ ...definition, startup: { ...definition.startup, actions } }).plan.root)].map((node) => node.id)

		expect(after).toContain('startup.action[stop]')
		expect(after.filter((id) => id !== 'startup.action[stop]')).toEqual(before)
	})

	test('inserting a frame does not rename any other capture node', () => {
		const definition = canonical()
		const before = ok(definition).plan.groups.map((group) => group.nodeId)
		const frames = [frame('lum'), frame('green'), frame('red')]
		const after = ok({ ...definition, capture: { ...definition.capture, frames } }).plan.groups.map((group) => group.nodeId)

		expect(after).toEqual(['target[m42].capture.frame[lum]', 'target[m42].capture.frame[green]', 'target[m42].capture.frame[red]'])
		expect(after.filter((id) => !id.includes('green'))).toEqual(before)
	})

	test('reordering frames keeps the node id of each one', () => {
		const definition = canonical()
		const reversed = ok({ ...definition, capture: { ...definition.capture, frames: [frame('red'), frame('lum')] } }).plan

		expect(reversed.groups.map((group) => group.nodeId)).toEqual(['target[m42].capture.frame[red]', 'target[m42].capture.frame[lum]'])
	})

	test('renaming a target changes no node id', () => {
		const definition = canonical()
		const before = [...sequencerPlanNodes(ok(definition).plan.root)].map((node) => node.id)
		const after = [...sequencerPlanNodes(ok({ ...definition, target: { ...definition.target, name: 'Great Orion Nebula' } }).plan.root)].map((node) => node.id)

		expect(after).toEqual(before)
	})

	test('the target segment is below the target and never in a pipeline', () => {
		const { plan } = ok(canonical())
		const segment = sequencerNodeId.target('m42')

		for (const node of sequencerPlanNodes(plan.root)) {
			if (node.id === 'plan' || node.id.startsWith('startup') || node.id.startsWith('finalize')) expect(node.id).not.toContain(segment)
			else expect(node.id.startsWith(segment)).toBe(true)
		}
	})

	test('another target id moves only the nodes below the target', () => {
		const definition = canonical()
		const { plan } = ok({ ...definition, target: { ...definition.target, id: 'm31' } })
		const ids = [...sequencerPlanNodes(plan.root)].map((node) => node.id)

		expect(ids).toContain('target[m31].capture.frame[lum]')
		expect(ids).toContain('startup.action[connect]')
		expect(ids.some((id) => id.includes('m42'))).toBe(false)
	})

	test('the loop body is entered exactly once by the traversal', () => {
		const { plan } = ok(canonical())
		const ids = [...sequencerPlanNodes(plan.root)].map((node) => node.id)

		expect(ids.filter((id) => id === 'target[m42].capture.cycle')).toHaveLength(1)
	})
})

describe('path containment', () => {
	test('a frame id with a relative segment is refused', () => {
		const definition = canonical()
		const compilation = compile({ ...definition, capture: { ...definition.capture, frames: [frame('../../etc')] } })

		expect(compilation.ok).toBe(false)
		if (!compilation.ok) expect(compilation.diagnostics).toEqual([{ path: 'capture.frames[0].id', message: 'the frame id "../../etc" contains a path separator or a relative segment and would escape the storage root' }])
	})

	test('a target id with a path separator is refused', () => {
		const definition = canonical()
		const compilation = compile({ ...definition, target: { ...definition.target, id: 'orion/m42' } })

		expect(compilation.ok).toBe(false)
		if (!compilation.ok) expect(compilation.diagnostics).toEqual([{ path: 'target.id', message: 'the target id "orion/m42" contains a path separator or a relative segment and would escape the storage root' }])
	})

	test('a backslash in a frame id is refused on every host', () => {
		const definition = canonical()
		const compilation = compile({ ...definition, capture: { ...definition.capture, frames: [frame('lum\\red')] } })

		expect(compilation.ok).toBe(false)
		if (!compilation.ok) expect(compilation.diagnostics).toEqual([{ path: 'capture.frames[0].id', message: 'the frame id "lum\\red" contains a path separator or a relative segment and would escape the storage root' }])
	})

	test('a directory template climbing out of the session segment is refused', () => {
		const definition = canonical()
		const compilation = compile({ ...definition, storage: { ...definition.storage, directoryTemplate: '../{target}' } })

		expect(compilation.ok).toBe(false)
		if (!compilation.ok) expect(compilation.diagnostics).toEqual([{ path: 'storage.directoryTemplate', message: 'the directory segment ".." is a relative segment and would escape the session directory' }])
	})

	test('a file name template with a separator is refused', () => {
		const definition = canonical()
		const compilation = compile({ ...definition, storage: { ...definition.storage, fileNameTemplate: '{target}/{filter}' } })

		expect(compilation.ok).toBe(false)
		if (!compilation.ok) expect(compilation.diagnostics).toEqual([{ path: 'storage.fileNameTemplate', message: 'the file name template "{target}/{filter}" is empty or contains a path separator, and the file name is a single segment' }])
	})

	test('an empty file name template is refused', () => {
		const definition = canonical()
		const compilation = compile({ ...definition, storage: { ...definition.storage, fileNameTemplate: '' } })

		expect(compilation.ok).toBe(false)
		if (!compilation.ok) expect(compilation.diagnostics).toEqual([{ path: 'storage.fileNameTemplate', message: 'the file name template "" is empty or contains a path separator, and the file name is a single segment' }])
	})

	test('a relative storage root is refused', () => {
		const definition = canonical()
		const compilation = compile({ ...definition, storage: { ...definition.storage, root: 'data/nebulosa' } })

		expect(compilation.ok).toBe(false)
		if (!compilation.ok) expect(compilation.diagnostics).toEqual([{ path: 'storage.root', message: 'the storage root "data/nebulosa" is not an absolute path' }])
	})

	test('a relative temporary directory is refused', () => {
		const definition = canonical()
		const compilation = compile({ ...definition, storage: { ...definition.storage, temporaryDirectory: 'tmp' } })

		expect(compilation.ok).toBe(false)
		if (!compilation.ok) expect(compilation.diagnostics).toEqual([{ path: 'storage.temporaryDirectory', message: 'the temporary directory "tmp" is not an absolute path' }])
	})

	test('a placeholder no renderer interpolates is refused', () => {
		const definition = canonical()
		const compilation = compile({ ...definition, storage: { ...definition.storage, fileNameTemplate: '{target}-{camera}' } })

		expect(compilation.ok).toBe(false)
		if (!compilation.ok) expect(compilation.diagnostics).toEqual([{ path: 'storage.fileNameTemplate', message: 'the placeholder "{camera}" is not interpolated, and it would be written into the path verbatim' }])
	})

	test('an empty directory template writes into the session directory', () => {
		const definition = canonical()
		const { plan } = ok({ ...definition, storage: { ...definition.storage, directoryTemplate: '' } })

		expect(plan.storage.directoryTemplate).toBe('')
	})
})

describe('failure policies', () => {
	test('retrying a disconnected device is refused at the policy that declares it', () => {
		const definition = canonical()
		const compilation = compile({ ...definition, capture: { ...definition.capture, retry: { ...retry(), retryOn: ['timeout', 'disconnected'] } } })

		expect(compilation.ok).toBe(false)
		if (!compilation.ok) expect(compilation.diagnostics).toEqual([{ path: 'capture.retry.retryOn', message: 'a "disconnected" failure ends the session instead of being retried, and retrying it would only repeat the same failure' }])
	})

	test('retrying a removed device is refused', () => {
		const definition = canonical()
		const compilation = compile({ ...definition, execution: { ...definition.execution, defaultRetry: { ...retry(), retryOn: ['removed'] } } })

		expect(compilation.ok).toBe(false)
		if (!compilation.ok) expect(compilation.diagnostics.map((diagnostic) => diagnostic.path)).toEqual(['execution.defaultRetry.retryOn'])
	})

	test('exhausting a policy into a suspension is refused', () => {
		const definition = canonical()
		const compilation = compile({ ...definition, startup: { ...definition.startup, actions: [action('unpark', { retry: { ...retry(), onExhausted: 'suspend' } }), action('cool', { type: 'coolCamera' })] } })

		expect(compilation.ok).toBe(false)
		if (!compilation.ok) expect(compilation.diagnostics).toEqual([{ path: 'startup.actions[0].retry.onExhausted', message: 'this version has no suspended state to exhaust a policy into' }])
	})

	test('an attempt budget above the counting range is refused', () => {
		const definition = canonical()

		for (const maxAttempts of [Number.MAX_SAFE_INTEGER + 2, Number.POSITIVE_INFINITY]) {
			const compilation = compile({ ...definition, capture: { ...definition.capture, retry: { ...retry(), maxAttempts } } })

			expect(compilation.ok).toBe(false)
			if (!compilation.ok) expect(compilation.diagnostics).toEqual([{ path: 'capture.retry.maxAttempts', message: 'the attempt budget is above the range a number counts one by one, so a counter of failed attempts would stop advancing before exhausting it' }])
		}
	})

	test('an attempt budget at the end of the counting range is accepted', () => {
		const definition = canonical()
		const compilation = compile({ ...definition, capture: { ...definition.capture, retry: { ...retry(), maxAttempts: Number.MAX_SAFE_INTEGER } } })

		expect(compilation.ok).toBe(true)
	})

	test('a centering budget above the counting range is refused', () => {
		const definition = canonical()
		const compilation = compile({ ...definition, target: { ...definition.target, center: { ...definition.target.center, maximumAttempts: Number.POSITIVE_INFINITY } } })

		expect(compilation.ok).toBe(false)
		if (!compilation.ok) expect(compilation.diagnostics).toEqual([{ path: 'target.center.maximumAttempts', message: 'the attempt budget is above the range a number counts one by one, so a counter of failed attempts would stop advancing before exhausting it' }])
	})

	test('a flip budget above the counting range is refused', () => {
		const definition = canonical()
		const compilation = compile({ ...definition, meridianFlip: { ...definition.meridianFlip, maximumAttempts: Number.MAX_SAFE_INTEGER + 2 } })

		expect(compilation.ok).toBe(false)
		if (!compilation.ok) expect(compilation.diagnostics).toEqual([{ path: 'meridianFlip.maximumAttempts', message: 'the attempt budget is above the range a number counts one by one, so a counter of failed attempts would stop advancing before exhausting it' }])
	})

	test('the budget of a disabled centering is not reported', () => {
		const definition = canonical()
		const compilation = compile({ ...definition, meridianFlip: { ...definition.meridianFlip, enabled: false }, target: { ...definition.target, center: { ...definition.target.center, enabled: false, maximumAttempts: Number.POSITIVE_INFINITY } } })

		expect(compilation.ok).toBe(true)
	})

	test('the policy of a disabled feature is not reported', () => {
		const definition = canonical()
		const compilation = compile({ ...definition, dither: { ...definition.dither, enabled: false }, guiding: { ...definition.guiding, enabled: false, retry: { ...retry(), retryOn: ['disconnected'] } } })

		expect(compilation.ok).toBe(true)
	})

	test('the policy of a disabled target feature is not reported', () => {
		const definition = canonical()
		const compilation = compile({ ...definition, target: { ...definition.target, tracking: { ...definition.target.tracking, enabled: false }, goto: { ...definition.target.goto, enabled: false, retry: { ...retry(), retryOn: ['disconnected'] } } } })

		expect(compilation.ok).toBe(true)
	})

	test('suspending on an unrecoverable failure is refused at the feature that declares it', () => {
		const definition = canonical()
		const compilation = compile({ ...definition, dither: { ...definition.dither, onFailure: 'suspend' } })

		expect(compilation.ok).toBe(false)
		if (!compilation.ok) expect(compilation.diagnostics).toEqual([{ path: 'dither.onFailure', message: 'this version has no suspended state to move the session into' }])
	})

	test('the failure decision of a disabled feature is not reported', () => {
		const definition = canonical()
		const compilation = compile({ ...definition, autofocus: { ...definition.autofocus, enabled: false, onFailure: 'suspend' } })

		expect(compilation.ok).toBe(true)
	})

	test('an unsupported trigger of a disabled feature is not reported', () => {
		const definition = canonical()
		const compilation = compile({ ...definition, autofocus: { ...definition.autofocus, enabled: false, triggers: { ...definition.autofocus.triggers, starSizeChange: 0.2 } } })

		expect(compilation.ok).toBe(true)
	})

	test('an empty meridian flip window is refused', () => {
		const definition = canonical()
		const compilation = compile({ ...definition, meridianFlip: { ...definition.meridianFlip, minimumHourAngle: 0.1, maximumHourAngle: 0.01 } })

		expect(compilation.ok).toBe(false)
		if (!compilation.ok) expect(compilation.diagnostics).toEqual([{ path: 'meridianFlip.maximumHourAngle', message: 'the flip window is empty, because it ends before the hour angle it may start at' }])
	})

	test('a meridian flip interrupting the current exposure is refused', () => {
		const definition = canonical()
		const compilation = compile({ ...definition, meridianFlip: { ...definition.meridianFlip, waitForCurrentExposure: false } })

		expect(compilation.ok).toBe(false)
		if (!compilation.ok) expect(compilation.diagnostics.map((diagnostic) => diagnostic.path)).toEqual(['meridianFlip.waitForCurrentExposure'])
	})

	test('a window of a disabled meridian flip is not reported', () => {
		const definition = canonical()
		const compilation = compile({ ...definition, meridianFlip: { ...definition.meridianFlip, enabled: false, minimumHourAngle: 0.1, maximumHourAngle: 0.01 } })

		expect(compilation.ok).toBe(true)
	})
})
