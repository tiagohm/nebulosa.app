import { describe, expect, test } from 'bun:test'
import type { CalibrationJobSummary, CalibrationLibrarySnapshot, ServerEvent } from 'api'
import { proxy } from 'valtio'
import { buildMaster, type CalibrationLibraryRuntime, handleCalibrationLibraryEvent, jobEnded, loadCalibrationGroups, refreshCalibrationLibrary } from './calibrationlibrary'

function runtime() {
	return proxy<CalibrationLibraryRuntime>({ jobs: {}, changes: 0, loading: false, pending: {}, errors: {} })
}

function snapshot(epoch: string, revision: number, activeJobs: readonly CalibrationJobSummary[] = []): CalibrationLibrarySnapshot {
	return { epoch, revision, unavailable: false, frames: {}, framesByKind: {}, masters: {}, mastersByKind: {}, cameras: [], activeJobs }
}

function job(jobId: string, state: CalibrationJobSummary['state'], updatedAt: number): CalibrationJobSummary {
	return { jobId, type: 'master', state, createdAt: 1, updatedAt, automatic: false, progress: { framesValidated: 0, rowsCombined: 0, rowsTotal: 0, bytesWritten: 0 } }
}

describe('events', () => {
	test('a snapshot older than the one applied is dropped', () => {
		const state = runtime()
		handleCalibrationLibraryEvent(state, { type: 'calibrationLibrary:changed', revision: 5, summary: snapshot('a', 5) })
		handleCalibrationLibraryEvent(state, { type: 'calibrationLibrary:changed', revision: 4, summary: snapshot('a', 4) })
		expect(state.summary?.revision).toBe(5)
	})

	test('a new process replaces everything, whatever its counter says', () => {
		const state = runtime()
		handleCalibrationLibraryEvent(state, { type: 'calibrationLibrary:jobUpdated', epoch: 'a', revision: 1, job: job('old', 'queued', 1) })
		handleCalibrationLibraryEvent(state, { type: 'calibrationLibrary:changed', revision: 50, summary: snapshot('a', 50) })
		handleCalibrationLibraryEvent(state, { type: 'calibrationLibrary:changed', revision: 1, summary: snapshot('b', 1) })
		expect(state.summary?.epoch).toBe('b')
		expect(state.jobs.old).toBeUndefined()
	})

	test('a late job event never takes a job back', () => {
		const state = runtime()
		handleCalibrationLibraryEvent(state, { type: 'calibrationLibrary:jobUpdated', epoch: 'a', revision: 2, job: job('j', 'integrating', 20) })
		handleCalibrationLibraryEvent(state, { type: 'calibrationLibrary:jobUpdated', epoch: 'a', revision: 1, job: job('j', 'queued', 10) })
		expect(state.jobs.j.state).toBe('integrating')
	})

	test('a job that ends asks the views to fetch again, and one in progress does not', () => {
		const state = runtime()
		handleCalibrationLibraryEvent(state, { type: 'calibrationLibrary:jobUpdated', epoch: 'a', revision: 1, job: job('j', 'integrating', 1) })
		expect(state.changes).toBe(0)
		handleCalibrationLibraryEvent(state, { type: 'calibrationLibrary:jobUpdated', epoch: 'a', revision: 2, job: job('j', 'completed', 2) })
		expect(state.changes).toBe(1)
		expect(jobEnded(job('j', 'interrupted', 1))).toBeTrue()
		expect(jobEnded(job('j', 'publishing', 1))).toBeFalse()
	})

	test('other events are ignored', () => {
		const state = runtime()
		handleCalibrationLibraryEvent(state, { type: 'connection:close' } as unknown as ServerEvent)
		expect(state.changes).toBe(0)
	})
})

describe('requests', () => {
	test('a refresh brings a job created elsewhere', async () => {
		const state = runtime()
		await refreshCalibrationLibrary(state, (() => Promise.resolve(Response.json(snapshot('a', 3, [job('j', 'queued', 1)])))) as unknown as typeof fetch)
		expect(state.jobs.j.state).toBe('queued')
	})

	test('a page that arrives after a newer request is dropped', async () => {
		const state = runtime()
		const resolvers: ((response: Response) => void)[] = []

		const request = (() => {
			const { promise, resolve } = Promise.withResolvers<Response>()
			resolvers.push(resolve)
			return promise
		}) as unknown as typeof fetch

		const first = loadCalibrationGroups(state, {}, 0, request)
		const second = loadCalibrationGroups(state, {}, 1, request)
		resolvers[1](Response.json({ items: [], total: 2 }))
		resolvers[0](Response.json({ items: [], total: 1 }))
		await Promise.all([first, second])
		expect(state.groups?.total).toBe(2)
	})

	test('a refused master leaves its reason', async () => {
		const state = runtime()
		await buildMaster(state, 'group', { groupId: 'g' }, (() => Promise.resolve(Response.json({ error: 'Gain differs', code: 'incompatibleFrames' }, { status: 409 }))) as unknown as typeof fetch)
		expect(state.errors.group).toBe('Gain differs')
		expect(state.pending.group).toBeUndefined()
	})
})
