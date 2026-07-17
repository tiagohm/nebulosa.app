import type { WorldMapPosition } from '@ui/components/WorldMap'
import type { InteractTransform } from '@ui/Interactable'
import type { GeographicCoordinate } from 'nebulosa/src/astronomy/observer/location'
import type { Mount } from 'nebulosa/src/devices/indi/device'
import { toDeg } from 'nebulosa/src/math/units/angle'
import { toMeter } from 'nebulosa/src/math/units/distance'
import { proxy } from 'valtio'
import { settingsStore } from './settings.store'

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

	function loadFromGeographicCoordinate(coordinate: GeographicCoordinate) {
		const { latitude, longitude, elevation } = coordinate
		state.latitude = toDeg(latitude)
		state.longitude = toDeg(longitude)
		state.elevation = toMeter(elevation)
	}

	function loadFromSettings() {
		loadFromGeographicCoordinate(settingsStore.state.location)
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
		loadFromGeographicCoordinate(mount.geographicCoordinate)
	}

	return {
		state,
		mount,
		unmount,
		update,
		findCurrentPosition,
		loadFromSettings,
		handleTransformChange,
		handleCoordinateChange,
		handleMountChange,
	} as const
}
