import { createScope, molecule, onMount, use } from 'bunshi'
import { DEFAULT_GUIDE_OUTPUT, type GuideOutput } from 'nebulosa/src/indi.device'
import type { GuidePulse } from 'src/shared/types'
import { proxy } from 'valtio'
import { Api } from '@/shared/api'
import { initProxy } from '@/shared/proxy'
import type { NudgeDirection } from '@/ui/Nudge'
import { type EquipmentDevice, EquipmentMolecule } from './equipment'

export interface GuideOutputScopeValue {
	readonly guideOutput: GuideOutput
}

export interface GuideOutputState {
	guideOutput: EquipmentDevice<GuideOutput>
	readonly request: {
		readonly north: GuidePulse
		readonly south: GuidePulse
		readonly east: GuidePulse
		readonly west: GuidePulse
	}
}

const DEFAULT_GUIDE_OUTPUT_REQUEST: GuideOutputState['request'] = {
	north: { direction: 'NORTH', duration: 0 },
	south: { direction: 'SOUTH', duration: 0 },
	west: { direction: 'WEST', duration: 0 },
	east: { direction: 'EAST', duration: 0 },
}

export const GuideOutputScope = createScope<GuideOutputScopeValue>({ guideOutput: DEFAULT_GUIDE_OUTPUT })

const stateMap = new Map<string, GuideOutputState>()

export const GuideOutputMolecule = molecule(() => {
	const scope = use(GuideOutputScope)
	const equipment = use(EquipmentMolecule)

	const guideOutput = equipment.get('GUIDE_OUTPUT', scope.guideOutput.name)!

	const state =
		stateMap.get(guideOutput.name) ??
		proxy<GuideOutputState>({
			guideOutput,
			request: structuredClone(DEFAULT_GUIDE_OUTPUT_REQUEST),
		})

	stateMap.set(guideOutput.name, state)

	onMount(() => {
		state.guideOutput = equipment.get('GUIDE_OUTPUT', state.guideOutput.name)!

		const unsubscriber = initProxy(state, `guideoutput.${guideOutput.name}`, ['o:request'])

		return () => {
			unsubscriber()
		}
	})

	function update(direction: Lowercase<GuidePulse['direction']>, value: number) {
		state.request[direction].duration = value
	}

	function connect() {
		return equipment.connect(guideOutput)
	}

	function pulse(direction: NudgeDirection, down: boolean) {
		if (!down) {
			const { north, south, west, east } = state.request

			switch (direction) {
				case 'upLeft':
					return Promise.all([Api.GuideOutputs.pulse(guideOutput, north), Api.GuideOutputs.pulse(guideOutput, west)])
				case 'upRight':
					return Promise.all([Api.GuideOutputs.pulse(guideOutput, north), Api.GuideOutputs.pulse(guideOutput, east)])
				case 'downLeft':
					return Promise.all([Api.GuideOutputs.pulse(guideOutput, south), Api.GuideOutputs.pulse(guideOutput, west)])
				case 'downRight':
					return Promise.all([Api.GuideOutputs.pulse(guideOutput, south), Api.GuideOutputs.pulse(guideOutput, east)])
				case 'up':
					return Api.GuideOutputs.pulse(guideOutput, north)
				case 'down':
					return Api.GuideOutputs.pulse(guideOutput, south)
				case 'left':
					return Api.GuideOutputs.pulse(guideOutput, west)
				case 'right':
					return Api.GuideOutputs.pulse(guideOutput, east)
			}
		}
	}

	function stop() {
		// Api.GuideOutputs.stop(guideOutput)
	}

	function hide() {
		equipment.hide('GUIDE_OUTPUT', guideOutput)
	}

	return { state, scope, update, connect, pulse, stop, hide } as const
})
