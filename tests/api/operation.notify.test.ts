import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { WebSocketMessageHandler } from 'src/api/message'
import { NotificationHandler } from 'src/api/notification'
import { detachOperation, notifyOperationFailure, operationFailureNotification } from 'src/api/operation.notify'
import type { Notification } from '#/notification'
import { failedOperationResult, successfulOperationResult } from '#/orchestration'
import { SocketMessager } from './util'

const wsm = new WebSocketMessageHandler()
const notification = new NotificationHandler(wsm)
const socket = new SocketMessager()

let consoleError = spyOn(console, 'error').mockImplementation(() => {})

beforeEach(() => {
	consoleError = spyOn(console, 'error').mockImplementation(() => {})
	wsm.open(socket)
	socket.clear()
})

afterEach(() => {
	consoleError.mockRestore()
	wsm.close(socket, 1000, 'reset')
	socket.clear()
})

function sent() {
	return socket.find<Notification>((message) => message.type === 'notification')?.body
}

describe('operation failure notification', () => {
	test('describes a busy resource as a warning', () => {
		expect(operationFailureNotification('CAMERA', 'Camera Simulator', 'start the capture', 'busy')).toEqual({
			title: 'CAMERA',
			description: 'Camera Simulator could not start the capture: it is in use by another operation or not ready',
			color: 'warning',
		})
	})

	test('describes every other reason as an error', () => {
		expect(operationFailureNotification('FOCUSER', 'Focuser Simulator', 'move to position 1000', 'disconnected')).toEqual({
			title: 'FOCUSER',
			description: 'Focuser Simulator could not move to position 1000: the device is disconnected',
			color: 'danger',
		})
	})
})

describe('notify operation failure', () => {
	test('sends nothing for a successful outcome', () => {
		expect(notifyOperationFailure(notification, 'CAMERA', 'Camera Simulator', 'start the capture', successfulOperationResult(undefined))).toBeFalse()
		expect(socket.messages).toHaveLength(0)
		expect(consoleError).not.toHaveBeenCalled()
	})

	test('notifies a failed outcome without its diagnostic detail', () => {
		expect(notifyOperationFailure(notification, 'CAMERA', 'Camera Simulator', 'start the capture', failedOperationResult('busy', 'resource 0f8a is held by operation 12'))).toBeTrue()

		expect(sent()).toEqual({ title: 'CAMERA', description: 'Camera Simulator could not start the capture: it is in use by another operation or not ready', color: 'warning' })
		expect(consoleError).toHaveBeenCalledTimes(1)
	})

	test('logs but does not notify a stop the user asked for', () => {
		expect(notifyOperationFailure(notification, 'MOUNT', 'Mount Simulator', 'park', failedOperationResult('aborted'))).toBeFalse()
		expect(socket.messages).toHaveLength(0)
		expect(consoleError).toHaveBeenCalledTimes(1)
	})
})

describe('detach operation', () => {
	test('reports the failure of a command nobody awaits', async () => {
		detachOperation(notification, 'WHEEL', 'Wheel Simulator', 'move to slot 3', () => Promise.resolve(failedOperationResult('timeout')))

		await Promise.resolve()

		expect(sent()).toEqual({ title: 'WHEEL', description: 'Wheel Simulator could not move to slot 3: the device did not respond in time', color: 'danger' })
	})

	test('stays silent when the command succeeds', async () => {
		detachOperation(notification, 'WHEEL', 'Wheel Simulator', 'move to slot 3', () => Promise.resolve(successfulOperationResult(undefined)))

		await Promise.resolve()

		expect(socket.messages).toHaveLength(0)
	})
})
