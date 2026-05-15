import { createScope, molecule, onMount, use } from 'bunshi'
import { type Cover, DEFAULT_COVER } from 'nebulosa/src/indi.device'
import type { DeepReadonly } from 'nebulosa/src/types'
import bus from 'src/shared/bus'
import type { CoverUpdated } from 'src/shared/types'
import { equipment, type DeviceState } from 'src/web/store/equipment.store'
import { proxy } from 'valtio'
import { Api } from '@/shared/api'
import { toast } from '@/shared/toast'

export interface CoverScopeValue {
	readonly cover: DeepReadonly<Omit<Cover, symbol>>
}

export interface CoverState {
	cover: DeviceState<Cover>
}

export const CoverScope = createScope<CoverScopeValue>({ cover: DEFAULT_COVER })

const stateMap = new Map<string, CoverState>()

export const CoverMolecule = molecule(() => {
	const scope = use(CoverScope)

	const cover = equipment.get('COVER', scope.cover.id)!

	const state =
		stateMap.get(cover.id) ??
		proxy<CoverState>({
			cover,
		})

	stateMap.set(cover.id, state)

	onMount(() => {
		state.cover = equipment.get('COVER', state.cover.id)!

		const unsubscriber = bus.subscribe<CoverUpdated>('cover:update', (event) => {
			if (event.device.id === cover.id) {
				if (event.property === 'connected') {
					if (!event.device.connected && event.state === 'Alert') {
						toast({ title: 'COVER', description: `Failed to connect to cover ${cover.name}`, color: 'danger' })
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

	function stop() {
		return Api.Covers.stop(cover)
	}

	function hide() {
		state.cover.show = false
	}

	return { state, scope, connect, park, unpark, stop, hide } as const
})
