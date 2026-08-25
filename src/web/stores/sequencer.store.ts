import { Api } from '@shared/api'
import { cameraBus, coverBus, flatPanelBus, focuserBus, mountBus, rotatorBus, wheelBus } from '@shared/bus'
import { initProxy } from '@shared/proxy'
import { toast } from '@shared/toast'
import { subscribeToUpdateCameraCaptureStartFromCamera, updateCameraCaptureStartFromCamera } from '@stores/camera.store'
import type { DeviceState, EquipmentState } from '@stores/equipment.store'
import { equipmentStore } from '@stores/equipment.store'
import { plateSolverStore } from '@stores/plate.solver.store'
import type { DockviewPanelApi } from 'dockview-react'
import { nanoid } from 'nanoid'
import type { DeepWritable } from 'nebulosa/src/core/types'
import type { Camera, Cover, Dome, FlatPanel, Focuser, GuideOutput, Mount, MountTargetCoordinateType, Rotator, Wheel } from 'nebulosa/src/devices/indi/device'
import { guideOutputBus } from 'src/api/guideoutput'
import { unsubscribe } from 'src/shared/util'
import { proxy, subscribe } from 'valtio'
import { subscribeKey } from 'valtio/utils'
import { DEFAULT_COORDINATE_INFO } from '#/mount'
import type { CoordinateInfo } from '#/mount'
import { DEFAULT_SEQUENCER, DEFAULT_SEQUENCER_AUXILIARY_CAPTURE, DEFAULT_SEQUENCER_RETRY_POLICY } from '#/sequencer'
import type { Sequencer, SequencerAuxiliaryCapture, SequencerCamera, SequencerEndCondition, SequencerFilterReference, SequencerFrame, SequencerGuiderConnection, SequencerGuiderSettle, SequencerMonitor, SequencerMonitorBase, SequencerRetryPolicy, SequencerSafetyAction, SequencerStartCondition } from '#/sequencer'
import type { SequencerPreflight } from '#/sequencer.plan'
import { isSequencerTerminalState } from '#/sequencer.state'
import type { SequencerSessionSnapshot } from '#/sequencer.state'

export type SequencerStore = ReturnType<typeof sequencerStore>

export type SequencerPendingCommand = 'start' | 'stop' | 'pause' | 'resume'

export interface SequencerState {
	readonly request: DeepWritable<Sequencer>
	busy: boolean
	pendingCommand?: SequencerPendingCommand
	session?: SequencerSessionSnapshot
	preflight?: SequencerPreflight
	camera?: DeviceState<Camera>
	mount?: DeviceState<Mount>
	wheel?: DeviceState<Wheel>
	focuser?: DeviceState<Focuser>
	rotator?: DeviceState<Rotator>
	guideCamera?: DeviceState<Camera>
	guideOutput?: DeviceState<GuideOutput>
	cover?: DeviceState<Cover>
	flatPanel?: DeviceState<FlatPanel>
	dome?: DeviceState<Dome>
	readonly target: {
		readonly position: CoordinateInfo
	}
}

const SNAPSHOT_INTERVAL = 1000
const VALIDATE_DELAY = 400
const TARGET_POSITION_INTERVAL = 5000

export function sequencerStore(api: DockviewPanelApi) {
	const { id } = api

	const request = structuredClone(DEFAULT_SEQUENCER) as DeepWritable<Sequencer>

	const targetCenteringSolver = plateSolverStore()

	const state = proxy<SequencerState>({
		request,
		busy: false,
		target: {
			position: structuredClone(DEFAULT_COORDINATE_INFO),
		},
	})

	const u: VoidFunction[] = []
	const frameUnsubscribers: VoidFunction[] = []
	let mounted = false
	let validateTimer: number | undefined
	let positionTimer: number | undefined
	let snapshotTimer: number | undefined

	function mount() {
		if (mounted) return unmount

		console.info('sequencer mounted:', id)

		mounted = true

		u[0] = initProxy(state, id, ['o:request'])

		state.request.target.id ||= nanoid()
		state.request.target.center.solver = targetCenteringSolver.state

		if (request.capture.frames.length === 0) addFrame()

		u[1] = subscribe(state.request, scheduleValidate)
		u[2] = subscribeKey(state, 'mount', updateTitle)
		u[3] = subscribeKey(state, 'camera', () => {
			updateTitle()
			bindCameraCaptures()
		})

		hydrateDevices()
		updateTitle()
		bindCameraCaptures()
		startTargetPositionUpdate()
		void updateTargetPosition()
		void validate()

		const buses = [cameraBus, mountBus, focuserBus, wheelBus, rotatorBus, guideOutputBus, coverBus, flatPanelBus]

		for (let i = 0, p = 5; i < buses.length; i++) {
			u[p++] = cameraBus.subscribe('add', hydrateDevices)
			u[p++] = cameraBus.subscribe('remove', hydrateDevices)
		}

		return unmount
	}

	function unmount() {
		if (!mounted) return

		console.info('sequencer unmounted:', id)
		clearTimeout(validateTimer)
		clearInterval(positionTimer)
		clearInterval(snapshotTimer)
		unsubscribe(u)
		unsubscribe(frameUnsubscribers)
		mounted = false
	}

	function updateTitle() {
		api.setTitle(state.camera || state.mount ? `Sequencer - ${state.camera?.name || 'None'} · ${state.mount?.name || 'None'}` : 'Sequencer')
	}

	function hydrateDevices() {
		const { devices } = state.request
		const camera = findDevice('camera', devices.camera)
		const mount = findDevice('mount', devices.mount)
		const wheel = findDevice('wheel', devices.wheel)
		const focuser = findDevice('focuser', devices.focuser)
		const rotator = findDevice('rotator', devices.rotator)
		const guideCamera = findDevice('camera', devices.guideCamera)
		const guideOutput = findDevice('guideOutput', devices.guideOutput)
		const cover = findDevice('cover', devices.cover)
		const flatPanel = findDevice('flatPanel', devices.flatPanel)
		const dome = findDevice('dome', devices.dome)

		if (state.camera !== camera) state.camera = camera
		if (state.mount !== mount) state.mount = mount
		if (state.wheel !== wheel) state.wheel = wheel
		if (state.focuser !== focuser) state.focuser = focuser
		if (state.rotator !== rotator) state.rotator = rotator
		if (state.guideCamera !== guideCamera) state.guideCamera = guideCamera
		if (state.guideOutput !== guideOutput) state.guideOutput = guideOutput
		if (state.cover !== cover) state.cover = cover
		if (state.flatPanel !== flatPanel) state.flatPanel = flatPanel
		if (state.dome !== dome) state.dome = dome
	}

	function scheduleValidate() {
		clearTimeout(validateTimer)
		validateTimer = window.setTimeout(validate, VALIDATE_DELAY)
	}

	function startTargetPositionUpdate() {
		clearTimeout(positionTimer)
		positionTimer = window.setInterval(updateTargetPosition, TARGET_POSITION_INTERVAL)
	}

	function startSnapshotLoop() {
		clearInterval(snapshotTimer)
		snapshotTimer = window.setInterval(refreshSession, SNAPSHOT_INTERVAL)
	}

	function stopSnapshotLoop() {
		clearInterval(snapshotTimer)
		snapshotTimer = undefined
	}

	function applySession(session: SequencerSessionSnapshot | undefined) {
		state.session = session
		state.busy = session !== undefined && !isSequencerTerminalState(session.state)
		if (!state.busy) stopSnapshotLoop()
	}

	async function validate() {
		const preflight = await Api.Sequencer.validate(state.request)
		if (preflight !== undefined) state.preflight = preflight
		return preflight
	}

	async function refreshSession() {
		const sessionId = state.session?.id
		if (sessionId === undefined) return

		const session = await Api.Sequencer.snapshot(sessionId)
		if (session !== undefined) applySession(session)
	}

	async function updateTargetPosition() {
		const { mount } = state

		if (mount?.connected) {
			const position = await Api.Mounts.targetPosition(mount, state.request.target)
			position && Object.assign(state.target.position, position)
		}
	}

	function setName(value: string) {
		state.request.name = value
	}

	function setTargetName(value: string) {
		state.request.target.name = value
	}

	function setTargetCoordinateType(value: MountTargetCoordinateType) {
		state.request.target.type = value
	}

	function setTargetCoordinateX(value: string) {
		state.request.target[state.request.target.type]!.x = value
	}

	function setTargetCoordinateY(value: string) {
		state.request.target[state.request.target.type]!.y = value
	}

	function setTargetTimeout(value: number) {
		state.request.target.timeout = value
	}

	function setTargetSettle(value: number) {
		state.request.target.settle = value
	}

	function setCamera(value?: DeviceState<Camera>) {
		state.camera = value
		state.request.devices.camera = value?.id ?? ''
	}

	function setMount(value?: DeviceState<Mount>) {
		state.mount = value
		state.request.devices.mount = value?.id
	}

	function setWheel(value?: DeviceState<Wheel>) {
		state.wheel = value
		state.request.devices.wheel = value?.id
	}

	function setFocuser(value?: DeviceState<Focuser>) {
		state.focuser = value
		state.request.devices.focuser = value?.id
	}

	function setRotator(value?: DeviceState<Rotator>) {
		state.rotator = value
		state.request.devices.rotator = value?.id
	}

	function setGuideCamera(value?: DeviceState<Camera>) {
		state.guideCamera = value
		state.request.devices.guideCamera = value?.id
	}

	function setGuideOutput(value?: DeviceState<GuideOutput>) {
		state.guideOutput = value
		state.request.devices.guideOutput = value?.id
	}

	function setCover(value?: DeviceState<Cover>) {
		state.cover = value
		state.request.devices.cover = value?.id
	}

	function setFlatPanel(value?: DeviceState<FlatPanel>) {
		state.flatPanel = value
		state.request.devices.flatPanel = value?.id
	}

	function setDome(value?: DeviceState<Dome>) {
		state.dome = value
		state.request.devices.dome = value?.id
	}

	// Applies the connected camera's frame, format, and exposure limits to every capture recipe this store
	// owns, and re-subscribes so later device updates keep those recipes inside the live range.
	function bindCameraCaptures() {
		unsubscribe(frameUnsubscribers)
		frameUnsubscribers.length = 0
		unsubscribe(u.slice(4, 5))

		const camera = state.camera

		if (!camera) return

		updateCameraCaptureStartFromCamera(camera, state.request.target.center.capture)
		u[4] = subscribeToUpdateCameraCaptureStartFromCamera(camera, state.request.target.center.capture)

		for (const frame of state.request.capture.frames) {
			updateCameraCaptureStartFromCamera(camera, frame.capture)
			frameUnsubscribers.push(subscribeToUpdateCameraCaptureStartFromCamera(camera, frame.capture))
		}
	}

	function addFrame() {
		const index = state.request.capture.frames.length
		const frame: SequencerFrame = { id: nanoid(), name: `Frame ${index + 1}`, enabled: true, count: 10, weight: 1, capture: structuredClone(DEFAULT_SEQUENCER_AUXILIARY_CAPTURE) }
		state.request.capture.frames.push(frame)
		if (!state.camera) return
		updateCameraCaptureStartFromCamera(state.camera, frame.capture)
		frameUnsubscribers[index] = subscribeToUpdateCameraCaptureStartFromCamera(state.camera, frame.capture)
	}

	function removeFrame(index: number) {
		frameUnsubscribers[index]?.()
		frameUnsubscribers.splice(index, 1)
		state.request.capture.frames.splice(index, 1)
	}

	function moveFrame(index: number, offset: number) {
		const frames = state.request.capture.frames
		const next = index + offset

		if (next < 0 || next >= frames.length) return

		const [frame] = frames.splice(index, 1)
		frames.splice(next, 0, frame)
		const [unsubscriber] = frameUnsubscribers.splice(index, 1)
		frameUnsubscribers.splice(next, 0, unsubscriber)
	}

	function updateFrame<K extends keyof SequencerFrame>(index: number, key: K, value: SequencerFrame[K]) {
		const frame = state.request.capture.frames[index]
		if (frame === undefined) return
		frame[key] = value as never
	}

	function updateFrameCapture<K extends keyof SequencerFrame['capture']>(index: number, key: K, value: SequencerFrame['capture'][K]) {
		const frame = state.request.capture.frames[index]
		if (frame === undefined) return
		frame.capture[key] = value
	}

	function updateFrameFilter(index: number, value: SequencerFilterReference | undefined) {
		const frame = state.request.capture.frames[index]
		if (frame === undefined) return
		frame.capture.filter = value
	}

	function setGuidingConnectionMode(mode: SequencerGuiderConnection['mode']) {
		if (mode === 'remote') {
			state.request.guiding.connection = { mode: 'remote', host: '127.0.0.1', port: 4400 }
			return
		}

		const { filter: _, ...capture } = structuredClone(DEFAULT_SEQUENCER_AUXILIARY_CAPTURE)
		state.request.guiding.connection = { mode: 'local', focalLength: 200, capture }
	}

	function setGuidingRemoteHost(value: string) {
		const connection = state.request.guiding.connection
		if (connection.mode === 'remote') connection.host = value
	}

	function setGuidingRemotePort(value: number) {
		const connection = state.request.guiding.connection
		if (connection.mode === 'remote') connection.port = value
	}

	function setGuidingRemoteProfile(value: string) {
		const connection = state.request.guiding.connection
		if (connection.mode === 'remote') connection.profile = value || undefined
	}

	function setGuidingLocalFocalLength(value: number) {
		const connection = state.request.guiding.connection
		if (connection.mode === 'local') connection.focalLength = value
	}

	function setGuidingLocalPixelSize(value: number) {
		const connection = state.request.guiding.connection
		if (connection.mode === 'local') connection.pixelSize = value || undefined
	}

	function addFilterOffset() {
		state.request.autofocus.filterOffsets.push({ filter: { type: 'name', name: '' }, offset: 0 })
	}

	function removeFilterOffset(index: number) {
		state.request.autofocus.filterOffsets.splice(index, 1)
	}

	function updateFilterOffsetFilter(index: number, value: SequencerFilterReference | undefined) {
		const item = state.request.autofocus.filterOffsets[index]
		if (item === undefined || value === undefined) return
		item.filter = value
	}

	function updateFilterOffset(index: number, offset: number) {
		const item = state.request.autofocus.filterOffsets[index]
		if (item === undefined) return
		item.offset = offset
	}

	function addFilterBrightness() {
		state.request.flatPanel.brightnessByFilter.push({ filter: { type: 'name', name: '' }, brightness: state.request.flatPanel.brightness })
	}

	function removeFilterBrightness(index: number) {
		state.request.flatPanel.brightnessByFilter.splice(index, 1)
	}

	function updateFilterBrightnessFilter(index: number, value: SequencerFilterReference | undefined) {
		const item = state.request.flatPanel.brightnessByFilter[index]
		if (item === undefined || value === undefined) return
		item.filter = value
	}

	function updateFilterBrightness(index: number, brightness: number) {
		const item = state.request.flatPanel.brightnessByFilter[index]
		if (item === undefined) return
		item.brightness = brightness
	}

	function addMonitor() {
		state.request.monitoring.monitors.push(createMonitor('weather') as DeepWritable<SequencerMonitor>)
	}

	function removeMonitor(index: number) {
		state.request.monitoring.monitors.splice(index, 1)
	}

	function setMonitorType(index: number, type: SequencerMonitor['type']) {
		const current = state.request.monitoring.monitors[index]
		if (current === undefined || current.type === type) return
		state.request.monitoring.monitors[index] = createMonitor(type, current) as DeepWritable<SequencerMonitor>
	}

	function addSafetyAction() {
		state.request.safety.actions.push(createSafetyAction('abortCapture') as DeepWritable<SequencerSafetyAction>)
	}

	function removeSafetyAction(index: number) {
		state.request.safety.actions.splice(index, 1)
	}

	function setSafetyActionType(index: number, type: SequencerSafetyAction['type']) {
		const current = state.request.safety.actions[index]
		if (current === undefined || current.type === type) return
		state.request.safety.actions[index] = createSafetyAction(type, current) as DeepWritable<SequencerSafetyAction>
	}

	function setStartConditionType(type: SequencerStartCondition['type']) {
		state.request.execution.start = startCondition(type, state.request.execution.start)
	}

	function setEndConditionType(type: SequencerEndCondition['type']) {
		state.request.execution.end = endCondition(type, state.request.execution.end)
	}

	function setTargetTrackingEnabled(value: boolean) {
		state.request.target.tracking.enabled = value
	}

	function setTargetTrackingMode(value: Sequencer['target']['tracking']['mode']) {
		state.request.target.tracking.mode = value
	}

	function setTargetTrackingStopOnShutdown(value: boolean) {
		state.request.target.tracking.stopOnShutdown = value
	}

	function setTargetCenterEnabled(value: boolean) {
		state.request.target.center.enabled = value
	}

	function setTargetCenterSolverType(value: Sequencer['target']['center']['solver']['type']) {
		state.request.target.center.solver.type = value
	}

	function setTargetCenterTolerance(value: number) {
		state.request.target.center.tolerance = value
	}

	function setTargetCenterMaximumAttempts(value: number) {
		state.request.target.center.maximumAttempts = value
	}

	function setTargetCenterSettle(value: number) {
		state.request.target.center.settle = value
	}

	function setTargetCenterSyncMount(value: boolean) {
		state.request.target.center.syncMount = value
	}

	function setTargetConstraintsEnabled(value: boolean) {
		state.request.target.constraints.enabled = value
	}

	function setTargetConstraintsOnViolation(value: Sequencer['target']['constraints']['onViolation']) {
		state.request.target.constraints.onViolation = value
	}

	function setTargetConstraintsStableFor(value: number) {
		state.request.target.constraints.stableFor = value
	}

	function setTargetConstraintsMinimumAltitude(value: number | undefined) {
		state.request.target.constraints.minimumAltitude = value
	}

	function setTargetConstraintsMaximumAltitude(value: number | undefined) {
		state.request.target.constraints.maximumAltitude = value
	}

	function setTargetConstraintsMaximumAirmass(value: number | undefined) {
		state.request.target.constraints.maximumAirmass = value
	}

	function setTargetConstraintsMinimumMoonDistance(value: number | undefined) {
		state.request.target.constraints.minimumMoonDistance = value
	}

	function setTargetConstraintsMaximumMoonIllumination(value: number | undefined) {
		state.request.target.constraints.maximumMoonIllumination = value
	}

	function setTargetConstraintsMinimumHourAngle(value: number | undefined) {
		state.request.target.constraints.minimumHourAngle = value
	}

	function setTargetConstraintsMaximumHourAngle(value: number | undefined) {
		state.request.target.constraints.maximumHourAngle = value
	}

	function setTargetConstraintsWindowEnabled(value: boolean) {
		state.request.target.constraints.window.enabled = value
	}

	function setTargetConstraintsWindowStart(value: number | undefined) {
		state.request.target.constraints.window.start = value
	}

	function setTargetConstraintsWindowEnd(value: number | undefined) {
		state.request.target.constraints.window.end = value
	}

	function setTargetConstraintsWindowMaximumSunAltitude(value: number | undefined) {
		state.request.target.constraints.window.maximumSunAltitude = value
	}

	function setCaptureOrder(value: Sequencer['capture']['order']) {
		state.request.capture.order = value
	}

	function setCaptureRepeat(value: number) {
		state.request.capture.repeat = value
	}

	function setCaptureDelay(value: number) {
		state.request.capture.delay = value
	}

	function setCaptureContinueAfterRejectedFrame(value: boolean) {
		state.request.capture.continueAfterRejectedFrame = value
	}

	function setGuidingEnabled(value: boolean) {
		state.request.guiding.enabled = value
	}

	function setGuidingCalibrateBeforeStart(value: boolean) {
		state.request.guiding.calibrateBeforeStart = value
	}

	function setGuidingRecalibrateAfterMeridianFlip(value: boolean) {
		state.request.guiding.recalibrateAfterMeridianFlip = value
	}

	function setGuidingRestoreAfterInterruption(value: boolean) {
		state.request.guiding.restoreAfterInterruption = value
	}

	function setGuidingStopOnShutdown(value: boolean) {
		state.request.guiding.stopOnShutdown = value
	}

	function setGuidingThresholdsEnabled(value: boolean) {
		state.request.guiding.thresholds.enabled = value
	}

	function setGuidingThresholdsPauseCaptureWhenExceeded(value: boolean) {
		state.request.guiding.thresholds.pauseCaptureWhenExceeded = value
	}

	function setGuidingThresholdsMaximumRMS(value: number | undefined) {
		state.request.guiding.thresholds.maximumRMS = value
	}

	function setGuidingThresholdsMaximumRightAscensionRMS(value: number | undefined) {
		state.request.guiding.thresholds.maximumRightAscensionRMS = value
	}

	function setGuidingThresholdsMaximumDeclinationRMS(value: number | undefined) {
		state.request.guiding.thresholds.maximumDeclinationRMS = value
	}

	function setGuidingThresholdsMinimumSNR(value: number | undefined) {
		state.request.guiding.thresholds.minimumSNR = value
	}

	function setGuidingThresholdsMinimumStarMass(value: number | undefined) {
		state.request.guiding.thresholds.minimumStarMass = value
	}

	function setGuidingThresholdsMaximumLostStarTime(value: number | undefined) {
		state.request.guiding.thresholds.maximumLostStarTime = value
	}

	function setGuidingRecoveryEnabled(value: boolean) {
		state.request.guiding.recovery.enabled = value
	}

	function setGuidingRecoveryMaximumAttempts(value: number) {
		state.request.guiding.recovery.maximumAttempts = value
	}

	function setGuidingRecoveryOnFailure(value: Sequencer['guiding']['recovery']['onFailure']) {
		state.request.guiding.recovery.onFailure = value
	}

	function setGuidingRecoveryStopBeforeRetry(value: boolean) {
		state.request.guiding.recovery.stopBeforeRetry = value
	}

	function setGuidingRecoveryFindStarBeforeRetry(value: boolean) {
		state.request.guiding.recovery.findStarBeforeRetry = value
	}

	function setGuidingRecoveryRecalibrate(value: boolean) {
		state.request.guiding.recovery.recalibrate = value
	}

	function setDitherEnabled(value: boolean) {
		state.request.dither.enabled = value
	}

	function setDitherAmount(value: number) {
		state.request.dither.amount = value
	}

	function setDitherEveryFrames(value: number) {
		state.request.dither.everyFrames = value
	}

	function setDitherEveryTime(value: number) {
		state.request.dither.everyTime = value
	}

	function setDitherRaOnly(value: boolean) {
		state.request.dither.raOnly = value
	}

	function setDitherBeforeFirstFrame(value: boolean) {
		state.request.dither.beforeFirstFrame = value
	}

	function setDitherAfterFilterChange(value: boolean) {
		state.request.dither.afterFilterChange = value
	}

	function setDitherOnFailure(value: Sequencer['dither']['onFailure']) {
		state.request.dither.onFailure = value
	}

	function setAutofocusEnabled(value: boolean) {
		state.request.autofocus.enabled = value
	}

	function setAutofocusTriggersOnStart(value: boolean) {
		state.request.autofocus.triggers.onStart = value
	}

	function setAutofocusTriggersOnFilterChange(value: boolean) {
		state.request.autofocus.triggers.onFilterChange = value
	}

	function setAutofocusTriggersAfterMeridianFlip(value: boolean) {
		state.request.autofocus.triggers.afterMeridianFlip = value
	}

	function setAutofocusTriggersEveryFrames(value: number) {
		state.request.autofocus.triggers.everyFrames = value
	}

	function setAutofocusTriggersEveryTime(value: number) {
		state.request.autofocus.triggers.everyTime = value
	}

	function setAutofocusTriggersTemperatureChange(value: number) {
		state.request.autofocus.triggers.temperatureChange = value
	}

	function setAutofocusTriggersMinimumTimeBetweenRuns(value: number) {
		state.request.autofocus.triggers.minimumTimeBetweenRuns = value
	}

	function setAutofocusAlgorithmInitialOffsetSteps(value: number) {
		state.request.autofocus.algorithm.initialOffsetSteps = value
	}

	function setAutofocusAlgorithmStepSize(value: number) {
		state.request.autofocus.algorithm.stepSize = value
	}

	function setAutofocusAlgorithmFittingMode(value: Sequencer['autofocus']['algorithm']['fittingMode']) {
		state.request.autofocus.algorithm.fittingMode = value
	}

	function setAutofocusAlgorithmRmsdThreshold(value: number) {
		state.request.autofocus.algorithm.rmsdThreshold = value
	}

	function setAutofocusAlgorithmMaximumPosition(value: number) {
		state.request.autofocus.algorithm.maximumPosition = value
	}

	function setAutofocusAlgorithmReversed(value: boolean) {
		state.request.autofocus.algorithm.reversed = value
	}

	function setAutofocusAlgorithmBacklashEnabled(value: boolean) {
		state.request.autofocus.algorithm.backlash.enabled = value
	}

	function setAutofocusAlgorithmBacklashMode(value: Sequencer['autofocus']['algorithm']['backlash']['mode']) {
		state.request.autofocus.algorithm.backlash.mode = value
	}

	function setAutofocusAlgorithmBacklashSteps(value: number) {
		state.request.autofocus.algorithm.backlash.steps = value
	}

	function setAutofocusStarDetectionType(value: Sequencer['autofocus']['starDetection']['type']) {
		state.request.autofocus.starDetection.type = value
	}

	function setAutofocusStarDetectionTimeout(value: number) {
		state.request.autofocus.starDetection.timeout = value
	}

	function setAutofocusStarDetectionMinimumSNR(value: number) {
		state.request.autofocus.starDetection.minimumSNR = value
	}

	function setAutofocusStarDetectionMaximumStars(value: number) {
		state.request.autofocus.starDetection.maximumStars = value
	}

	function setAutofocusSettle(value: number) {
		state.request.autofocus.settle = value
	}

	function setAutofocusOnFailure(value: Sequencer['autofocus']['onFailure']) {
		state.request.autofocus.onFailure = value
	}

	function setRotatorEnabled(value: boolean) {
		state.request.rotator.enabled = value
	}

	function setRotatorAngle(value: number) {
		state.request.rotator.angle = value
	}

	function setRotatorTolerance(value: number) {
		state.request.rotator.tolerance = value
	}

	function setRotatorSettle(value: number) {
		state.request.rotator.settle = value
	}

	function setRotatorMoveBeforeCentering(value: boolean) {
		state.request.rotator.moveBeforeCentering = value
	}

	function setRotatorRestoreAfterMeridianFlip(value: boolean) {
		state.request.rotator.restoreAfterMeridianFlip = value
	}

	function setRotatorReverse(value: boolean) {
		state.request.rotator.reverse = value
	}

	function setMeridianFlipEnabled(value: boolean) {
		state.request.meridianFlip.enabled = value
	}

	function setMeridianFlipMinimumHourAngle(value: number) {
		state.request.meridianFlip.minimumHourAngle = value
	}

	function setMeridianFlipMaximumHourAngle(value: number) {
		state.request.meridianFlip.maximumHourAngle = value
	}

	function setMeridianFlipSafetyMargin(value: number) {
		state.request.meridianFlip.safetyMargin = value
	}

	function setMeridianFlipSettle(value: number) {
		state.request.meridianFlip.settle = value
	}

	function setMeridianFlipTimeout(value: number) {
		state.request.meridianFlip.timeout = value
	}

	function setMeridianFlipOnFailure(value: Sequencer['meridianFlip']['onFailure']) {
		state.request.meridianFlip.onFailure = value
	}

	function setMountEnabled(value: boolean) {
		state.request.mount.enabled = value
	}

	function setMountUnparkOnStartup(value: boolean) {
		state.request.mount.unparkOnStartup = value
	}

	function setMountParkOnShutdown(value: boolean) {
		state.request.mount.parkOnShutdown = value
	}

	function setMountTimeout(value: number) {
		state.request.mount.timeout = value
	}

	function setCoolingEnabled(value: boolean) {
		state.request.cooling.enabled = value
	}

	function setCoolingTemperature(value: number) {
		state.request.cooling.temperature = value
	}

	function setCoolingTolerance(value: number) {
		state.request.cooling.tolerance = value
	}

	function setCoolingRamp(value: number) {
		state.request.cooling.ramp = value
	}

	function setCoolingWaitForTarget(value: boolean) {
		state.request.cooling.waitForTarget = value
	}

	function setCoolingTimeout(value: number) {
		state.request.cooling.timeout = value
	}

	function setCoolingWarmTemperature(value: number) {
		state.request.cooling.warmTemperature = value
	}

	function setCoolingWarmRamp(value: number) {
		state.request.cooling.warmRamp = value
	}

	function setCoolingTurnCoolerOffAfterWarm(value: boolean) {
		state.request.cooling.turnCoolerOffAfterWarm = value
	}

	function setCoolingWarmOnShutdown(value: boolean) {
		state.request.cooling.warmOnShutdown = value
	}

	function setDomeEnabled(value: boolean) {
		state.request.dome.enabled = value
	}

	function setDomeUnparkOnStartup(value: boolean) {
		state.request.dome.unparkOnStartup = value
	}

	function setDomeOpenOnStartup(value: boolean) {
		state.request.dome.openOnStartup = value
	}

	function setDomeParkOnShutdown(value: boolean) {
		state.request.dome.parkOnShutdown = value
	}

	function setDomeCloseOnShutdown(value: boolean) {
		state.request.dome.closeOnShutdown = value
	}

	function setDomeCloseOnUnsafe(value: boolean) {
		state.request.dome.closeOnUnsafe = value
	}

	function setDomeSlaving(value: boolean) {
		state.request.dome.slaving = value
	}

	function setDomeSynchronizeBeforeCapture(value: boolean) {
		state.request.dome.synchronizeBeforeCapture = value
	}

	function setDomeSettle(value: number) {
		state.request.dome.settle = value
	}

	function setDomeTimeout(value: number) {
		state.request.dome.timeout = value
	}

	function setDomeOnFailure(value: Sequencer['dome']['onFailure']) {
		state.request.dome.onFailure = value
	}

	function setCoverEnabled(value: boolean) {
		state.request.cover.enabled = value
	}

	function setCoverOpenOnStartup(value: boolean) {
		state.request.cover.openOnStartup = value
	}

	function setCoverCloseOnShutdown(value: boolean) {
		state.request.cover.closeOnShutdown = value
	}

	function setCoverCloseOnUnsafe(value: boolean) {
		state.request.cover.closeOnUnsafe = value
	}

	function setCoverOpenBeforeCapture(value: boolean) {
		state.request.cover.openBeforeCapture = value
	}

	function setCoverCloseForDarkFrames(value: boolean) {
		state.request.cover.closeForDarkFrames = value
	}

	function setCoverTimeout(value: number) {
		state.request.cover.timeout = value
	}

	function setFlatPanelEnabled(value: boolean) {
		state.request.flatPanel.enabled = value
	}

	function setFlatPanelBrightness(value: number) {
		state.request.flatPanel.brightness = value
	}

	function setFlatPanelTimeout(value: number) {
		state.request.flatPanel.timeout = value
	}

	function setExecutionPauseMode(value: Sequencer['execution']['pauseMode']) {
		state.request.execution.pauseMode = value
	}

	function setExecutionStopMode(value: Sequencer['execution']['stopMode']) {
		state.request.execution.stopMode = value
	}

	function setExecutionCheckpointAfterEveryAction(value: boolean) {
		state.request.execution.checkpoint.afterEveryAction = value
	}

	function setExecutionCheckpointAfterEveryFrame(value: boolean) {
		state.request.execution.checkpoint.afterEveryFrame = value
	}

	function setExecutionCheckpointAfterEveryArtifact(value: boolean) {
		state.request.execution.checkpoint.afterEveryArtifact = value
	}

	function setExecutionCheckpointInterval(value: number) {
		state.request.execution.checkpoint.interval = value
	}

	function setStorageFileNameTemplate(value: string) {
		state.request.storage.fileNameTemplate = value
	}

	function setStorageDirectoryTemplate(value: string) {
		state.request.storage.directoryTemplate = value
	}

	function setStorageAutoSubFolderMode(value: Sequencer['storage']['autoSubFolderMode']) {
		state.request.storage.autoSubFolderMode = value
	}

	function setStartupEnabled(value: boolean) {
		state.request.startup.enabled = value
	}

	function setStartupContinueOnFailure(value: boolean) {
		state.request.startup.continueOnFailure = value
	}

	function setShutdownEnabled(value: boolean) {
		state.request.shutdown.enabled = value
	}

	function setShutdownRunOnCompletion(value: boolean) {
		state.request.shutdown.runOnCompletion = value
	}

	function setShutdownRunOnStop(value: boolean) {
		state.request.shutdown.runOnStop = value
	}

	function setShutdownRunOnFailure(value: boolean) {
		state.request.shutdown.runOnFailure = value
	}

	function setShutdownContinueOnFailure(value: boolean) {
		state.request.shutdown.continueOnFailure = value
	}

	function setSafetyEnabled(value: boolean) {
		state.request.safety.enabled = value
	}

	function setSafetyTriggerOnWarning(value: boolean) {
		state.request.safety.triggerOnWarning = value
	}

	function setSafetyAbortCurrentExposure(value: boolean) {
		state.request.safety.abortCurrentExposure = value
	}

	function setSafetyRecoveryEnabled(value: boolean) {
		state.request.safety.recovery.enabled = value
	}

	function setSafetyRecoveryAutomatic(value: boolean) {
		state.request.safety.recovery.automatic = value
	}

	function setSafetyRecoveryOnFailure(value: Sequencer['safety']['recovery']['onFailure']) {
		state.request.safety.recovery.onFailure = value
	}

	function setSafetyRecoveryStableFor(value: number) {
		state.request.safety.recovery.stableFor = value
	}

	function setSafetyRecoveryMaximumWait(value: number) {
		state.request.safety.recovery.maximumWait = value
	}

	function setSafetyRecoveryReconnectDevices(value: boolean) {
		state.request.safety.recovery.reconnectDevices = value
	}

	function setSafetyRecoveryUnparkMount(value: boolean) {
		state.request.safety.recovery.unparkMount = value
	}

	function setSafetyRecoveryRestoreTracking(value: boolean) {
		state.request.safety.recovery.restoreTracking = value
	}

	function setSafetyRecoveryResumeCapture(value: boolean) {
		state.request.safety.recovery.resumeCapture = value
	}

	function setQualityEnabled(value: boolean) {
		state.request.quality.enabled = value
	}

	function setQualityStarDetectionType(value: Sequencer['quality']['starDetection']['type']) {
		state.request.quality.starDetection.type = value
	}

	function setQualityStarDetectionTimeout(value: number) {
		state.request.quality.starDetection.timeout = value
	}

	function setQualityStarDetectionMinimumSNR(value: number) {
		state.request.quality.starDetection.minimumSNR = value
	}

	function setQualityStarDetectionMaximumStars(value: number) {
		state.request.quality.starDetection.maximumStars = value
	}

	function setQualityEvaluateEveryFrames(value: number) {
		state.request.quality.evaluateEveryFrames = value
	}

	function setQualityRejectFrame(value: boolean) {
		state.request.quality.rejectFrame = value
	}

	function setQualityMinimumStarCount(value: number | undefined) {
		state.request.quality.minimumStarCount = value
	}

	function setQualityMinimumSNR(value: number | undefined) {
		state.request.quality.minimumSNR = value
	}

	function setQualityMaximumHFD(value: number | undefined) {
		state.request.quality.maximumHFD = value
	}

	function setQualityMaximumFWHM(value: number | undefined) {
		state.request.quality.maximumFWHM = value
	}

	function setQualityMaximumEccentricity(value: number | undefined) {
		state.request.quality.maximumEccentricity = value
	}

	function setQualityMaximumBackground(value: number | undefined) {
		state.request.quality.maximumBackground = value
	}

	function setQualityMaximumBackgroundVariation(value: number | undefined) {
		state.request.quality.maximumBackgroundVariation = value
	}

	function setQualityMaximumSaturation(value: number | undefined) {
		state.request.quality.maximumSaturation = value
	}

	function setMonitoringEnabled(value: boolean) {
		state.request.monitoring.enabled = value
	}

	function setMonitoringInterval(value: number) {
		state.request.monitoring.interval = value
	}

	function setNotificationEnabled(value: boolean) {
		state.request.notification.enabled = value
	}

	function setNotificationMinimumSeverity(value: Sequencer['notification']['minimumSeverity']) {
		state.request.notification.minimumSeverity = value
	}

	function setNotificationEvents(value: Sequencer['notification']['events']) {
		state.request.notification.events = value.slice()
	}

	function setAutofocusStarDetectionExecutable(value: string) {
		state.request.autofocus.starDetection.executable = value || undefined
	}

	function setQualityStarDetectionExecutable(value: string) {
		state.request.quality.starDetection.executable = value || undefined
	}

	function setStorageRoot(value?: string) {
		state.request.storage.root = value ?? ''
	}

	function setStorageTemporaryDirectory(value?: string) {
		state.request.storage.temporaryDirectory = value || undefined
	}

	function setStartAtTime(value: number) {
		state.request.execution.start = { type: 'at', time: value }
	}

	function setEndAtTime(value: number) {
		state.request.execution.end = { type: 'at', time: value }
	}

	function setEndIntegrationTime(value: number) {
		state.request.execution.end = { type: 'integrationTime', time: value }
	}

	function setStartAltitude(value: number) {
		const start = state.request.execution.start
		if (start.type === 'sunAltitude' || start.type === 'targetAltitude') start.altitude = value
	}

	function setStartDirection(value: Extract<SequencerStartCondition, { direction: string }>['direction']) {
		const start = state.request.execution.start
		if (start.type === 'sunAltitude' || start.type === 'targetAltitude') start.direction = value
	}

	function setEndAltitude(value: number) {
		const end = state.request.execution.end
		if (end.type === 'sunAltitude' || end.type === 'targetAltitude') end.altitude = value
	}

	function setEndDirection(value: Extract<SequencerEndCondition, { direction: string }>['direction']) {
		const end = state.request.execution.end
		if (end.type === 'sunAltitude' || end.type === 'targetAltitude') end.direction = value
	}

	function setNotificationChannel(type: 'web' | 'system', enabled: boolean) {
		const channels = state.request.notification.channels.filter((channel) => channel.type !== type)
		if (enabled) channels.push({ type })
		state.request.notification.channels = channels
	}

	function setNotificationWebhook(enabled: boolean) {
		const channels = state.request.notification.channels.filter((channel) => channel.type !== 'webhook')
		const webhook = state.request.notification.channels.find((channel) => channel.type === 'webhook')
		state.request.notification.channels = enabled ? [...channels, { type: 'webhook', url: webhook?.type === 'webhook' ? webhook.url : '', headers: webhook?.type === 'webhook' ? { ...webhook.headers } : {} }] : channels
	}

	function setNotificationWebhookUrl(value: string) {
		const channel = state.request.notification.channels.find((item) => item.type === 'webhook')
		if (channel?.type === 'webhook') channel.url = value
	}

	function updateCamera<K extends keyof SequencerCamera>(camera: DeepWritable<Partial<SequencerCamera>>, key: K, value: SequencerCamera[K]) {
		camera[key] = value
	}

	function updateGuiderSettle<K extends keyof SequencerGuiderSettle>(settle: DeepWritable<SequencerGuiderSettle>, key: K, value: SequencerGuiderSettle[K]) {
		settle[key] = value
	}

	function setMonitorEnabled(index: number, value: boolean) {
		const monitor = state.request.monitoring.monitors[index]
		if (monitor === undefined) return
		monitor.enabled = value
	}

	function setMonitorName(index: number, value: string) {
		const monitor = state.request.monitoring.monitors[index]
		if (monitor === undefined) return
		monitor.name = value
	}

	function setMonitorSeverity(index: number, value: SequencerMonitor['severity']) {
		const monitor = state.request.monitoring.monitors[index]
		if (monitor === undefined) return
		monitor.severity = value
	}

	function setMonitorAssertAfter(index: number, value: number) {
		const monitor = state.request.monitoring.monitors[index]
		if (monitor === undefined) return
		monitor.assertAfter = value
	}

	function setMonitorClearAfter(index: number, value: number) {
		const monitor = state.request.monitoring.monitors[index]
		if (monitor === undefined) return
		monitor.clearAfter = value
	}

	function setMonitorStaleAfter(index: number, value: number) {
		const monitor = state.request.monitoring.monitors[index]
		if (monitor === undefined) return
		monitor.staleAfter = value
	}

	function setMonitorWetIsUnsafe(index: number, value: boolean) {
		const monitor = state.request.monitoring.monitors[index]
		if (monitor === undefined) return
		if (monitor.type === 'rain') monitor.wetIsUnsafe = value
	}

	function setMonitorMaximumSpeed(index: number, value: number) {
		const monitor = state.request.monitoring.monitors[index]
		if (monitor === undefined) return
		if (monitor.type === 'wind') monitor.maximumSpeed = value
	}

	function setMonitorMaximumGust(index: number, value: number) {
		const monitor = state.request.monitoring.monitors[index]
		if (monitor === undefined) return
		if (monitor.type === 'wind') monitor.maximumGust = value
	}

	function setMonitorMaximumHumidity(index: number, value: number) {
		const monitor = state.request.monitoring.monitors[index]
		if (monitor === undefined) return
		if (monitor.type === 'humidity') monitor.maximumHumidity = value
	}

	function setMonitorMinimumDifference(index: number, value: number) {
		const monitor = state.request.monitoring.monitors[index]
		if (monitor === undefined) return
		if (monitor.type === 'dewPoint') monitor.minimumDifference = value
	}

	function setMonitorMaximumCloudCover(index: number, value: number) {
		const monitor = state.request.monitoring.monitors[index]
		if (monitor === undefined) return
		if (monitor.type === 'cloud') monitor.maximumCloudCover = value
	}

	function setMonitorDevices(index: number, value: Extract<SequencerMonitor, { type: 'device' }>['devices']) {
		const monitor = state.request.monitoring.monitors[index]
		if (monitor === undefined) return
		if (monitor.type === 'device') monitor.devices = value.slice()
	}

	function setMonitorRequireConnected(index: number, value: boolean) {
		const monitor = state.request.monitoring.monitors[index]
		if (monitor === undefined) return
		if (monitor.type === 'device') monitor.requireConnected = value
	}

	function setMonitorRequireAvailable(index: number, value: boolean) {
		const monitor = state.request.monitoring.monitors[index]
		if (monitor === undefined) return
		if (monitor.type === 'device') monitor.requireAvailable = value
	}

	function setMonitorRequireQuiescent(index: number, value: boolean) {
		const monitor = state.request.monitoring.monitors[index]
		if (monitor === undefined) return
		if (monitor.type === 'device') monitor.requireQuiescent = value
	}

	function setMonitorPath(index: number, value?: string) {
		const monitor = state.request.monitoring.monitors[index]
		if (monitor === undefined) return
		if (monitor.type === 'storage') monitor.path = value || undefined
	}

	function setMonitorMinimumFreeSpace(index: number, value: number) {
		const monitor = state.request.monitoring.monitors[index]
		if (monitor === undefined) return
		if (monitor.type === 'storage') monitor.minimumFreeSpace = value
	}

	function setMonitorRequireWritable(index: number, value: boolean) {
		const monitor = state.request.monitoring.monitors[index]
		if (monitor === undefined) return
		if (monitor.type === 'storage') monitor.requireWritable = value
	}

	function setMonitorSource(index: number, value: string) {
		const monitor = state.request.monitoring.monitors[index]
		if (monitor === undefined) return
		if (monitor.type === 'power') monitor.source = value || undefined
		else if (monitor.type === 'heartbeat') monitor.source = value
	}

	function setMonitorMinimumBatteryLevel(index: number, value: number) {
		const monitor = state.request.monitoring.monitors[index]
		if (monitor === undefined) return
		if (monitor.type === 'power') monitor.minimumBatteryLevel = value
	}

	function setMonitorRequireExternalPower(index: number, value: boolean) {
		const monitor = state.request.monitoring.monitors[index]
		if (monitor === undefined) return
		if (monitor.type === 'power') monitor.requireExternalPower = value
	}

	function setMonitorThresholdsEnabled(index: number, value: boolean) {
		const monitor = state.request.monitoring.monitors[index]
		if (monitor === undefined) return
		if (monitor.type === 'guiding') monitor.thresholds.enabled = value
	}

	function setMonitorThresholdsPauseCaptureWhenExceeded(index: number, value: boolean) {
		const monitor = state.request.monitoring.monitors[index]
		if (monitor === undefined) return
		if (monitor.type === 'guiding') monitor.thresholds.pauseCaptureWhenExceeded = value
	}

	function setMonitorThresholdsMaximumRMS(index: number, value: number | undefined) {
		const monitor = state.request.monitoring.monitors[index]
		if (monitor === undefined) return
		if (monitor.type === 'guiding') monitor.thresholds.maximumRMS = value
	}

	function setMonitorThresholdsMaximumRightAscensionRMS(index: number, value: number | undefined) {
		const monitor = state.request.monitoring.monitors[index]
		if (monitor === undefined) return
		if (monitor.type === 'guiding') monitor.thresholds.maximumRightAscensionRMS = value
	}

	function setMonitorThresholdsMaximumDeclinationRMS(index: number, value: number | undefined) {
		const monitor = state.request.monitoring.monitors[index]
		if (monitor === undefined) return
		if (monitor.type === 'guiding') monitor.thresholds.maximumDeclinationRMS = value
	}

	function setMonitorMinimumAltitude(index: number, value: number | undefined) {
		const monitor = state.request.monitoring.monitors[index]
		if (monitor === undefined) return
		if (monitor.type === 'mountLimit') monitor.minimumAltitude = value
	}

	function setMonitorMaximumAltitude(index: number, value: number | undefined) {
		const monitor = state.request.monitoring.monitors[index]
		if (monitor === undefined) return
		if (monitor.type === 'mountLimit') monitor.maximumAltitude = value
	}

	function setMonitorMinimumHourAngle(index: number, value: number | undefined) {
		const monitor = state.request.monitoring.monitors[index]
		if (monitor === undefined) return
		if (monitor.type === 'mountLimit') monitor.minimumHourAngle = value
	}

	function setMonitorMaximumHourAngle(index: number, value: number | undefined) {
		const monitor = state.request.monitoring.monitors[index]
		if (monitor === undefined) return
		if (monitor.type === 'mountLimit') monitor.maximumHourAngle = value
	}

	function setMonitorTimeout(index: number, value: number) {
		const monitor = state.request.monitoring.monitors[index]
		if (monitor === undefined) return
		if (monitor.type === 'heartbeat') monitor.timeout = value
	}

	function setMonitorProvider(index: number, value: string) {
		const monitor = state.request.monitoring.monitors[index]
		if (monitor === undefined) return
		if (monitor.type === 'custom') monitor.provider = value
	}

	function setSafetyActionEnabled(index: number, value: boolean) {
		const action = state.request.safety.actions[index]
		if (action === undefined) return
		action.enabled = value
	}

	function setSafetyActionTimeout(index: number, value: number) {
		const action = state.request.safety.actions[index]
		if (action === undefined) return
		action.timeout = value
	}

	function setSafetyActionContinueOnFailure(index: number, value: boolean) {
		const action = state.request.safety.actions[index]
		if (action === undefined) return
		action.continueOnFailure = value
	}

	function setSafetyActionDevice(index: number, value: string) {
		const action = state.request.safety.actions[index]
		if (action === undefined) return
		if (action.type === 'switch') action.device = value
	}

	function setSafetyActionSwitch(index: number, value: string) {
		const action = state.request.safety.actions[index]
		if (action === undefined) return
		if (action.type === 'switch') action.switch = value
	}

	function setSafetyActionValue(index: number, value: string) {
		const action = state.request.safety.actions[index]
		if (action === undefined) return
		if (action.type === 'switch') action.value = value
	}

	function setSafetyActionHandler(index: number, value: string) {
		const action = state.request.safety.actions[index]
		if (action === undefined) return
		if (action.type === 'custom') action.handler = value
	}

	function updateRetry<K extends keyof SequencerRetryPolicy>(retry: DeepWritable<SequencerRetryPolicy>, key: K, value: SequencerRetryPolicy[K]) {
		retry[key] = value as never
	}

	function updateAuxiliaryCapture<K extends keyof SequencerAuxiliaryCapture>(capture: DeepWritable<SequencerAuxiliaryCapture>, key: K, value: SequencerAuxiliaryCapture[K]) {
		capture[key] = value
	}

	async function start() {
		if (state.busy || state.pendingCommand !== undefined || !state.camera?.connected) return

		state.pendingCommand = 'start'

		try {
			const result = await Api.Sequencer.start(state.request)

			if (result === undefined) {
				toast({ title: 'SEQUENCER', description: 'Failed to start the session', color: 'danger' })
				return
			}

			if (!result.ok) {
				if (result.preflight !== undefined) state.preflight = result.preflight
				toast({ title: 'SEQUENCER', description: startFailureMessage(result.reason, result.detail), color: 'danger' })
				return
			}

			applySession(result.session)
			startSnapshotLoop()
		} finally {
			state.pendingCommand = undefined
		}
	}

	async function stop() {
		const sessionId = state.session?.id
		if (sessionId === undefined || state.pendingCommand !== undefined) return

		state.pendingCommand = 'stop'

		try {
			const result = await Api.Sequencer.stop(sessionId)

			if (result === undefined || !result.ok) {
				toast({ title: 'SEQUENCER', description: 'Failed to stop the session', color: 'danger' })
				return
			}

			await refreshSession()
		} finally {
			state.pendingCommand = undefined
		}
	}

	async function pause() {
		const sessionId = state.session?.id
		if (sessionId === undefined || state.pendingCommand !== undefined) return

		state.pendingCommand = 'pause'

		try {
			const result = await Api.Sequencer.pause(sessionId)

			if (result === undefined || !result.ok) {
				toast({ title: 'SEQUENCER', description: 'Failed to pause the session', color: 'danger' })
				return
			}

			await refreshSession()
		} finally {
			state.pendingCommand = undefined
		}
	}

	async function resume() {
		const sessionId = state.session?.id
		if (sessionId === undefined || state.pendingCommand !== undefined) return

		state.pendingCommand = 'resume'

		try {
			const result = await Api.Sequencer.resume(sessionId)

			if (result === undefined || !result.ok) {
				toast({ title: 'SEQUENCER', description: 'Failed to resume the session', color: 'danger' })
				return
			}

			applySession(state.session)
			startSnapshotLoop()
			await refreshSession()
		} finally {
			state.pendingCommand = undefined
		}
	}

	return {
		state,
		targetCenteringSolver,
		mount,
		unmount,
		validate,
		setName,
		setTargetName,
		setTargetCoordinateType,
		setTargetCoordinateX,
		setTargetCoordinateY,
		setTargetTimeout,
		setTargetSettle,
		setCamera,
		setMount,
		setWheel,
		setFocuser,
		setRotator,
		setGuideCamera,
		setGuideOutput,
		setCover,
		setFlatPanel,
		setDome,
		addFrame,
		removeFrame,
		moveFrame,
		updateFrame,
		updateFrameCapture,
		updateFrameFilter,
		setGuidingConnectionMode,
		setGuidingRemoteHost,
		setGuidingRemotePort,
		setGuidingRemoteProfile,
		setGuidingLocalFocalLength,
		setGuidingLocalPixelSize,
		addFilterOffset,
		removeFilterOffset,
		updateFilterOffsetFilter,
		updateFilterOffset,
		addFilterBrightness,
		removeFilterBrightness,
		updateFilterBrightnessFilter,
		updateFilterBrightness,
		addMonitor,
		removeMonitor,
		setMonitorType,
		addSafetyAction,
		removeSafetyAction,
		setSafetyActionType,
		setStartConditionType,
		setEndConditionType,
		setTargetTrackingEnabled,
		setTargetTrackingMode,
		setTargetTrackingStopOnShutdown,
		setTargetCenterEnabled,
		setTargetCenterSolverType,
		setTargetCenterTolerance,
		setTargetCenterMaximumAttempts,
		setTargetCenterSettle,
		setTargetCenterSyncMount,
		setTargetConstraintsEnabled,
		setTargetConstraintsOnViolation,
		setTargetConstraintsStableFor,
		setTargetConstraintsMinimumAltitude,
		setTargetConstraintsMaximumAltitude,
		setTargetConstraintsMaximumAirmass,
		setTargetConstraintsMinimumMoonDistance,
		setTargetConstraintsMaximumMoonIllumination,
		setTargetConstraintsMinimumHourAngle,
		setTargetConstraintsMaximumHourAngle,
		setTargetConstraintsWindowEnabled,
		setTargetConstraintsWindowStart,
		setTargetConstraintsWindowEnd,
		setTargetConstraintsWindowMaximumSunAltitude,
		setCaptureOrder,
		setCaptureRepeat,
		setCaptureDelay,
		setCaptureContinueAfterRejectedFrame,
		setGuidingEnabled,
		setGuidingCalibrateBeforeStart,
		setGuidingRecalibrateAfterMeridianFlip,
		setGuidingRestoreAfterInterruption,
		setGuidingStopOnShutdown,
		setGuidingThresholdsEnabled,
		setGuidingThresholdsPauseCaptureWhenExceeded,
		setGuidingThresholdsMaximumRMS,
		setGuidingThresholdsMaximumRightAscensionRMS,
		setGuidingThresholdsMaximumDeclinationRMS,
		setGuidingThresholdsMinimumSNR,
		setGuidingThresholdsMinimumStarMass,
		setGuidingThresholdsMaximumLostStarTime,
		setGuidingRecoveryEnabled,
		setGuidingRecoveryMaximumAttempts,
		setGuidingRecoveryOnFailure,
		setGuidingRecoveryStopBeforeRetry,
		setGuidingRecoveryFindStarBeforeRetry,
		setGuidingRecoveryRecalibrate,
		setDitherEnabled,
		setDitherAmount,
		setDitherEveryFrames,
		setDitherEveryTime,
		setDitherRaOnly,
		setDitherBeforeFirstFrame,
		setDitherAfterFilterChange,
		setDitherOnFailure,
		setAutofocusEnabled,
		setAutofocusTriggersOnStart,
		setAutofocusTriggersOnFilterChange,
		setAutofocusTriggersAfterMeridianFlip,
		setAutofocusTriggersEveryFrames,
		setAutofocusTriggersEveryTime,
		setAutofocusTriggersTemperatureChange,
		setAutofocusTriggersMinimumTimeBetweenRuns,
		setAutofocusAlgorithmInitialOffsetSteps,
		setAutofocusAlgorithmStepSize,
		setAutofocusAlgorithmFittingMode,
		setAutofocusAlgorithmRmsdThreshold,
		setAutofocusAlgorithmMaximumPosition,
		setAutofocusAlgorithmReversed,
		setAutofocusAlgorithmBacklashEnabled,
		setAutofocusAlgorithmBacklashMode,
		setAutofocusAlgorithmBacklashSteps,
		setAutofocusStarDetectionType,
		setAutofocusStarDetectionTimeout,
		setAutofocusStarDetectionMinimumSNR,
		setAutofocusStarDetectionMaximumStars,
		setAutofocusSettle,
		setAutofocusOnFailure,
		setRotatorEnabled,
		setRotatorAngle,
		setRotatorTolerance,
		setRotatorSettle,
		setRotatorMoveBeforeCentering,
		setRotatorRestoreAfterMeridianFlip,
		setRotatorReverse,
		setMeridianFlipEnabled,
		setMeridianFlipMinimumHourAngle,
		setMeridianFlipMaximumHourAngle,
		setMeridianFlipSafetyMargin,
		setMeridianFlipSettle,
		setMeridianFlipTimeout,
		setMeridianFlipOnFailure,
		setMountEnabled,
		setMountUnparkOnStartup,
		setMountParkOnShutdown,
		setMountTimeout,
		setCoolingEnabled,
		setCoolingTemperature,
		setCoolingTolerance,
		setCoolingRamp,
		setCoolingWaitForTarget,
		setCoolingTimeout,
		setCoolingWarmTemperature,
		setCoolingWarmRamp,
		setCoolingTurnCoolerOffAfterWarm,
		setCoolingWarmOnShutdown,
		setDomeEnabled,
		setDomeUnparkOnStartup,
		setDomeOpenOnStartup,
		setDomeParkOnShutdown,
		setDomeCloseOnShutdown,
		setDomeCloseOnUnsafe,
		setDomeSlaving,
		setDomeSynchronizeBeforeCapture,
		setDomeSettle,
		setDomeTimeout,
		setDomeOnFailure,
		setCoverEnabled,
		setCoverOpenOnStartup,
		setCoverCloseOnShutdown,
		setCoverCloseOnUnsafe,
		setCoverOpenBeforeCapture,
		setCoverCloseForDarkFrames,
		setCoverTimeout,
		setFlatPanelEnabled,
		setFlatPanelBrightness,
		setFlatPanelTimeout,
		setExecutionPauseMode,
		setExecutionStopMode,
		setExecutionCheckpointAfterEveryAction,
		setExecutionCheckpointAfterEveryFrame,
		setExecutionCheckpointAfterEveryArtifact,
		setExecutionCheckpointInterval,
		setStorageFileNameTemplate,
		setStorageDirectoryTemplate,
		setStorageAutoSubFolderMode,
		setStartupEnabled,
		setStartupContinueOnFailure,
		setShutdownEnabled,
		setShutdownRunOnCompletion,
		setShutdownRunOnStop,
		setShutdownRunOnFailure,
		setShutdownContinueOnFailure,
		setSafetyEnabled,
		setSafetyTriggerOnWarning,
		setSafetyAbortCurrentExposure,
		setSafetyRecoveryEnabled,
		setSafetyRecoveryAutomatic,
		setSafetyRecoveryOnFailure,
		setSafetyRecoveryStableFor,
		setSafetyRecoveryMaximumWait,
		setSafetyRecoveryReconnectDevices,
		setSafetyRecoveryUnparkMount,
		setSafetyRecoveryRestoreTracking,
		setSafetyRecoveryResumeCapture,
		setQualityEnabled,
		setQualityStarDetectionType,
		setQualityStarDetectionTimeout,
		setQualityStarDetectionMinimumSNR,
		setQualityStarDetectionMaximumStars,
		setQualityEvaluateEveryFrames,
		setQualityRejectFrame,
		setQualityMinimumStarCount,
		setQualityMinimumSNR,
		setQualityMaximumHFD,
		setQualityMaximumFWHM,
		setQualityMaximumEccentricity,
		setQualityMaximumBackground,
		setQualityMaximumBackgroundVariation,
		setQualityMaximumSaturation,
		setMonitoringEnabled,
		setMonitoringInterval,
		setNotificationEnabled,
		setNotificationMinimumSeverity,
		setNotificationEvents,
		setAutofocusStarDetectionExecutable,
		setQualityStarDetectionExecutable,
		setStorageRoot,
		setStorageTemporaryDirectory,
		setStartAtTime,
		setEndAtTime,
		setEndIntegrationTime,
		setStartAltitude,
		setStartDirection,
		setEndAltitude,
		setEndDirection,
		setNotificationChannel,
		setNotificationWebhook,
		setNotificationWebhookUrl,
		updateCamera,
		updateGuiderSettle,
		setMonitorEnabled,
		setMonitorName,
		setMonitorSeverity,
		setMonitorAssertAfter,
		setMonitorClearAfter,
		setMonitorStaleAfter,
		setMonitorWetIsUnsafe,
		setMonitorMaximumSpeed,
		setMonitorMaximumGust,
		setMonitorMaximumHumidity,
		setMonitorMinimumDifference,
		setMonitorMaximumCloudCover,
		setMonitorDevices,
		setMonitorRequireConnected,
		setMonitorRequireAvailable,
		setMonitorRequireQuiescent,
		setMonitorPath,
		setMonitorMinimumFreeSpace,
		setMonitorRequireWritable,
		setMonitorSource,
		setMonitorMinimumBatteryLevel,
		setMonitorRequireExternalPower,
		setMonitorThresholdsEnabled,
		setMonitorThresholdsPauseCaptureWhenExceeded,
		setMonitorThresholdsMaximumRMS,
		setMonitorThresholdsMaximumRightAscensionRMS,
		setMonitorThresholdsMaximumDeclinationRMS,
		setMonitorMinimumAltitude,
		setMonitorMaximumAltitude,
		setMonitorMinimumHourAngle,
		setMonitorMaximumHourAngle,
		setMonitorTimeout,
		setMonitorProvider,
		setSafetyActionEnabled,
		setSafetyActionTimeout,
		setSafetyActionContinueOnFailure,
		setSafetyActionDevice,
		setSafetyActionSwitch,
		setSafetyActionValue,
		setSafetyActionHandler,
		updateRetry,
		updateAuxiliaryCapture,
		start,
		stop,
		pause,
		resume,
	} as const
}

function findDevice<K extends 'camera' | 'mount' | 'wheel' | 'focuser' | 'rotator' | 'guideOutput' | 'cover' | 'flatPanel' | 'dome'>(type: K, id: string | undefined): EquipmentState[K][number] | undefined {
	if (!id) return undefined
	return equipmentStore.state[type].find((device) => device.id === id || device.name === id)
}

function pathSegment(value: string) {
	const slug = value
		.trim()
		.replaceAll(/[/\\.\0]+/g, '-')
		.replaceAll(/\s+/g, '-')
		.replaceAll(/^-+|-+$/g, '')
		.slice(0, 64)

	return slug === '.' || slug === '..' ? '' : slug
}

function startCondition(type: SequencerStartCondition['type'], current: SequencerStartCondition): SequencerStartCondition {
	if (type === 'manual') return { type }
	if (type === 'at') return { type, time: 'time' in current ? current.time : Date.now() }
	return { type, altitude: 'altitude' in current ? current.altitude : 0, direction: 'direction' in current ? current.direction : 'setting' }
}

function endCondition(type: SequencerEndCondition['type'], current: SequencerEndCondition): SequencerEndCondition {
	if (type === 'afterSequence') return { type }
	if (type === 'at' || type === 'integrationTime') return { type, time: 'time' in current ? current.time : type === 'at' ? Date.now() : 3600 }
	return { type, altitude: 'altitude' in current ? current.altitude : 0, direction: 'direction' in current ? current.direction : 'setting' }
}

function startFailureMessage(reason: string, detail?: string) {
	const message = detail && detail.length > 0 ? `${reason}: ${detail}` : reason
	return `Could not start (${message})`
}

// Shared identity and debounce fields copied onto a newly typed monitor.
function monitorBase(type: SequencerMonitor['type'], current?: SequencerMonitor): SequencerMonitorBase {
	return {
		id: current?.id || nanoid(8),
		name: current?.name || type,
		enabled: current?.enabled ?? true,
		type,
		severity: current?.severity ?? 'unsafe',
		assertAfter: current?.assertAfter ?? 30,
		clearAfter: current?.clearAfter ?? 60,
		staleAfter: current?.staleAfter ?? 120,
	}
}

// Builds a monitor of `type`, preserving identity and debounce from `current` when changing kinds.
function createMonitor(type: SequencerMonitor['type'], current?: SequencerMonitor): SequencerMonitor {
	const base = monitorBase(type, current)

	if (type === 'rain') return { ...base, type, wetIsUnsafe: current?.type === 'rain' ? current.wetIsUnsafe : true }
	if (type === 'wind') return { ...base, type, maximumSpeed: current?.type === 'wind' ? current.maximumSpeed : 10, maximumGust: current?.type === 'wind' ? current.maximumGust : 15 }
	if (type === 'humidity') return { ...base, type, maximumHumidity: current?.type === 'humidity' ? current.maximumHumidity : 85 }
	if (type === 'dewPoint') return { ...base, type, minimumDifference: current?.type === 'dewPoint' ? current.minimumDifference : 2 }
	if (type === 'cloud') return { ...base, type, maximumCloudCover: current?.type === 'cloud' ? current.maximumCloudCover : 50 }
	if (type === 'device')
		return {
			...base,
			type,
			devices: current?.type === 'device' ? current.devices.slice() : ['camera', 'mount'],
			requireConnected: current?.type === 'device' ? current.requireConnected : true,
			requireAvailable: current?.type === 'device' ? current.requireAvailable : true,
			requireQuiescent: current?.type === 'device' ? current.requireQuiescent : false,
		}
	if (type === 'storage') return { ...base, type, path: current?.type === 'storage' ? current.path : undefined, minimumFreeSpace: current?.type === 'storage' ? current.minimumFreeSpace : 1073741824, requireWritable: current?.type === 'storage' ? current.requireWritable : true }
	if (type === 'power') return { ...base, type, source: current?.type === 'power' ? current.source : undefined, minimumBatteryLevel: current?.type === 'power' ? current.minimumBatteryLevel : 20, requireExternalPower: current?.type === 'power' ? current.requireExternalPower : false }
	if (type === 'guiding') return { ...base, type, thresholds: current?.type === 'guiding' ? structuredClone(current.thresholds) : { enabled: true, pauseCaptureWhenExceeded: true } }
	if (type === 'mountLimit')
		return {
			...base,
			type,
			minimumAltitude: current?.type === 'mountLimit' ? current.minimumAltitude : undefined,
			maximumAltitude: current?.type === 'mountLimit' ? current.maximumAltitude : undefined,
			minimumHourAngle: current?.type === 'mountLimit' ? current.minimumHourAngle : undefined,
			maximumHourAngle: current?.type === 'mountLimit' ? current.maximumHourAngle : undefined,
		}
	if (type === 'heartbeat') return { ...base, type, source: current?.type === 'heartbeat' ? current.source : '', timeout: current?.type === 'heartbeat' ? current.timeout : 30 }
	if (type === 'custom') return { ...base, type, provider: current?.type === 'custom' ? current.provider : '' }
	return { ...base, type: 'weather' }
}

// Builds a safety action of `type`, preserving identity, timeout, and retry from `current` when changing kinds.
function createSafetyAction(type: SequencerSafetyAction['type'], current?: SequencerSafetyAction): SequencerSafetyAction {
	const base = {
		id: current?.id || nanoid(8),
		enabled: current?.enabled ?? true,
		continueOnFailure: current?.continueOnFailure ?? true,
		timeout: current?.timeout ?? 30,
		retry: structuredClone(current?.retry ?? DEFAULT_SEQUENCER_RETRY_POLICY),
	}

	if (type === 'switch') return { ...base, type, device: current?.type === 'switch' ? current.device : '', switch: current?.type === 'switch' ? current.switch : '', value: current?.type === 'switch' ? current.value : false }
	if (type === 'custom') return { ...base, type, handler: current?.type === 'custom' ? current.handler : '' }
	return { ...base, type }
}
