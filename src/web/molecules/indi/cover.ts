import { createScope, molecule, use } from 'bunshi'
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
