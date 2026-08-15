import { describe, expect, test } from 'bun:test'
import { evaluateSequencerTriggers, sequencerAnchorAdvanced, sequencerFilterBaselined, sequencerFrameCounted, sequencerInitialTriggerAnchors, sequencerTriggerPending } from 'src/api/sequencer.trigger'
import type { SequencerTriggerObservation, SequencerTriggerPolicies } from 'src/api/sequencer.trigger'
import type { SequencerAutofocus, SequencerDither, SequencerMeridianFlip } from '#/sequencer'
import type { SequencerTriggerAnchors } from '#/sequencer.state'

const START = 1_000_000

function anchors(overrides: Partial<SequencerTriggerAnchors> = {}): SequencerTriggerAnchors {
	return { ...sequencerInitialTriggerAnchors(START), ...overrides }
}

function observation(overrides: Partial<SequencerTriggerObservation> = {}): SequencerTriggerObservation {
	return { instant: START, frameType: 'LIGHT', ...overrides }
}

function autofocus(triggers: Partial<SequencerAutofocus['triggers']> = {}): Omit<SequencerAutofocus, 'enabled'> {
	const merged = { onStart: false, onFilterChange: false, afterMeridianFlip: false, afterRecovery: false, everyFrames: 0, everyTime: 0, temperatureChange: 0, starSizeChange: 0, minimumTimeBetweenRuns: 0, ...triggers }
	return { triggers: merged } as unknown as Omit<SequencerAutofocus, 'enabled'>
}

function dither(overrides: Partial<SequencerDither> = {}): Omit<SequencerDither, 'enabled'> {
	return { beforeFirstFrame: false, afterFilterChange: false, everyFrames: 0, everyTime: 0, ...overrides } as unknown as Omit<SequencerDither, 'enabled'>
}

function meridianFlip(overrides: Partial<SequencerMeridianFlip> = {}): Omit<SequencerMeridianFlip, 'enabled'> {
	return { minimumHourAngle: 0.01, maximumHourAngle: 0.05, ...overrides } as unknown as Omit<SequencerMeridianFlip, 'enabled'>
}

function kinds(policies: SequencerTriggerPolicies, state: SequencerTriggerAnchors, observed: SequencerTriggerObservation) {
	return evaluateSequencerTriggers(policies, state, observed).map((decision) => `${decision.kind}:${decision.reason}`)
}

describe('sequencer trigger evaluator', () => {
	test('selects nothing when no trigger was lowered', () => {
		expect(evaluateSequencerTriggers({}, anchors(), observation())).toEqual([])
	})

	test('consults no trigger for a calibration frame', () => {
		const policies = { meridianFlip: meridianFlip(), autofocus: autofocus({ onStart: true }), dither: dither({ beforeFirstFrame: true }) }
		const observed = { hourAngle: 0.2, pierSide: 'WEST' as const, preFlipPierSide: 'WEST' as const }

		expect(kinds(policies, anchors(), observation({ ...observed, frameType: 'LIGHT' }))).toEqual(['meridianFlip:hourAngle', 'autofocus:onStart', 'dither:beforeFirstFrame'])
		expect(kinds(policies, anchors(), observation({ ...observed, frameType: 'DARK' }))).toEqual([])
		expect(kinds(policies, anchors(), observation({ ...observed, frameType: 'FLAT' }))).toEqual([])
		expect(kinds(policies, anchors(), observation({ ...observed, frameType: 'BIAS' }))).toEqual([])
	})

	test('orders the flip before the autofocus and the dither', () => {
		const policies = { meridianFlip: meridianFlip(), autofocus: autofocus({ onStart: true }), dither: dither({ beforeFirstFrame: true }) }
		const observed = observation({ hourAngle: 0.02, pierSide: 'WEST', preFlipPierSide: 'WEST' })

		expect(kinds(policies, anchors(), observed)).toEqual(['meridianFlip:hourAngle', 'autofocus:onStart', 'dither:beforeFirstFrame'])
	})

	test('holds the flip until the hour angle reaches the earliest one allowed', () => {
		const policies = { meridianFlip: meridianFlip({ minimumHourAngle: 0.02 }) }

		expect(kinds(policies, anchors(), observation({ hourAngle: 0.019, pierSide: 'WEST', preFlipPierSide: 'WEST' }))).toEqual([])
		expect(kinds(policies, anchors(), observation({ hourAngle: 0.02, pierSide: 'WEST', preFlipPierSide: 'WEST' }))).toEqual(['meridianFlip:hourAngle'])
	})

	test('decides no flip once the mount is on the other side of the pier', () => {
		const policies = { meridianFlip: meridianFlip() }

		expect(kinds(policies, anchors(), observation({ hourAngle: 0.5, pierSide: 'EAST', preFlipPierSide: 'WEST' }))).toEqual([])
	})

	test('decides no flip while the mount publishes no pier side', () => {
		const policies = { meridianFlip: meridianFlip() }

		expect(kinds(policies, anchors(), observation({ hourAngle: 0.5, preFlipPierSide: 'WEST' }))).toEqual([])
		expect(kinds(policies, anchors(), observation({ hourAngle: 0.5, pierSide: 'WEST' }))).toEqual([])
	})

	test('autofocuses on the first frame of the session and not on the next one', () => {
		const policies = { autofocus: autofocus({ onStart: true }) }
		const observed = observation()

		expect(kinds(policies, anchors(), observed)).toEqual(['autofocus:onStart'])

		const advanced = sequencerAnchorAdvanced(anchors(), 'autofocus', observed)

		expect(kinds(policies, advanced, observation({ instant: START + 60_000 }))).toEqual([])
	})

	test('autofocuses when the selected frame needs another filter than the installed one', () => {
		const policies = { autofocus: autofocus({ onFilterChange: true }), dither: dither({ afterFilterChange: true }) }

		expect(kinds(policies, anchors(), observation({ filter: 'Ha', installedFilter: 'L' }))).toEqual(['autofocus:filterChange', 'dither:filterChange'])
		expect(kinds(policies, anchors(), observation({ filter: 'L', installedFilter: 'L' }))).toEqual([])
	})

	test('keeps the filter change pending after the preparation installed the filter of a suppressed run', () => {
		const policies = { autofocus: autofocus({ onFilterChange: true, minimumTimeBetweenRuns: 600 }) }
		const state = sequencerAnchorAdvanced(anchors(), 'autofocus', observation({ filter: 'R' }))

		expect(kinds(policies, state, observation({ instant: START + 60_000, filter: 'G', installedFilter: 'R' }))).toEqual([])
		expect(kinds(policies, state, observation({ instant: START + 700_000, filter: 'G', installedFilter: 'G' }))).toEqual(['autofocus:filterChange'])
	})

	test('keeps the filter change pending after a run that did not advance the anchor', () => {
		const policies = { autofocus: autofocus({ onFilterChange: true }), dither: dither({ afterFilterChange: true }) }
		const state = sequencerAnchorAdvanced(sequencerAnchorAdvanced(anchors(), 'autofocus', observation({ filter: 'R' })), 'dither', observation({ filter: 'R' }))

		expect(kinds(policies, state, observation({ filter: 'G', installedFilter: 'R' }))).toEqual(['autofocus:filterChange', 'dither:filterChange'])
		expect(kinds(policies, state, observation({ instant: START + 60_000, filter: 'G', installedFilter: 'G' }))).toEqual(['autofocus:filterChange', 'dither:filterChange'])

		const ran = sequencerAnchorAdvanced(sequencerAnchorAdvanced(state, 'autofocus', observation({ filter: 'G' })), 'dither', observation({ filter: 'G' }))

		expect(kinds(policies, ran, observation({ instant: START + 120_000, filter: 'G', installedFilter: 'G' }))).toEqual([])
	})

	test('keeps the first filter change pending after the run that never happened', () => {
		const policies = { autofocus: autofocus({ onFilterChange: true }), dither: dither({ afterFilterChange: true }) }
		const first = observation({ filter: 'G', installedFilter: 'R' })
		const state = sequencerFilterBaselined(anchors(), first)

		expect(state.autofocus).toEqual({ frames: 0, filter: 'R' })
		expect(kinds(policies, state, first)).toEqual(['autofocus:filterChange', 'dither:filterChange'])

		const second = observation({ instant: START + 60_000, filter: 'G', installedFilter: 'G' })
		const baselined = sequencerFilterBaselined(state, second)

		expect(baselined).toBe(state)
		expect(kinds(policies, baselined, second)).toEqual(['autofocus:filterChange', 'dither:filterChange'])

		const ran = sequencerAnchorAdvanced(sequencerAnchorAdvanced(baselined, 'autofocus', second), 'dither', second)

		expect(kinds(policies, sequencerFilterBaselined(ran, second), observation({ instant: START + 120_000, filter: 'G', installedFilter: 'G' }))).toEqual([])
	})

	test('records no filter baseline for a session that commands no wheel', () => {
		const state = anchors()

		expect(sequencerFilterBaselined(state, observation({ filter: 'G' }))).toBe(state)
	})

	test('counts frames per accepted sky frame and fires the count conditions on the declared spacing', () => {
		const policies = { autofocus: autofocus({ everyFrames: 3 }), dither: dither({ everyFrames: 2 }) }
		let state = anchors()

		expect(kinds(policies, state, observation())).toEqual([])

		state = sequencerFrameCounted(state, 'LIGHT')
		state = sequencerFrameCounted(state, 'DARK')

		expect(state.dither.frames).toBe(1)
		expect(kinds(policies, state, observation())).toEqual([])

		state = sequencerFrameCounted(state, 'LIGHT')

		expect(kinds(policies, state, observation())).toEqual(['dither:frames'])

		state = sequencerFrameCounted(state, 'LIGHT')

		expect(kinds(policies, state, observation())).toEqual(['autofocus:frames', 'dither:frames'])
	})

	test('measures elapsed time from the start of the session while the trigger never ran', () => {
		const policies = { dither: dither({ everyTime: 300 }) }

		expect(kinds(policies, anchors(), observation({ instant: START + 299_000 }))).toEqual([])
		expect(kinds(policies, anchors(), observation({ instant: START + 300_000 }))).toEqual(['dither:elapsed'])
	})

	test('measures elapsed time from the last run once it happened', () => {
		const policies = { dither: dither({ everyTime: 300 }) }
		const state = sequencerAnchorAdvanced(anchors(), 'dither', observation({ instant: START + 300_000 }))

		expect(kinds(policies, state, observation({ instant: START + 599_000 }))).toEqual([])
		expect(kinds(policies, state, observation({ instant: START + 600_000 }))).toEqual(['dither:elapsed'])
	})

	test('treats zero as a disabled numeric condition', () => {
		const policies = { autofocus: autofocus({ everyFrames: 0, everyTime: 0, temperatureChange: 0 }), dither: dither({ everyFrames: 0, everyTime: 0 }) }
		let state = anchors()

		for (let i = 0; i < 50; i++) state = sequencerFrameCounted(state, 'LIGHT')

		expect(kinds(policies, state, observation({ instant: START + 86_400_000, temperature: 40 }))).toEqual([])
	})

	test('autofocuses on an absolute temperature change in either direction', () => {
		const policies = { autofocus: autofocus({ temperatureChange: 2 }) }
		const state = sequencerAnchorAdvanced(anchors(), 'autofocus', observation({ temperature: -5 }))
		const later = START + 3_600_000

		expect(kinds(policies, state, observation({ instant: later, temperature: -3.9 }))).toEqual([])
		expect(kinds(policies, state, observation({ instant: later, temperature: -3 }))).toEqual(['autofocus:temperature'])
		expect(kinds(policies, state, observation({ instant: later, temperature: -7 }))).toEqual(['autofocus:temperature'])
	})

	test('never measures a temperature change without a reference on both sides', () => {
		const policies = { autofocus: autofocus({ temperatureChange: 2 }) }
		const withoutReference = sequencerAnchorAdvanced(anchors(), 'autofocus', observation())
		const withReference = sequencerAnchorAdvanced(anchors(), 'autofocus', observation({ temperature: -5 }))

		expect(kinds(policies, withoutReference, observation({ instant: START + 1000, temperature: 20 }))).toEqual([])
		expect(kinds(policies, withReference, observation({ instant: START + 1000 }))).toEqual([])
	})

	test('suppresses an autofocus inside the minimum spacing without advancing the anchor', () => {
		const policies = { autofocus: autofocus({ temperatureChange: 1, minimumTimeBetweenRuns: 600 }) }
		const state = sequencerAnchorAdvanced(anchors(), 'autofocus', observation({ temperature: -5 }))

		expect(kinds(policies, state, observation({ instant: START + 599_000, temperature: -9 }))).toEqual([])
		expect(state.autofocus.at).toBe(START)
		expect(kinds(policies, state, observation({ instant: START + 600_000, temperature: -9 }))).toEqual(['autofocus:temperature'])
	})

	test('never applies the minimum spacing to the first run of the session', () => {
		const policies = { autofocus: autofocus({ onStart: true, minimumTimeBetweenRuns: 3600 }) }

		expect(kinds(policies, anchors(), observation())).toEqual(['autofocus:onStart'])
	})

	test('advances only the anchor of the trigger that ran', () => {
		const state = sequencerFrameCounted(sequencerFrameCounted(anchors(), 'LIGHT'), 'LIGHT')
		const advanced = sequencerAnchorAdvanced(state, 'dither', observation({ instant: START + 5000, temperature: -10, filter: 'Ha' }))

		expect(advanced.dither).toEqual({ at: START + 5000, frames: 0, temperature: -10, filter: 'Ha' })
		expect(advanced.autofocus).toEqual(state.autofocus)
		expect(advanced.driftCheck).toEqual(state.driftCheck)
		expect(advanced.sessionStart).toBe(START)
		expect(state.dither.frames).toBe(2)
	})

	test('keeps the autofocus owed by a recovery pending until a run focused', () => {
		const policies = { autofocus: autofocus({ afterRecovery: true }), dither: dither({ everyFrames: 1 }) }
		const first = observation({ recovered: true })

		expect(kinds(policies, anchors(), first)).toEqual(['autofocus:afterRecovery'])

		const state = sequencerTriggerPending(policies, anchors(), evaluateSequencerTriggers(policies, anchors(), first), first)

		expect(state.pendingAutofocus).toBe('afterRecovery')

		const second = observation({ instant: START + 60_000 })
		const dithered = sequencerAnchorAdvanced(sequencerFrameCounted(state, 'LIGHT'), 'dither', second)

		expect(dithered.pendingAutofocus).toBe('afterRecovery')
		expect(kinds(policies, dithered, second)).toEqual(['autofocus:afterRecovery'])

		const ran = sequencerAnchorAdvanced(dithered, 'autofocus', second)

		expect(ran.pendingAutofocus).toBeUndefined()
		expect(kinds(policies, ran, observation({ instant: START + 120_000 }))).toEqual([])
	})

	test('keeps the autofocus owed by a flip pending after the mount left the pre-flip side', () => {
		const policies = { meridianFlip: meridianFlip(), autofocus: autofocus({ afterMeridianFlip: true }) }
		const first = observation({ hourAngle: 0.02, pierSide: 'WEST', preFlipPierSide: 'WEST' })
		const state = sequencerTriggerPending(policies, anchors(), evaluateSequencerTriggers(policies, anchors(), first), first)

		expect(state.pendingAutofocus).toBe('afterMeridianFlip')

		const second = observation({ instant: START + 60_000, hourAngle: 0.08, pierSide: 'EAST', preFlipPierSide: 'WEST' })

		expect(kinds(policies, state, second)).toEqual(['autofocus:afterMeridianFlip'])
		expect(sequencerAnchorAdvanced(state, 'autofocus', second).pendingAutofocus).toBeUndefined()
	})

	test('sweeps once when the flip that won focuses inside its own node', () => {
		const nested = { meridianFlip: meridianFlip(), autofocus: autofocus({ afterMeridianFlip: true, everyFrames: 1 }) }
		const state = sequencerFrameCounted(anchors(), 'LIGHT')
		const observed = observation({ hourAngle: 0.02, pierSide: 'WEST', preFlipPierSide: 'WEST' })

		expect(kinds(nested, state, observed)).toEqual(['meridianFlip:hourAngle'])
		expect(kinds(nested, state, observation({ instant: START + 60_000 }))).toEqual(['autofocus:frames'])
	})

	test('owes no post-flip focus to a definition whose autofocus does not ask for one', () => {
		const policies = { meridianFlip: meridianFlip(), autofocus: autofocus({ everyFrames: 5 }) }
		const observed = observation({ hourAngle: 0.02, pierSide: 'WEST', preFlipPierSide: 'WEST' })

		expect(sequencerTriggerPending(policies, anchors(), evaluateSequencerTriggers(policies, anchors(), observed), observed).pendingAutofocus).toBeUndefined()
	})

	test('keeps a post-event focus owed while the minimum time between runs suppresses it', () => {
		const policies = { autofocus: autofocus({ afterRecovery: true, minimumTimeBetweenRuns: 600 }) }
		const focused = sequencerAnchorAdvanced(anchors(), 'autofocus', observation())
		const recovery = observation({ instant: START + 60_000, recovered: true })

		expect(kinds(policies, focused, recovery)).toEqual([])

		const state = sequencerTriggerPending(policies, focused, evaluateSequencerTriggers(policies, focused, recovery), recovery)

		expect(state.pendingAutofocus).toBe('afterRecovery')
		expect(kinds(policies, state, observation({ instant: START + 700_000 }))).toEqual(['autofocus:afterRecovery'])
	})

	test('records nothing pending for a condition the next safe point can observe again', () => {
		const policies = { autofocus: autofocus({ everyFrames: 1 }) }
		const state = sequencerFrameCounted(anchors(), 'LIGHT')

		expect(sequencerTriggerPending(policies, state, evaluateSequencerTriggers(policies, state, observation()), observation())).toBe(state)
		expect(sequencerTriggerPending(policies, state, [], observation())).toBe(state)
	})

	test('drops an owed autofocus whose trigger is no longer enabled', () => {
		const state = anchors({ pendingAutofocus: 'afterMeridianFlip' })
		const observed = observation({ instant: START + 60_000 })

		expect(kinds({ autofocus: autofocus({ afterMeridianFlip: true }) }, state, observed)).toEqual(['autofocus:afterMeridianFlip'])
		expect(kinds({ autofocus: autofocus({ afterRecovery: true }) }, state, observed)).toEqual([])
	})

	test('reports the first condition that held in the documented order', () => {
		const policies = { autofocus: autofocus({ onStart: true, onFilterChange: true, everyFrames: 1 }) }
		let state = anchors()

		for (let i = 0; i < 3; i++) state = sequencerFrameCounted(state, 'LIGHT')

		expect(kinds(policies, state, observation({ filter: 'Ha', installedFilter: 'L' }))).toEqual(['autofocus:onStart'])

		const advanced = sequencerAnchorAdvanced(state, 'autofocus', observation({ filter: 'L' }))
		const counted = sequencerFrameCounted(advanced, 'LIGHT')

		expect(kinds(policies, counted, observation({ filter: 'Ha', installedFilter: 'L' }))).toEqual(['autofocus:filterChange'])
	})
})
