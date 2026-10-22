import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { CommandAccepted } from './commands'
import { ConnectionManager } from './connection'
import { type FocuserBacklashConfig, FocuserBacklashStore } from './focuserbacklash'
import { type FocuserBacklashEvent, type FocuserBacklashState, FocuserCommands } from './focusers'
import { type OperationEvent, OperationRegistry } from './operations'

const disposables: Disposable[] = []

afterEach(() => {
	for (const disposable of disposables.splice(0).toReversed()) disposable[Symbol.dispose]()
})

async function waitUntil(condition: () => boolean, timeout = 10000) {
	const start = Date.now()
	while (!condition()) {
		if (Date.now() - start > timeout) throw new Error('timeout')
		await Bun.sleep(20)
	}
}

// Simulator connection with its focuser connected.
async function setup() {
	const manager = new ConnectionManager()
	disposables.push(manager)
	const { id } = await manager.connect({ type: 'SIMULATOR' })
	const client = manager.client(id)!
	const events: OperationEvent[] = []
	const operations = new OperationRegistry(manager.devices, (event) => events.push(event))
	disposables.push(operations)
	const directory = mkdtempSync(join(tmpdir(), 'nebulosa-focusers-'))
	disposables.push({ [Symbol.dispose]: () => rmSync(directory, { recursive: true, force: true }) })
	const backlashEvents: FocuserBacklashEvent[] = []
	const commands = new FocuserCommands(
		manager.devices,
		(connectionId) => manager.client(connectionId),
		operations,
		new FocuserBacklashStore(join(directory, 'focusers.json')),
		(event) => backlashEvents.push(event),
	)
	disposables.push(commands)
	const focuserId = manager.devices.list(client).find((d) => d.type === 'focuser')!.id
	manager.devices.switch(client, focuserId, true)
	const focuser = manager.devices.device(client, 'focuser', focuserId)!
	await waitUntil(() => focuser.connected && focuser.canAbsoluteMove && operations.available(focuser))
	return { id, client, manager, commands, operations, events, backlashEvents, focuser, focuserId }
}

// Resolves once the operation reported its outcome and returns its final record.
async function outcome(events: readonly OperationEvent[], operationId: string) {
	await waitUntil(() => events.some((event) => event.operation.operationId === operationId && event.operation.state !== 'running'), 30000)
	return events.findLast((event) => event.operation.operationId === operationId)!.operation
}

test('moves to a position and by steps, confirmed by the reported position', async () => {
	const { id, commands, events, focuser, focuserId } = await setup()
	const start = focuser.position.value

	const to = (await commands.moveTo(id, focuserId, { token: 'to', position: start + 1000 }).json()) as CommandAccepted
	expect(await outcome(events, to.operationId)).toMatchObject({ kind: 'focuser.move', state: 'succeeded' })
	expect(focuser.position.value).toBe(start + 1000)

	const inward = (await commands.move(id, focuserId, { token: 'in', direction: 'IN', steps: 300 }).json()) as CommandAccepted
	expect(await outcome(events, inward.operationId)).toMatchObject({ state: 'succeeded' })
	expect(focuser.position.value).toBe(start + 700)
}, 40000)

test('a relative move repeated with its token moves only once', async () => {
	const { id, commands, events, focuser, focuserId } = await setup()
	const start = focuser.position.value
	const request = { token: 'once', direction: 'OUT', steps: 200 } as const

	const first = (await commands.move(id, focuserId, request).json()) as CommandAccepted
	const second = (await commands.move(id, focuserId, request).json()) as CommandAccepted
	expect(second.operationId).toBe(first.operationId)
	await outcome(events, first.operationId)
	expect((await commands.move(id, focuserId, request).json()) as CommandAccepted).toEqual(first)
	expect(focuser.position.value).toBe(start + 200)
}, 40000)

test('a second move is busy, stop ends the first, and sync redefines the position', async () => {
	const { id, commands, events, focuser, focuserId } = await setup()

	const far = (await commands.moveTo(id, focuserId, { token: 'far', position: focuser.position.max }).json()) as CommandAccepted
	await waitUntil(() => focuser.moving)
	expect(commands.moveTo(id, focuserId, { token: 'other', position: 0 }).status).toBe(409)
	expect((await commands.stop(id, focuserId)).status).toBe(204)
	expect(await outcome(events, far.operationId)).toMatchObject({ state: 'failed', reason: 'aborted' })
	expect(focuser.moving).toBeFalse()

	expect((await commands.sync(id, focuserId, { position: 12345 })).status).toBe(204)
	await waitUntil(() => focuser.position.value === 12345)
	expect((await commands.reverse(id, focuserId, { enabled: true })).status).toBe(204)
	await waitUntil(() => focuser.reversed)
}, 40000)

test('refuses unknown and disconnected focusers', async () => {
	const { id, client, manager, commands, focuserId } = await setup()
	expect(commands.moveTo(id, 'missing', { token: 't', position: 1 }).status).toBe(404)
	expect(commands.state('other', focuserId).status).toBe(404)
	expect(commands.state(id, focuserId).status).toBe(200)

	manager.devices.switch(client, focuserId, false)
	await waitUntil(() => !manager.devices.device(client, 'focuser', focuserId)!.connected)
	expect(commands.moveTo(id, focuserId, { token: 't', position: 1 }).status).toBe(409)
	expect((await commands.sync(id, focuserId, { position: 1 })).status).toBe(409)
})

// Saves the backlash compensation of the focuser from its current revision and returns its new state.
async function saveBacklash(commands: FocuserCommands, id: string, focuserId: string, config: FocuserBacklashConfig) {
	const { revision } = (await (await commands.backlashState(id, focuserId)).json()) as FocuserBacklashState
	const response = await commands.saveBacklash(id, focuserId, { config, revision })
	expect(response.status).toBe(200)
	return (await response.json()) as FocuserBacklashState
}

// Progress messages published by an operation, in order.
function progressOf(events: readonly OperationEvent[], operationId: string) {
	return events.flatMap(({ operation }) => (operation.operationId === operationId && operation.progress ? [`${operation.progress.step}/${operation.progress.steps} ${operation.progress.message}`] : []))
}

test('a disabled compensation moves straight to the target', async () => {
	const { id, commands, events, focuser, focuserId } = await setup()
	await saveBacklash(commands, id, focuserId, { enabled: false, mode: 'OVERSHOOT', backlashIn: 50, backlashOut: 50 })
	const target = focuser.position.value + 300

	const moved = (await commands.moveTo(id, focuserId, { token: 'plain', position: target }).json()) as CommandAccepted
	expect(await outcome(events, moved.operationId)).toMatchObject({ state: 'succeeded' })
	expect(focuser.position.value).toBe(target)
	expect(progressOf(events, moved.operationId)).toEqual([])
}, 40000)

test('an overshoot compensation goes past the target and comes back in one operation', async () => {
	const { id, commands, events, focuser, focuserId } = await setup()
	await saveBacklash(commands, id, focuserId, { enabled: true, mode: 'OVERSHOOT', backlashIn: 0, backlashOut: 80 })
	const target = focuser.position.value + 300

	const moved = (await commands.moveTo(id, focuserId, { token: 'overshoot', position: target }).json()) as CommandAccepted
	expect(await outcome(events, moved.operationId)).toMatchObject({ kind: 'focuser.move', state: 'succeeded' })
	expect(focuser.position.value).toBe(target)
	expect(progressOf(events, moved.operationId)).toEqual([`1/2 Moving to ${target + 80}`, `2/2 Moving to ${target}`])
	expect(events.filter(({ operation }) => operation.state === 'running' && operation.progress === undefined)).toHaveLength(1)
}, 40000)

test('an absolute compensation keeps a logical position until a sync', async () => {
	const { id, commands, events, backlashEvents, focuser, focuserId } = await setup()
	await saveBacklash(commands, id, focuserId, { enabled: true, mode: 'ABSOLUTE', backlashIn: 100, backlashOut: 100 })
	const start = focuser.position.value

	const out = (await commands.moveTo(id, focuserId, { token: 'out', position: start + 1000 }).json()) as CommandAccepted
	expect(await outcome(events, out.operationId)).toMatchObject({ state: 'succeeded' })
	expect(focuser.position.value).toBe(start + 1000)

	const inward = (await commands.move(id, focuserId, { token: 'in', direction: 'IN', steps: 500 }).json()) as CommandAccepted
	expect(await outcome(events, inward.operationId)).toMatchObject({ state: 'succeeded' })
	expect(focuser.position.value).toBe(start + 400)
	expect(commands.mover.position(focuser)).toBe(start + 500)
	await waitUntil(() => backlashEvents.at(-1)?.backlash.offset === -100)

	expect((await commands.sync(id, focuserId, { position: 20000 })).status).toBe(204)
	await waitUntil(() => backlashEvents.at(-1)?.backlash.offset === 0)
	await waitUntil(() => focuser.position.value === 20000)
	expect(commands.mover.position(focuser)).toBe(20000)
}, 40000)

test('a plan leaving the travel is refused before anything moves', async () => {
	const { id, commands, events, focuser, focuserId } = await setup()
	await saveBacklash(commands, id, focuserId, { enabled: true, mode: 'OVERSHOOT', backlashIn: 0, backlashOut: 80 })
	const start = focuser.position.value

	const moved = (await commands.moveTo(id, focuserId, { token: 'edge', position: focuser.position.max }).json()) as CommandAccepted
	expect(await outcome(events, moved.operationId)).toMatchObject({ state: 'failed', reason: 'unexpectedState' })
	expect(focuser.position.value).toBe(start)
	expect(focuser.moving).toBeFalse()
}, 40000)

test('a stop during the overshoot commands no further position', async () => {
	const { id, commands, events, focuser, focuserId } = await setup()
	await saveBacklash(commands, id, focuserId, { enabled: true, mode: 'OVERSHOOT', backlashIn: 0, backlashOut: 20000 })
	const target = focuser.position.value + 1000

	const moved = (await commands.moveTo(id, focuserId, { token: 'stopped', position: target }).json()) as CommandAccepted
	await waitUntil(() => focuser.moving)
	expect((await commands.stop(id, focuserId)).status).toBe(204)
	expect(await outcome(events, moved.operationId)).toMatchObject({ state: 'failed', reason: 'aborted' })
	expect(progressOf(events, moved.operationId)).toEqual([`1/2 Moving to ${target + 20000}`])
	expect(focuser.moving).toBeFalse()
}, 40000)

test('a compensated move of a focuser whose driver compensates its backlash is refused before anything moves', async () => {
	const { id, client, commands, events, focuser, focuserId } = await setup()
	await saveBacklash(commands, id, focuserId, { enabled: true, mode: 'OVERSHOOT', backlashIn: 0, backlashOut: 80 })
	const start = focuser.position.value

	client.sendSwitch({ device: focuser.name, name: 'FOCUS_BACKLASH_TOGGLE', elements: { INDI_ENABLED: true } })
	await waitUntil(() => focuser.backlashEnabled)

	const refused = (await commands.moveTo(id, focuserId, { token: 'double', position: start + 300 }).json()) as CommandAccepted
	expect(await outcome(events, refused.operationId)).toMatchObject({ state: 'failed', reason: 'unexpectedState' })
	expect(progressOf(events, refused.operationId)).toEqual([])
	expect(focuser.position.value).toBe(start)

	client.sendSwitch({ device: focuser.name, name: 'FOCUS_BACKLASH_TOGGLE', elements: { INDI_DISABLED: true } })
	await waitUntil(() => !focuser.backlashEnabled)

	const moved = (await commands.moveTo(id, focuserId, { token: 'single', position: start + 300 }).json()) as CommandAccepted
	expect(await outcome(events, moved.operationId)).toMatchObject({ state: 'succeeded' })
	expect(progressOf(events, moved.operationId)).toEqual([`1/2 Moving to ${start + 380}`, `2/2 Moving to ${start + 300}`])
}, 40000)
