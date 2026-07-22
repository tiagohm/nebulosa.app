import { Api } from '@shared/api'
import { tppaBus } from '@shared/bus'
import { initProxy } from '@shared/proxy'
import { subscribeToUpdateCameraCaptureStartFromCamera } from '@stores/camera.store'
import type { DeviceState } from '@stores/equipment.store'
import type { DockviewPanelApi } from 'dockview-react'
import type { Writable } from 'nebulosa/src/core/types'
import type { Camera, Mount } from 'nebulosa/src/devices/indi/device'
import { DEFAULT_TPPA_EVENT, DEFAULT_TPPA_START, type TppaEvent, type TppaStart } from 'src/shared/types'
import { unsubscribe } from 'src/shared/util'
import { proxy } from 'valtio'
import { subscribeKey } from 'valtio/utils'

export type TppaStore = ReturnType<typeof tppaStore>

export interface TppaState {
	running: boolean
	readonly request: Writable<TppaStart>
	camera?: DeviceState<Camera>
	mount?: DeviceState<Mount>
	readonly event: TppaEvent
}

export function tppaStore(id: string, api: DockviewPanelApi) {
	const state = proxy<TppaState>({
		request: structuredClone(DEFAULT_TPPA_START),
		running: false,
		event: structuredClone(DEFAULT_TPPA_EVENT),
	})

	console.info('tppa created:', id)

	const u: VoidFunction[] = []
	let mounted = false

	function _mount() {
		if (mounted) return

		console.info('tppa mounted:', id)

		mounted = true

		u[0] = initProxy(state, `tppa.${id}`, ['o:request'])

		u[1] = tppaBus.subscribe('update', (event) => {
			if (state.camera?.id === event.camera && state.mount?.id === event.mount) {
				state.running = event.state !== 'idle'
				Object.assign(state.event, event)
			}
		})

		u[2] = subscribeKey(state, 'camera', (camera) => {
			updateTitle()

			if (camera !== undefined) {
				u[3]?.()
				u[3] = subscribeToUpdateCameraCaptureStartFromCamera(camera, state.request.capture)
			}
		})

		u[4] = subscribeKey(state, 'mount', updateTitle)

		updateTitle()

		state.request.id = id
	}

	function unmount() {
		if (!mounted) return
		console.info('tppa unmounted:', id)
		unsubscribe(u)
		mounted = false
	}

	function updateTitle() {
		api.setTitle(state.camera || state.mount ? `TPPA - ${state.camera?.name || 'None'} · ${state.mount?.name || 'None'}` : 'TPPA')
	}

	function reset() {
		state.running = false
		Object.assign(state.event, DEFAULT_TPPA_EVENT)
	}

	function setMoveDuration(value: number) {
		state.request.moveDuration = value
	}

	function setDirection(value: 'east' | 'west') {
		state.request.direction = value
	}

	function setMaxAttempts(value: number) {
		state.request.maxAttempts = value
	}

	function setDelayBeforeCapture(value: number) {
		state.request.delayBeforeCapture = value
	}

	function setCompensateRefraction(value: boolean) {
		state.request.compensateRefraction = value
	}

	function setSolverRadius(value: number) {
		state.request.solver.radius = value
	}

	function setSolverFocalLength(value: number) {
		state.request.solver.focalLength = value
	}

	function setSolverPixelSize(value: number) {
		state.request.solver.pixelSize = value
	}

	function updateSolver<K extends keyof TppaStart['solver']>(key: K, value: TppaStart['solver'][K]) {
		state.request.solver[key] = value
	}

	function updateCapture<K extends keyof TppaStart['capture']>(key: K, value: TppaStart['capture'][K]) {
		state.request.capture[key] = value
	}

	function updateRefraction<K extends keyof TppaStart['refraction']>(key: K, value: TppaStart['refraction'][K]) {
		state.request.refraction[key] = value
	}

	async function start() {
		if (state.running || !state.camera?.connected || !state.mount?.connected) return

		state.running = true

		const response = await Api.TPPA.start(state.camera, state.mount, state.request)

		if (!response?.ok) {
			reset()
		}
	}

	async function stop() {
		if (!state.running) return

		const response = await Api.TPPA.stop(state.request.id)

		if (response?.ok) {
			reset()
		}
	}

	return {
		state,
		mount: _mount,
		unmount,
		setMoveDuration,
		setDirection,
		setMaxAttempts,
		setDelayBeforeCapture,
		setCompensateRefraction,
		setSolverRadius,
		setSolverFocalLength,
		setSolverPixelSize,
		updateSolver,
		updateCapture,
		updateRefraction,
		start,
		stop,
	} as const
}
