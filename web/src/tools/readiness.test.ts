import { describe, expect, test } from 'bun:test'
import { TOOL_IDS } from '../shell/route'
import { toolReadiness, type ToolReadinessContext } from './readiness'
import { TOOL_DEFINITIONS, toolStatus } from './tools'

const READY: ToolReadinessContext = { mount: 'connected', site: true, gateway: { status: 'ready' }, listeners: [] }

describe('tool readiness', () => {
	test('a ready profile marks no available tool', () => {
		for (const id of TOOL_IDS) {
			const planned = toolStatus(TOOL_DEFINITIONS[id]) === 'planned'
			expect(toolReadiness(id, planned, READY)).toEqual(planned ? { label: 'Planned', tone: 'muted', reason: 'Not available yet.' } : undefined)
		}
	})

	test('tools that need the mount say so with the reason of the role', () => {
		const context = { ...READY, mount: 'disconnected' } as const
		expect(toolReadiness('meridian-flip', false, context)).toEqual({ label: 'Needs mount', tone: 'muted', reason: 'The assigned mount is disconnected.' })
		expect(toolReadiness('mount-remote-control', false, { ...READY, mount: 'notSelected' })).toEqual({ label: 'Needs mount', tone: 'muted', reason: 'No mount is assigned in Equipment Setup.' })
		expect(toolReadiness('mount-pointing-model', false, context)).toBeUndefined()
	})

	test('a missing mount is said before what the monitor runs', () => {
		const meridianFlip = { headline: ['Waiting for the mount', 'warning'] as const, armed: true }
		expect(toolReadiness('meridian-flip', false, { ...READY, mount: 'disconnected', meridianFlip })?.label).toBe('Needs mount')
	})

	test('an enabled monitor shows its step, Armed, or its headline, never in the success colour', () => {
		const headline = ['Monitoring', 'success'] as const
		expect(toolReadiness('meridian-flip', false, { ...READY, meridianFlip: { headline, armed: false } })).toMatchObject({ label: 'Monitoring', tone: 'active' })
		expect(toolReadiness('meridian-flip', false, { ...READY, meridianFlip: { headline, armed: true } })).toMatchObject({ label: 'Armed', tone: 'active' })
		expect(toolReadiness('meridian-flip', false, { ...READY, meridianFlip: { headline, step: 'Slewing', armed: true } })).toMatchObject({ label: 'Slewing', tone: 'active' })
		expect(toolReadiness('meridian-flip', false, { ...READY, meridianFlip: { headline: ['Deadline passed', 'danger'], armed: false } })).toMatchObject({ label: 'Deadline passed', tone: 'danger', running: true })
	})

	test('a running listener of the mount is Serving', () => {
		expect(toolReadiness('mount-remote-control', false, { ...READY, listeners: ['LX200 on 0.0.0.0:10001'] })).toEqual({ label: 'Serving', tone: 'active', reason: 'Listening: LX200 on 0.0.0.0:10001.', running: true })
	})

	test('only running work is running: setup gaps, failures, and planned tools are not', () => {
		expect(toolReadiness('meridian-flip', false, { ...READY, mount: 'disconnected' })?.running).toBeUndefined()
		expect(toolReadiness('observatory-cameras', false, { ...READY, gateway: { status: 'unavailable' } })?.running).toBeUndefined()
		expect(toolReadiness('alpaca-server', true, READY)?.running).toBeUndefined()
	})

	test('Astro Weather needs an observing site', () => {
		expect(toolReadiness('astro-weather', false, { ...READY, site: false })).toMatchObject({ label: 'Needs site', tone: 'muted' })
	})

	test('Observatory Cameras follows the media gateway', () => {
		expect(toolReadiness('observatory-cameras', false, { ...READY, gateway: { status: 'notInstalled' } })).toEqual({ label: 'Needs MediaMTX', tone: 'muted', reason: 'MediaMTX is not installed.' })
		expect(toolReadiness('observatory-cameras', false, { ...READY, gateway: { status: 'unavailable', message: 'MediaMTX exited.' } })).toEqual({ label: 'MediaMTX unavailable', tone: 'warning', reason: 'MediaMTX exited.' })
		expect(toolReadiness('observatory-cameras', false, { ...READY, gateway: { status: 'starting' } })).toBeUndefined()
		expect(toolReadiness('observatory-cameras', false, { ...READY, gateway: undefined })).toBeUndefined()
	})

	test('internet tools and partial gaps are never marked', () => {
		const context: ToolReadinessContext = { mount: 'notSelected', site: false, listeners: [] }
		for (const id of ['close-approaches', 'artificial-satellites', 'observing-planner', 'calculator'] as const) expect(toolReadiness(id, false, context)).toBeUndefined()
	})
})
