import { Api } from '@shared/api'
import { tppaBus } from '@shared/bus'
import { initProxy } from '@shared/proxy'
import { cameraCaptureStore } from '@stores/camera.capture.store'
import { subscribeToUpdateCameraCaptureStartFromCamera, updateCameraCaptureStartFromCamera } from '@stores/camera.store'
import type { DeviceState } from '@stores/equipment.store'
import { plateSolverStore } from '@stores/plate.solver.store'
import { tppaOverlayStore } from '@stores/tppa.overlay.store'
import type { DockviewPanelApi } from 'dockview-react'
import type { Writable } from 'nebulosa/src/core/types'
import type { Camera, Mount } from 'nebulosa/src/devices/indi/device'
import { unsubscribe } from 'src/shared/util'
import { proxy, ref } from 'valtio'
import { subscribeKey } from 'valtio/utils'
import { DEFAULT_TPPA_START, DEFAULT_TPPA_EVENT } from '#/tppa'
import type { TppaStart, TppaEvent } from '#/tppa'

export type TppaStore = ReturnType<typeof tppaStore>

export interface TppaState {
	running: boolean
	readonly request: Writable<TppaStart>
	camera?: DeviceState<Camera>
	mount?: DeviceState<Mount>
	readonly event: TppaEvent
	readonly overlay: {
		show: boolean
	}
}

export function tppaStore(api: DockviewPanelApi) {
	const { id } = api
	const capture = cameraCaptureStore()
	const solver = plateSolverStore()

	const state = proxy<TppaState>({
		request: {
			...structuredClone(DEFAULT_TPPA_START),
			capture: capture.state,
			solver: solver.state,
		},
		running: false,
		event: structuredClone(DEFAULT_TPPA_EVENT),
		overlay: {
			show: true,
		},
	})

	console.info('tppa created:', id)

	const u: VoidFunction[] = []
	let mounted = false
	let operationId: string | undefined
	let revision = 0

	function mount() {
		if (mounted) return unmount

		console.info('tppa mounted:', id)

		mounted = true

		u[0] = initProxy(state, id, ['o:request', 'o:overlay'])

		u[1] = tppaBus.subscribe('update', (event) => {
			if (state.camera?.id === event.camera && state.mount?.id === event.mount) {
				if (operationId && event.id !== operationId) return
				if (event.state !== 'idle' && (!state.camera.connected || !state.mount.connected)) return
				state.running = event.state !== 'idle'
				const overlay = event.overlay
				delete event.overlay
				Object.assign(state.event, event)
				if (overlay) state.event.overlay = ref(overlay)
				tppaOverlayStore.update(id, state.event, state.overlay.show)
			}
		})

		u[2] = subscribeKey(state, 'camera', (camera) => {
			reset()
			updateTitle()

			if (camera !== undefined) {
				updateCameraCaptureStartFromCamera(camera, state.request.capture)

				u[3]?.()
				u[3] = subscribeToUpdateCameraCaptureStartFromCamera(camera, state.request.capture)
			}
		})

		u[4] = subscribeKey(state, 'mount', updateTitle)

		updateTitle()

		return unmount
	}

	function unmount() {
		if (!mounted) return
		console.info('tppa unmounted:', id)
		unsubscribe(u)
		revision++
		tppaOverlayStore.remove(id)
		mounted = false
	}

	function updateTitle() {
		api.setTitle(state.camera || state.mount ? `TPPA - ${state.camera?.name || 'None'} · ${state.mount?.name || 'None'}` : 'TPPA')
	}

	function reset() {
		invalidateOverlay()
		operationId = undefined
		state.running = false
		Object.assign(state.event, DEFAULT_TPPA_EVENT)
	}

	// Invalidates visual guidance on transport/device loss while allowing the server's terminal cause
	// to arrive. Late progress from the obsolete run cannot make its geometry visible again.
	function invalidateOverlay() {
		revision++
		state.event.overlay = undefined
		tppaOverlayStore.remove(id)
	}

	// Shows or hides this panel's active overlay immediately; preference is persisted by mount.
	function setShowOverlay(value: boolean) {
		state.overlay.show = value
		tppaOverlayStore.setEnabled(id, value)
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

	function updateRefraction<K extends keyof TppaStart['refraction']>(key: K, value: TppaStart['refraction'][K]) {
		state.request.refraction[key] = value
	}

	async function start() {
		if (state.running || !state.camera?.connected || !state.mount?.connected) return

		reset()
		state.running = true
		const attempt = revision

		const started = await Api.TPPA.start(state.camera, state.mount, state.request)
		if (!mounted || revision !== attempt) return
		operationId = started

		if (!operationId) {
			reset()
		} else if (state.event.id === operationId) {
			// Progress can precede the HTTP response; publish the retained snapshot once ownership is known.
			tppaOverlayStore.update(id, state.event, state.overlay.show)
		}
	}

	async function stop() {
		if (!state.running || !operationId) return

		const response = await Api.TPPA.stop(operationId)

		if (response?.ok) {
			reset()
		}
	}

	return {
		state,
		capture,
		solver,
		mount,
		unmount,
		setMoveDuration,
		setShowOverlay,
		setDirection,
		setMaxAttempts,
		setDelayBeforeCapture,
		setCompensateRefraction,
		updateRefraction,
		start,
		stop,
	} as const
}
