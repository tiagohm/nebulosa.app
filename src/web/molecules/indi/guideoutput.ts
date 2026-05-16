import { createScope, molecule, onMount, use } from 'bunshi'
import { DEFAULT_GUIDE_OUTPUT, type GuideOutput } from 'nebulosa/src/indi.device'
import type { DeepReadonly } from 'nebulosa/src/types'
import bus from 'src/shared/bus'
import type { GuideOutputUpdated, GuidePulse } from 'src/shared/types'
import { unsubscribe } from 'src/shared/util'
import { equipment, type DeviceState } from 'src/web/store/equipment.store'
import { proxy } from 'valtio'
import { Api } from '@/shared/api'
import { initProxy } from '@/shared/proxy'
import { toast } from '@/shared/toast'
import type { NudgeDirection } from '@/ui/Nudge'

export interface GuideOutputScopeValue {
	readonly guideOutput: DeepReadonly<Omit<GuideOutput, symbol>>
}

export interface GuideOutputState {
	guideOutput: DeviceState<GuideOutput>
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

	const guideOutput = equipment.get('guideOutput', scope.guideOutput.id)!

	const state =
		stateMap.get(guideOutput.id) ??
		proxy<GuideOutputState>({
			guideOutput,
			request: structuredClone(DEFAULT_GUIDE_OUTPUT_REQUEST),
		})

	stateMap.set(guideOutput.id, state)

	onMount(() => {
		state.guideOutput = equipment.get('guideOutput', state.guideOutput.id)!

		const unsubscribers = new Array<VoidFunction>(2)

		unsubscribers[0] = bus.subscribe<GuideOutputUpdated>('guideOutput:update', (event) => {
			if (event.device.id === guideOutput.id) {
				if (event.property === 'connected') {
					if (!event.device.connected && event.state === 'Alert') {
						toast({ title: 'GUIDE OUTPUT', description: `Failed to connect to guide output ${guideOutput.name}`, color: 'danger' })
					}

					state.guideOutput.connecting = false
				}
			}
		})

		unsubscribers[1] = initProxy(state, `guideoutput.${guideOutput.name}`, ['o:request'])

		return () => {
			unsubscribe(unsubscribers)
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

		return false
	}

	function stop() {
		// Api.GuideOutputs.stop(guideOutput)
	}

	function hide() {
		state.guideOutput.show = false
	}

	return { state, scope, update, connect, pulse, stop, hide } as const
})
