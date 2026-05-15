import type { LatLngTuple } from 'leaflet'
import { deg, toDeg } from 'nebulosa/src/angle'
import { meter, toMeter } from 'nebulosa/src/distance'
import type { Mount } from 'nebulosa/src/indi.device'
import type { GeographicCoordinate } from 'nebulosa/src/location'
import { useState } from 'react'
import { clamp } from '@/shared/util'
import { Button } from './components/Button'
import { IconButton } from './components/IconButton'
import { NumberInput } from './components/NumberInput'
import { MountDropdown } from './DeviceDropdown'
import { Icons } from './Icon'
import { MapViewer } from './MapViewer'
import { Modal } from './Modal'

export interface LocationProps extends GeographicCoordinate {
	readonly id: string
	readonly onCoordinateChange?: (position: GeographicCoordinate) => void
	readonly onClose?: () => void
}

function normalizeLatitude(value: number) {
	return clamp(value, -90, 90)
}

function normalizeLongitude(value: number) {
	if (!Number.isFinite(value)) return 0

	const normalized = ((((value + 180) % 360) + 360) % 360) - 180
	return Object.is(normalized, -180) && value > 0 ? 180 : normalized
}

function toPosition({ latitude, longitude, elevation }: GeographicCoordinate): LatLngTuple {
	return [normalizeLatitude(toDeg(latitude)), normalizeLongitude(toDeg(longitude)), toMeter(elevation)]
}

export function Location({ id, latitude, longitude, elevation, onCoordinateChange, onClose }: LocationProps) {
	const [position, setPosition] = useState<LatLngTuple>(() => toPosition({ latitude, longitude, elevation }))

	function handleChoose() {
		onCoordinateChange?.({ latitude: deg(position[0]), longitude: deg(position[1]), elevation: meter(position[2] ?? 0) })
		onClose?.()
	}

	function handlePositionChange(newPosition: LatLngTuple) {
		setPosition((prev) => [normalizeLatitude(newPosition[0]), normalizeLongitude(newPosition[1]), prev[2]])
	}

	function updatePosition(type: keyof GeographicCoordinate, value: number) {
		if (type === 'latitude') setPosition((prev) => [normalizeLatitude(value), prev[1], prev[2]])
		else if (type === 'longitude') setPosition((prev) => [prev[0], normalizeLongitude(value), prev[2]])
		else if (type === 'elevation') setPosition((prev) => [prev[0], prev[1], value])
	}

	function findCurrentPosition() {
		if (!navigator.geolocation) return

		navigator.geolocation.getCurrentPosition(
			({ coords }) => {
				setPosition((prev) => [normalizeLatitude(coords.latitude), normalizeLongitude(coords.longitude), prev[2]])
			},
			undefined,
			{ enableHighAccuracy: true, timeout: 15000 },
		)
	}

	function handleMountChange(mount?: Mount) {
		if (!mount) return
		setPosition(toPosition(mount.geographicCoordinate))
	}

	const Header = (
		<div className="flex flex-row items-center justify-start gap-2">
			<span className="me-3 font-bold">Location</span>
			<IconButton className="col-span-2" color="secondary" icon={Icons.HomeMapMarker} onClick={findCurrentPosition} tooltipContent="Load from current location" />
			<MountDropdown disallowNoneSelection onValueChange={handleMountChange} tooltipContent="Load from mount" />
		</div>
	)

	const Footer = <Button color="success" label="Choose" onClick={handleChoose} startContent={<Icons.Check />} />

	return (
		<Modal footer={Footer} header={Header} id={id} maxWidth="326px" onHide={onClose}>
			<div className="mt-0 flex flex-col gap-2">
				<div className="grid grid-cols-3 gap-2">
					<NumberInput className="col-span-1" fractionDigits={3} label="Latitude (°)" maxValue={90} minValue={-90} onValueChange={(value) => updatePosition('latitude', value)} step={0.001} value={position[0]} />
					<NumberInput className="col-span-1" fractionDigits={3} label="Longitude (°)" maxValue={180} minValue={-180} onValueChange={(value) => updatePosition('longitude', value)} step={0.001} value={position[1]} />
					<NumberInput className="col-span-1" label="Elevation (m)" maxValue={10000} minValue={-100} onValueChange={(value) => updatePosition('elevation', value)} value={position[2] ?? 0} />
				</div>
				<MapViewer onPositionChange={handlePositionChange} position={position} width={298} />
			</div>
		</Modal>
	)
}
