import { expect, test } from 'bun:test'
import type { AnalysisJob } from 'api'
import { analysisElapsed } from './analysis'

function job(patch: Partial<AnalysisJob> & { readonly summary?: { readonly elapsed: number } } = {}) {
	return { jobId: 'job', imageId: 'image', state: 'queued', queuedAt: 0, ...patch } as const
}

test('a job takes no time before it starts, runs until now, and ends at its summary or its end', () => {
	expect(analysisElapsed(job(), 5000)).toBe(0)
	expect(analysisElapsed(job({ state: 'running', startedAt: 1000 }), 5000)).toBe(4000)
	expect(analysisElapsed(job({ state: 'failed', startedAt: 1000, endedAt: 3000 }), 5000)).toBe(2000)
	expect(analysisElapsed(job({ state: 'completed', startedAt: 1000, endedAt: 3000, summary: { elapsed: 1500 } }), 5000)).toBe(1500)
})
