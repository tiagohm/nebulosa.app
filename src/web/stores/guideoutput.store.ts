import type { GuideOutput } from 'nebulosa/src/devices/indi/device'
import type { GuidePulse } from 'src/shared/types'
import { unsubscribe } from 'src/shared/util'
import { proxy } from 'valtio'
import { Api } from '../shared/api'
import { initProxy } from '../shared/proxy'
import type { NudgeDirection } from '../ui/Nudge'
import { equipmentStore, type DeviceState } from './equipment.store'

export type GuideOutputStore = ReturnType<typeof guideOutputStore>

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

export function guideOutputStore(guideOutput: GuideOutput) {
	const state = proxy<GuideOutputState>({
		guideOutput,
		request: structuredClone(DEFAULT_GUIDE_OUTPUT_REQUEST),
	})

	console.info('guide output created:', guideOutput.name)

	const u: VoidFunction[] = []
	let mounted = false

	function mount() {
		if (mounted) return

		console.info('guide output mounted:', guideOutput.name)

		mounted = true

		u[0] = initProxy(state, `guideoutput.${guideOutput.id}`, ['o:request'])
	}

	function unmount() {
		if (!mounted) return
		console.info('guide output unmounted:', guideOutput.name)
		unsubscribe(u)
		mounted = false
	}

	function update(direction: Lowercase<GuidePulse['direction']>, value: number) {
		state.request[direction].duration = value
	}

	function connect() {
		return equipmentStore.connect(guideOutput)
	}

	function guideRateRA(rightAscension: number) {
		return Api.GuideOutputs.guideRate(guideOutput, { ...guideOutput.guideRate, rightAscension })
	}

	function guideRateDEC(declination: number) {
		return Api.GuideOutputs.guideRate(guideOutput, { ...guideOutput.guideRate, declination })
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

	function show() {
		return equipmentStore.show(guideOutput, 'guideOutput')
	}

	function hide() {
		return equipmentStore.hide(guideOutput, 'guideOutput')
	}

	return {
		state,
		mount,
		unmount,
		update,
		connect,
		guideRateRA,
		guideRateDEC,
		pulse,
		stop,
		show,
		hide,
	} as const
}
