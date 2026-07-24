import type { FrameType, CameraTransferFormat } from 'nebulosa/src/devices/indi/device'
import { DEFAULT_CAMERA_CAPTURE_START } from 'src/types/camera'
import type { CameraAutoSubFolderMode, CameraCaptureStart, CameraExposureMode, CameraExposureTimeUnit } from 'src/types/camera'
import { proxy } from 'valtio'

export type CameraCaptureStore = ReturnType<typeof cameraCaptureStore>

export function cameraCaptureStore(capture?: CameraCaptureStart) {
	const state = proxy<CameraCaptureStart>(capture ?? structuredClone(DEFAULT_CAMERA_CAPTURE_START))

	function setExposureTime(value: number) {
		state.exposureTime = value
	}

	function setExposureTimeUnit(value: CameraExposureTimeUnit) {
		state.exposureTimeUnit = value
	}

	function setFrameType(value: FrameType) {
		state.frameType = value
	}

	function setExposureMode(value: CameraExposureMode) {
		state.exposureMode = value
	}

	function setDelay(value: number) {
		state.delay = value
	}

	function setCount(value: number) {
		state.count = value
	}

	function setX(value: number) {
		state.x = value
	}

	function setY(value: number) {
		state.y = value
	}

	function setWidth(value: number) {
		state.width = value
	}

	function setHeight(value: number) {
		state.height = value
	}

	function setSubframe(value: boolean) {
		state.subframe = value
	}

	function setBinX(value: number) {
		state.binX = value
	}

	function setBinY(value: number) {
		state.binY = value
	}

	function setFrameFormat(value: string) {
		state.frameFormat = value
	}

	function setGain(value: number) {
		state.gain = value
	}

	function setOffset(value: number) {
		state.offset = value
	}

	function setAutoSave(value: boolean) {
		state.autoSave = value
	}

	function setSavePath(value: string | undefined) {
		state.savePath = value
	}

	function setAutoSubFolderMode(value: CameraAutoSubFolderMode) {
		state.autoSubFolderMode = value
	}

	function setMount(value: string | undefined) {
		state.mount = value
	}

	function setWheel(value: string | undefined) {
		state.wheel = value
	}

	function setFocuser(value: string | undefined) {
		state.focuser = value
	}

	function setRotator(value: string | undefined) {
		state.rotator = value
	}

	function setTransferFormat(value: CameraTransferFormat) {
		state.transferFormat = value
	}

	function setCompressed(value: boolean) {
		state.compressed = value
	}

	return {
		state,
		setExposureTime,
		setExposureTimeUnit,
		setFrameType,
		setExposureMode,
		setDelay,
		setCount,
		setX,
		setY,
		setWidth,
		setHeight,
		setSubframe,
		setBinX,
		setBinY,
		setFrameFormat,
		setGain,
		setOffset,
		setAutoSave,
		setSavePath,
		setAutoSubFolderMode,
		setMount,
		setWheel,
		setFocuser,
		setRotator,
		setTransferFormat,
		setCompressed,
	} as const
}
