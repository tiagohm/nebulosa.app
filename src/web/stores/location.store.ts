import { toDeg } from 'nebulosa/src/angle'
import { toMeter } from 'nebulosa/src/distance'
import type { Mount } from 'nebulosa/src/indi.device'
import type { GeographicCoordinate } from 'nebulosa/src/location'
import { proxy } from 'valtio'
import type { WorldMapPosition } from '../ui/components/WorldMap'
import type { InteractTransform } from '../ui/Interactable'

export type LocationStore = ReturnType<typeof locationStore>

export interface LocationState {
	latitude: number // deg
	longitude: number // deg
	elevation: number // m
	scale: number
}

export function locationStore(coordinate: GeographicCoordinate) {
	const state = proxy<LocationState>({
		latitude: toDeg(coordinate.latitude),
		longitude: toDeg(coordinate.longitude),
		elevation: toMeter(coordinate.elevation),
		scale: 5,
	})

	function mount() {}

	function unmount() {}

	function update(type: keyof LocationState, value: number) {
		state[type] = value
	}

	function findCurrentPosition() {
		if (!navigator.geolocation) return

		navigator.geolocation.getCurrentPosition(
			({ coords }) => {
				state.latitude = coords.latitude
				state.longitude = coords.longitude
			},
			undefined,
			{ enableHighAccuracy: true, timeout: 15000 },
		)
	}

	function handleTransformChange(transform: InteractTransform) {
		state.scale = transform.scale
	}

	function handleCoordinateChange(position: WorldMapPosition) {
		state.latitude = position.latitude
		state.longitude = position.longitude
	}

	function handleMountChange(mount?: Mount) {
		if (!mount) return
		const { latitude, longitude, elevation } = mount.geographicCoordinate
		state.latitude = toDeg(latitude)
		state.longitude = toDeg(longitude)
		state.elevation = toMeter(elevation)
	}

	return {
		state,
		mount,
		unmount,
		update,
		findCurrentPosition,
		handleTransformChange,
		handleCoordinateChange,
		handleMountChange,
	} as const
}
