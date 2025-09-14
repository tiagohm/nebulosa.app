import { createScope, molecule } from 'bunshi'
import { type Cover, DEFAULT_COVER } from 'src/shared/types'
import { proxy } from 'valtio'
import { Api } from '@/shared/api'
import { type EquipmentDevice, EquipmentMolecule } from './equipment'

export interface CoverScopeValue {
	readonly cover: Cover
}

export interface CoverState {
	readonly cover: EquipmentDevice<Cover>
}

export const CoverScope = createScope<CoverScopeValue>({ cover: DEFAULT_COVER })

const coverStateMap = new Map<string, CoverState>()

export const CoverMolecule = molecule((m, s) => {
	const scope = s(CoverScope)
	const equipment = m(EquipmentMolecule)

	const state =
		coverStateMap.get(scope.cover.name) ??
		proxy<CoverState>({
			cover: equipment.get('COVER', scope.cover.name)!,
		})

	coverStateMap.set(scope.cover.name, state)

	function connect() {
		return equipment.connect(state.cover)
	}

	function park() {
		return Api.Covers.park(scope.cover)
	}

	function unpark() {
		return Api.Covers.unpark(scope.cover)
	}

	function hide() {
		equipment.hide('COVER', scope.cover)
	}

	return { state, scope, connect, park, unpark, hide } as const
})
