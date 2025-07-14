import { Button, NumberInput } from '@heroui/react'
import type { LatLngTuple } from 'leaflet'
import * as Lucide from 'lucide-react'
import { useCallback, useState } from 'react'
import type { GeographicCoordinate } from 'src/shared/types'
import { MapViewer } from './MapViewer'
import { Modal } from './Modal'

export interface LocationProps {
	readonly name?: string
	readonly initialPosition: GeographicCoordinate
	readonly onPositionChange?: (position: GeographicCoordinate) => void
	readonly onClose?: () => void
}

export function Location({ name, initialPosition, onPositionChange, onClose }: LocationProps) {
	const [position, setPosition] = useState<LatLngTuple>([initialPosition.latitude, initialPosition.longitude, initialPosition.elevation])

	const handlePositionChoose = useCallback(() => {
		onPositionChange?.({ latitude: position[0], longitude: position[1], elevation: position[2] ?? initialPosition.elevation })
		onClose?.()
	}, [onPositionChange, onClose])

	const handlePositionChange = useCallback((newPosition: LatLngTuple) => {
		setPosition((prev) => [newPosition[0], newPosition[1], prev[2]])
	}, [])

	const updatePosition = useCallback((type: keyof GeographicCoordinate, value: number) => {
		if (type === 'latitude') setPosition((prev) => [value, prev[1], prev[2]])
		else if (type === 'longitude') setPosition((prev) => [prev[0], value, prev[2]])
		else if (type === 'elevation') setPosition((prev) => [prev[0], prev[1], value])
	}, [])

	return (
		<Modal
			footer={
				<Button color='success' onPointerUp={handlePositionChoose} startContent={<Lucide.Check size={18} />} variant='flat'>
					Choose
				</Button>
			}
			header='Location'
			maxWidth='330px'
			name={name || 'location'}
			onClose={onClose}>
			<div className='mt-0 flex flex-col gap-2'>
				<div className='grid grid-cols-3 gap-2'>
					<NumberInput className='col-span-1' label='Latitude (°)' maxValue={90} minValue={-90} onValueChange={(value) => updatePosition('latitude', value)} size='sm' step={0.01} value={position[0]} />
					<NumberInput className='col-span-1' label='Longitude (°)' maxValue={180} minValue={-180} onValueChange={(value) => updatePosition('longitude', value)} size='sm' step={0.01} value={position[1]} />
					<NumberInput className='col-span-1' label='Elevation (m)' maxValue={10000} minValue={-100} onValueChange={(value) => updatePosition('elevation', value)} size='sm' step={1} value={position[2] ?? 0} />
				</div>
				<MapViewer onPositionChange={handlePositionChange} position={position} width={298} />
			</div>
		</Modal>
	)
}
