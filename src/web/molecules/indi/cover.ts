import { addToast } from '@heroui/react'
import { createScope, molecule, onMount, use } from 'bunshi'
import { type Cover, DEFAULT_COVER } from 'nebulosa/src/indi.device'
import bus from 'src/shared/bus'
import type { CoverUpdated } from 'src/shared/types'
import type { DeepReadonly } from 'utility-types'
import { proxy } from 'valtio'
import { Api } from '@/shared/api'
import { type EquipmentDevice, EquipmentMolecule } from './equipment'

export interface CoverScopeValue {
	readonly cover: DeepReadonly<Omit<Cover, symbol>>
}

export interface CoverState {
	cover: EquipmentDevice<Cover>
}

export const CoverScope = createScope<CoverScopeValue>({ cover: DEFAULT_COVER })

const stateMap = new Map<string, CoverState>()

export const CoverMolecule = molecule(() => {
	const scope = use(CoverScope)
	const equipment = use(EquipmentMolecule)

	const cover = equipment.get('COVER', scope.cover.name)!

	const state =
		stateMap.get(cover.name) ??
		proxy<CoverState>({
			cover,
		})

	stateMap.set(cover.name, state)

	onMount(() => {
		state.cover = equipment.get('COVER', state.cover.name)!

		const unsubscriber = bus.subscribe<CoverUpdated>('cover:update', (event) => {
			if (event.device.id === cover.id) {
				if (event.property === 'connected') {
					if (!event.device.connected && event.state === 'Alert') {
						addToast({ title: 'COVER', description: `Failed to connect to cover ${cover.name}`, color: 'danger' })
					}

					state.cover.connecting = false
				}
			}
		})

		return () => {
			unsubscriber()
		}
	})

	function connect() {
		return equipment.connect(cover)
	}

	function park() {
		return Api.Covers.park(cover)
	}

	function unpark() {
		return Api.Covers.unpark(cover)
	}

	function hide() {
		equipment.hide('COVER', cover)
	}

	return { state, scope, connect, park, unpark, hide } as const
})
