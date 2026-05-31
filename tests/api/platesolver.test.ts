import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { ImageProcessor } from 'src/api/image'
import { WebSocketMessageHandler } from 'src/api/message'
import { NotificationHandler } from 'src/api/notification'
import { plateSolver as plateSolverEndpoints, PlateSolverHandler } from 'src/api/platesolver'
import { DEFAULT_PLATE_SOLVE_START, type Notification, type PlateSolveStart } from 'src/shared/types'
import { noContent, SocketMessager } from './util'

const wsm = new WebSocketMessageHandler()
const imageProcessor = new ImageProcessor()
const notificationHandler = new NotificationHandler(wsm)
const plateSolverHandler = new PlateSolverHandler(notificationHandler, imageProcessor)
const endpoints = plateSolverEndpoints(plateSolverHandler)
const socket = new SocketMessager()

afterEach(() => {
	wsm.close(socket, 1000, 'reset')
	socket.clear()
	plateSolverHandler.stopAll()
})

function request(body?: unknown, id?: string) {
	return {
		url: `http://localhost${id ? `/platesolver/${id}/stop` : '/platesolver/start'}`,
		params: id ? { id } : {},
		json: () => body,
	} as unknown as Bun.BunRequest
}

function plateSolveStart(overrides: Partial<PlateSolveStart> = {}): PlateSolveStart {
	return { ...structuredClone(DEFAULT_PLATE_SOLVE_START), id: 'plate-solve', path: 'image.fit', ...overrides }
}

function unsupportedPlateSolveStart(overrides: Partial<PlateSolveStart> = {}): PlateSolveStart {
	return plateSolveStart({ type: 'unsupported' as PlateSolveStart['type'], ...overrides })
}

function notifications() {
	return socket.filter<Notification>((entry) => entry.type === 'notification').map((entry) => entry.body)
}

describe('plate solver handler', () => {
	test('start endpoint delegates to the handler and returns no content without solution', async () => {
		const payload = plateSolveStart({ id: 'endpoint-start', path: 'endpoint.fit' })
		const start = spyOn(plateSolverHandler, 'start').mockImplementation(() => Promise.resolve(undefined))

		try {
			await noContent(await endpoints['/platesolver/start'].POST(request(payload)))

			expect(start).toHaveBeenCalledWith(payload)
		} finally {
			start.mockRestore()
		}
	})

	test('stop endpoint delegates to the handler and returns no content', async () => {
		const stop = spyOn(plateSolverHandler, 'stop')

		try {
			await noContent(endpoints['/platesolver/:id/stop'].POST(request(undefined, 'plate-solve-stop')))

			expect(stop).toHaveBeenCalledWith('plate-solve-stop')
		} finally {
			stop.mockRestore()
		}
	})

	test('stores the input image and clears task state when solver type is not recognized', async () => {
		const store = spyOn(imageProcessor, 'store').mockImplementation(() => Promise.resolve('stored.fit'))
		const payload = unsupportedPlateSolveStart({ id: 'unsupported-solver', path: 'input.fit' })

		try {
			const solution = await plateSolverHandler.start(payload)

			expect(solution).toBeUndefined()
			expect(store).toHaveBeenCalledWith('input.fit')
			expect(plateSolverHandler.isRunning('unsupported-solver')).toBeFalse()
			expect(socket.messages).toHaveLength(0)
		} finally {
			store.mockRestore()
		}
	})

	test('emits danger notification when image preprocessing fails', async () => {
		const error = new Error('store failed')
		const store = spyOn(imageProcessor, 'store').mockImplementation(() => Promise.reject(error))
		const consoleError = spyOn(console, 'error').mockImplementation(() => {})

		try {
			wsm.open(socket)

			const solution = await plateSolverHandler.start(plateSolveStart({ id: 'store-error', path: 'bad.fit' }))

			expect(solution).toBeUndefined()
			expect(consoleError).toHaveBeenCalledWith(error)
			expect(notifications()).toEqual([
				{
					title: 'PLATE SOLVER',
					description: 'Failed to plate solve',
					color: 'danger',
				},
			])
			expect(plateSolverHandler.isRunning('store-error')).toBeFalse()
		} finally {
			store.mockRestore()
			consoleError.mockRestore()
		}
	})

	test('does not emit failure notification after the task is stopped', () => {
		let resume!: () => void
		const error = new Error('stopped store failed')
		const store = spyOn(imageProcessor, 'store').mockImplementation(async () => {
			await new Promise<void>((resolve) => {
				resume = resolve
			})

			throw error
		})
		const consoleError = spyOn(console, 'error').mockImplementation(() => {})

		try {
			wsm.open(socket)

			const started = plateSolverHandler.start(plateSolveStart({ id: 'stopped-store-error', path: 'stopped.fit' }))
			plateSolverHandler.stop('stopped-store-error')
			resume()

			expect(started).resolves.toBeUndefined()
			expect(consoleError).not.toHaveBeenCalled()
			expect(notifications()).toHaveLength(0)
			expect(plateSolverHandler.isRunning('stopped-store-error')).toBeFalse()
		} finally {
			store.mockRestore()
			consoleError.mockRestore()
		}
	})

	test('stop aborts and removes a tracked task', () => {
		plateSolverHandler.stop('manual-stop')
		plateSolverHandler.stop('manual-stop')

		expect(plateSolverHandler.isRunning('manual-stop')).toBeFalse()
	})
})
