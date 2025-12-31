import { NumberInput, Tooltip } from '@heroui/react'
import type { LatLngTuple } from 'leaflet'
import { deg, toDeg } from 'nebulosa/src/angle'
import { meter, toMeter } from 'nebulosa/src/distance'
import type { GeographicCoordinate } from 'nebulosa/src/location'
import { useState } from 'react'
import { DECIMAL_NUMBER_FORMAT, INTEGER_NUMBER_FORMAT } from '@/shared/constants'
import { Icons } from './Icon'
import { IconButton } from './IconButton'
import { MapViewer } from './MapViewer'
import { Modal } from './Modal'
import { TextButton } from './TextButton'

export interface LocationProps {
	readonly id: string
	readonly coordinate: GeographicCoordinate
	readonly onCoordinateChange?: (position: GeographicCoordinate) => void
	readonly onClose?: () => void
}

export function Location({ id, coordinate: { latitude, longitude, elevation }, onCoordinateChange: onPositionChange, onClose }: LocationProps) {
	const [position, setPosition] = useState<LatLngTuple>([toDeg(latitude), toDeg(longitude), toMeter(elevation)])

	function handleChoose() {
		onPositionChange?.({ latitude: deg(position[0]), longitude: deg(position[1]), elevation: meter(position[2] ?? 0) })
		onClose?.()
	}

	function handlePositionChange(newPosition: LatLngTuple) {
		setPosition((prev) => [newPosition[0], newPosition[1], prev[2]])
	}

	function updatePosition(type: keyof GeographicCoordinate, value: number) {
		if (type === 'latitude') setPosition((prev) => [value, prev[1], prev[2]])
		else if (type === 'longitude') setPosition((prev) => [prev[0], value, prev[2]])
		else if (type === 'elevation') setPosition((prev) => [prev[0], prev[1], value])
	}

	function findCurrentPosition() {
		navigator.geolocation.getCurrentPosition(
			({ coords }) => {
				setPosition([coords.latitude, coords.longitude, position[2]])
			},
			undefined,
			{ enableHighAccuracy: true, timeout: 15000 },
		)
	}

	const Header = (
		<div className='flex flex-row justify-start items-center gap-2'>
			<span className='me-3'>Location</span>
			<Tooltip content='Use my location' placement='bottom' showArrow>
				<IconButton className='col-span-2' color='secondary' icon={Icons.HomeMapMarker} onPointerUp={findCurrentPosition} />
			</Tooltip>
		</div>
	)

	const Footer = <TextButton color='success' label='Choose' onPointerUp={handleChoose} startContent={<Icons.Check />} />

	return (
		<Modal footer={Footer} header={Header} id={id} maxWidth='330px' onHide={onClose}>
			<div className='mt-0 flex flex-col gap-2'>
				<div className='grid grid-cols-3 gap-2'>
					<NumberInput className='col-span-1' formatOptions={DECIMAL_NUMBER_FORMAT} label='Latitude (°)' maxValue={90} minValue={-90} onValueChange={(value) => updatePosition('latitude', value)} size='sm' step={0.001} value={position[0]} />
					<NumberInput className='col-span-1' formatOptions={DECIMAL_NUMBER_FORMAT} label='Longitude (°)' maxValue={180} minValue={-180} onValueChange={(value) => updatePosition('longitude', value)} size='sm' step={0.001} value={position[1]} />
					<NumberInput className='col-span-1' formatOptions={INTEGER_NUMBER_FORMAT} label='Elevation (m)' maxValue={10000} minValue={-100} onValueChange={(value) => updatePosition('elevation', value)} size='sm' value={position[2] ?? 0} />
				</div>
				<MapViewer onPositionChange={handlePositionChange} position={position} width={298} />
			</div>
		</Modal>
	)
}
