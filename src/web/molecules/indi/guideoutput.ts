import { createScope, molecule, onMount } from 'bunshi'
import { unsubscribe } from 'src/shared/bus'
import { DEFAULT_GUIDE_OUTPUT, type GuideOutput, type GuidePulse } from 'src/shared/types'
import { proxy, subscribe } from 'valtio'
import { Api } from '@/shared/api'
import { simpleLocalStorage } from '@/shared/storage'
import type { NudgeDirection } from '@/ui/Nudge'
import { type EquipmentDevice, EquipmentMolecule } from './equipment'

export interface GuideOutputScopeValue {
	readonly guideOutput: GuideOutput
}

export interface GuideOutputState {
	readonly guideOutput: EquipmentDevice<GuideOutput>
	readonly request: {
		readonly north: GuidePulse
		readonly south: GuidePulse
		readonly east: GuidePulse
		readonly west: GuidePulse
	}
}

const DEFAULT_GUIDE_OUTPUT_REQUEST: GuideOutputState['request'] = {
	north: {
		direction: 'NORTH',
		duration: 0,
	},
	south: {
		direction: 'SOUTH',
		duration: 0,
	},
	west: {
		direction: 'WEST',
		duration: 0,
	},
	east: {
		direction: 'EAST',
		duration: 0,
	},
}

export const GuideOutputScope = createScope<GuideOutputScopeValue>({ guideOutput: DEFAULT_GUIDE_OUTPUT })

const guideOutputStateMap = new Map<string, GuideOutputState>()

export const GuideOutputMolecule = molecule((m, s) => {
	const scope = s(GuideOutputScope)
	const equipment = m(EquipmentMolecule)

	const state =
		guideOutputStateMap.get(scope.guideOutput.name) ??
		proxy<GuideOutputState>({
			guideOutput: equipment.get('GUIDE_OUTPUT', scope.guideOutput.name)!,
			request: simpleLocalStorage.get(`guideOutput.${scope.guideOutput.name}.request`, () => structuredClone(DEFAULT_GUIDE_OUTPUT_REQUEST)),
		})

	guideOutputStateMap.set(scope.guideOutput.name, state)

	onMount(() => {
		const unsubscribers = new Array<VoidFunction>(1)

		unsubscribers[0] = subscribe(state.request, () => {
			simpleLocalStorage.set(`guideOutput.${scope.guideOutput.name}.request`, state.request)
		})

		return () => {
			unsubscribe(unsubscribers)
		}
	})

	function update(direction: Lowercase<GuidePulse['direction']>, value: number) {
		state.request[direction].duration = value
	}

	function connect() {
		return equipment.connect(state.guideOutput)
	}

	function pulse(direction: NudgeDirection, down: boolean) {
		if (!down) {
			const { north, south, west, east } = state.request

			switch (direction) {
				case 'upLeft':
					return Promise.all([Api.GuideOutputs.pulse(scope.guideOutput, north), Api.GuideOutputs.pulse(scope.guideOutput, west)])
				case 'upRight':
					return Promise.all([Api.GuideOutputs.pulse(scope.guideOutput, north), Api.GuideOutputs.pulse(scope.guideOutput, east)])
				case 'downLeft':
					return Promise.all([Api.GuideOutputs.pulse(scope.guideOutput, south), Api.GuideOutputs.pulse(scope.guideOutput, west)])
				case 'downRight':
					return Promise.all([Api.GuideOutputs.pulse(scope.guideOutput, south), Api.GuideOutputs.pulse(scope.guideOutput, east)])
				case 'up':
					return Api.GuideOutputs.pulse(scope.guideOutput, north)
				case 'down':
					return Api.GuideOutputs.pulse(scope.guideOutput, south)
				case 'left':
					return Api.GuideOutputs.pulse(scope.guideOutput, west)
				case 'right':
					return Api.GuideOutputs.pulse(scope.guideOutput, east)
			}
		}
	}

	function stop() {
		// Api.GuideOutputs.stop(scope.guideOutput)
	}

	function hide() {
		equipment.hide('GUIDE_OUTPUT', scope.guideOutput)
	}

	return { state, scope, update, connect, pulse, stop, hide } as const
})
