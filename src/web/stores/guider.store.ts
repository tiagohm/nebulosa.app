import { Api } from '@shared/api'
import { guiderBus } from '@shared/bus'
import { initProxy } from '@shared/proxy'
import { cameraCaptureStore } from '@stores/camera.capture.store'
import { subscribeToUpdateCameraCaptureStartFromCamera, updateCameraCaptureStartFromCamera } from '@stores/camera.store'
import type { DeviceState } from '@stores/equipment.store'
import type { DockviewPanelApi } from 'dockview-react'
import type { Writable } from 'nebulosa/src/core/types'
import type { Camera, GuideOutput } from 'nebulosa/src/devices/indi/device'
import { unsubscribe } from 'src/shared/util'
import { proxy } from 'valtio'
import { subscribeKey } from 'valtio/utils'
import { DEFAULT_GUIDER_EVENT, DEFAULT_GUIDER_INTERNAL_CONNECT, DEFAULT_GUIDER_REMOTE_CONNECT } from '#/guider'
import type { GuiderClientMode, GuiderEvent, GuiderLocalConnect, GuiderRemoteConnect, GuiderSessionInfo } from '#/guider'

export type GuiderStore = ReturnType<typeof guiderStore>

export interface GuiderState {
	readonly connection: Writable<Omit<GuiderRemoteConnect, 'mode'> & Omit<GuiderLocalConnect, 'mode'> & { mode: GuiderClientMode }>
	camera?: DeviceState<Camera>
	guideOutput?: DeviceState<GuideOutput>
	readonly event: GuiderEvent
	index: number
	connecting: boolean
	pendingCommand?: 'loop' | 'findStar' | 'start' | 'stop' | 'calibrate' | 'clear'
	readonly session: Writable<GuiderSessionInfo>
	readonly connected: boolean
}

export function guiderStore(api: DockviewPanelApi) {
	const { id } = api
	const capture = cameraCaptureStore()

	const state = proxy<GuiderState>({
		connection: {
			...DEFAULT_GUIDER_REMOTE_CONNECT,
			...DEFAULT_GUIDER_INTERNAL_CONNECT,
			mode: 'remote',
			capture: capture.state,
		},
		event: structuredClone(DEFAULT_GUIDER_EVENT),
		index: 0,
		connecting: false,
		pendingCommand: undefined,
		session: {
			id: '',
			mode: 'remote',
			key: '',
			target: '',
			state: 'idle',
			connected: false,
			looping: false,
			running: false,
		},
		get connected() {
			return this.event.state !== 'idle' || this.session?.connected === true
		},
	})

	let mounted = false
	const u: VoidFunction[] = []

	console.info('guider created:', id)

	function mount() {
		if (mounted) return unmount

		console.info('guider mounted:', id)

		mounted = true

		u[0] = initProxy(state, id, ['o:connection', 'o:session'])

		u[1] = guiderBus.subscribe('add', (event) => {
			if (state.session?.id === event.id) {
				Object.assign(state.session, event)
				void loadEvent()
			}
		})

		u[2] = guiderBus.subscribe('update', (event) => {
			if (state.session?.id === event.id) {
				Object.assign(state.event, event)
			}
		})

		u[3] = guiderBus.subscribe('remove', (event) => {
			if (state.session?.id === event.id) {
				Object.assign(state.session, event)
				Object.assign(state.event, structuredClone(DEFAULT_GUIDER_EVENT))
			}
		})

		u[4] = subscribeKey(state.session, 'target', updateTitle)
		u[5] = subscribeKey(state.session, 'connected', updateTitle)

		u[7] = subscribeKey(state, 'camera', (camera) => {
			if (camera !== undefined) {
				updateCameraCaptureStartFromCamera(camera, state.connection.capture)

				u[6]?.()
				u[6] = subscribeToUpdateCameraCaptureStartFromCamera(camera, state.connection.capture)
			}
		})

		void load()

		return unmount
	}

	function unmount() {
		if (!mounted) return
		console.info('guider unmounted:', id)
		unsubscribe(u)
		mounted = false
	}

	function updateTitle() {
		api.setTitle(state.session.connected && state.session.target ? `Guider - ${state.session.target}` : 'Guider')
	}

	async function loadSession() {
		if (state.session?.id) {
			const session = await Api.Guider.get(state.session.id)

			if (session) {
				Object.assign(state.session, session)
			} else {
				state.session.id = ''
				state.session.connected = false
			}
		}
	}

	async function loadEvent() {
		if (state.session) {
			const event = await Api.Guider.event(state.session)

			if (event) {
				Object.assign(state.event, event)
			}
		}
	}

	async function load() {
		await loadSession()
		await loadEvent()
		updateTitle()
	}

	function setConnectionMode(value: GuiderClientMode) {
		state.connection.mode = value
	}

	function setConnectionHost(value: string) {
		state.connection.host = value
	}

	function setConnectionPort(value: number) {
		state.connection.port = value
	}

	function setDitherAmount(value: number) {
		state.connection.dither.amount = value
	}

	function setDitherRaOnly(value: boolean) {
		state.connection.dither.raOnly = value
	}

	function setSettlePixels(value: number) {
		state.connection.dither.settle.pixels = value
	}

	function setSettleTime(value: number) {
		state.connection.dither.settle.time = value
	}

	function setSettleTimeout(value: number) {
		state.connection.dither.settle.timeout = value
	}

	async function connect() {
		if (!state.session?.connected) {
			try {
				if (state.connecting) return

				state.connecting = true
				const connection = { ...state.connection, camera: state.camera?.id ?? '', guideOutput: state.guideOutput?.id ?? '' }

				const result = await Api.Guider.connect(connection)

				if (result?.ok) {
					Object.assign(state.session, result.value)
				}
			} finally {
				state.connecting = false
			}
		} else if (state.session) {
			await Api.Guider.disconnect(state.session)
		}
	}

	async function runCommand(command: NonNullable<GuiderState['pendingCommand']>) {
		try {
			if (state.pendingCommand !== undefined || !state.session) return
			state.pendingCommand = command
			return await Api.Guider[command](state.session)
		} finally {
			state.pendingCommand = undefined
		}
	}

	function clear() {
		state.event.rmsRA = 0
		state.event.rmsDEC = 0
		state.index = 0
		return runCommand('clear')
	}

	function loop() {
		return runCommand('loop')
	}

	function findStar() {
		return runCommand('findStar')
	}

	function start() {
		return runCommand('start')
	}

	function stop() {
		return runCommand('stop')
	}

	function calibrate() {
		return runCommand('calibrate')
	}

	return {
		state,
		capture,
		mount,
		unmount,
		setConnectionMode,
		setConnectionHost,
		setConnectionPort,
		setDitherAmount,
		setDitherRaOnly,
		setSettlePixels,
		setSettleTime,
		setSettleTimeout,
		connect,
		clear,
		loop,
		findStar,
		start,
		stop,
		calibrate,
	} as const
}
