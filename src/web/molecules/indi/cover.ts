import { createScope, molecule, onMount } from 'bunshi'
import bus from 'src/shared/bus'
import { type Cover, type CoverUpdated, DEFAULT_COVER } from 'src/shared/types'
import { proxy } from 'valtio'
import { Api } from '@/shared/api'
import { EquipmentMolecule } from './equipment'

export interface CoverScopeValue {
	readonly cover: Cover
}

export interface CoverState {
	readonly cover: Cover
	connecting: boolean
}

export const CoverScope = createScope<CoverScopeValue>({ cover: DEFAULT_COVER })

const coverStateMap = new Map<string, CoverState>()

export const CoverMolecule = molecule((m, s) => {
	const scope = s(CoverScope)
	const equipment = m(EquipmentMolecule)

	const state =
		coverStateMap.get(scope.cover.name) ??
		proxy<CoverState>({
			cover: equipment.get('cover', scope.cover.name)!,
			connecting: false,
		})

	coverStateMap.set(scope.cover.name, state)

	Api.Covers.get(scope.cover.name).then((cover) => {
		if (!cover) return
		Object.assign(state.cover, cover)
		state.connecting = false
	})

	onMount(() => {
		const unsubscriber = bus.subscribe<CoverUpdated>('cover:update', (event) => {
			if (event.device.name === state.cover.name) {
				if (event.property === 'connected') {
					state.connecting = false
				}
			}
		})

		return () => {
			unsubscriber()
		}
	})

	async function connect() {
		state.connecting = true

		if (state.cover.connected) {
			await Api.Indi.disconnect(state.cover)
		} else {
			await Api.Indi.connect(state.cover)
		}
	}

	function park() {
		return Api.Covers.park(scope.cover)
	}

	function unpark() {
		return Api.Covers.unpark(scope.cover)
	}

	function hide() {
		equipment.hide('cover', scope.cover)
	}

	return { state, scope, connect, park, unpark, hide } as const
})
