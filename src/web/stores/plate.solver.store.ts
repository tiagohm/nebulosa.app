import type { Angle } from 'nebulosa/src/math/units/angle'
import { DEFAULT_PLATE_SOLVE_START, type PlateSolverType, type PlateSolveStart } from 'src/shared/types'
import { proxy } from 'valtio'

export type PlateSolverStore = ReturnType<typeof plateSolverStore>

export function plateSolverStore(solver?: PlateSolveStart) {
	const state = proxy(solver ?? structuredClone(DEFAULT_PLATE_SOLVE_START))

	function setType(value: PlateSolverType) {
		state.type = value
	}

	function setExecutable(value: string) {
		state.executable = value
	}

	function setPath(value: string) {
		state.path = value
	}

	function setFocalLength(value: number) {
		state.focalLength = value
	}

	function setPixelSize(value: number) {
		state.pixelSize = value
	}

	function setFov(value: number) {
		state.fov = value
	}

	function setApiUrl(value: string | undefined) {
		state.apiUrl = value
	}

	function setApiKey(value: string | undefined) {
		state.apiKey = value
	}

	function setBlind(value: boolean) {
		state.blind = value
	}

	function setRightAscension(value: string | Angle) {
		state.rightAscension = value
	}

	function setDeclination(value: string | Angle) {
		state.declination = value
	}

	function setRadius(value: number) {
		state.radius = value
	}

	function setDownsample(value: number | undefined) {
		state.downsample = value
	}

	function setTimeout(value: number | undefined) {
		state.timeout = value
	}

	return {
		state,
		setType,
		setExecutable,
		setPath,
		setFocalLength,
		setPixelSize,
		setFov,
		setApiUrl,
		setApiKey,
		setBlind,
		setRightAscension,
		setDeclination,
		setRadius,
		setDownsample,
		setTimeout,
	} as const
}
