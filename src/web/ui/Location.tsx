import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, NumberInput } from '@heroui/react'
import type { LatLngTuple } from 'leaflet'
import * as Lucide from 'lucide-react'
import { useCallback, useState } from 'react'
import type { GeographicCoordinate } from 'src/shared/types'
import { useModal } from '@/shared/hooks'
import { MapViewer } from './MapViewer'

export interface LocationProps {
	readonly initialPosition: GeographicCoordinate
	readonly onPositionChange?: (position: GeographicCoordinate) => void
	readonly onClose?: () => void
}

export function Location({ initialPosition, onPositionChange, onClose }: LocationProps) {
	const [position, setPosition] = useState<LatLngTuple>([initialPosition.latitude, initialPosition.longitude, initialPosition.elevation])
	const modal = useModal(onClose)

	const handlePositionChoose = useCallback(() => {
		onPositionChange?.({ latitude: position[0], longitude: position[1], elevation: position[2] ?? initialPosition.elevation })
		onClose?.()
	}, [onPositionChange, onClose])

	const handlePositionChange = useCallback((newPosition: LatLngTuple) => {
		setPosition((prev) => [newPosition[0], newPosition[1], prev[2]])
	}, [])

	const updatePosition = useCallback((type: keyof GeographicCoordinate, value: number) => {
		switch (type) {
			case 'latitude':
				setPosition((prev) => [value, prev[1], prev[2]])
				break
			case 'longitude':
				setPosition((prev) => [prev[0], value, prev[2]])
				break
			case 'elevation':
				setPosition((prev) => [prev[0], prev[1], value])
				break
		}
	}, [])

	return (
		<Modal {...modal.props} classNames={{ base: 'max-w-[340px] max-h-[70vh]', wrapper: 'pointer-events-none' }}>
			<ModalContent>
				{() => (
					<>
						<ModalHeader {...modal.moveProps} className='flex flex-row items-center'>
							Location
						</ModalHeader>
						<ModalBody>
							<div className='flex flex-col gap-2'>
								<div className='grid grid-cols-3 gap-2'>
									<NumberInput className='col-span-1' label='Latitude (°)' maxValue={90} minValue={-90} onValueChange={(value) => updatePosition('latitude', value)} size='sm' step={0.01} value={position[0]} />
									<NumberInput className='col-span-1' label='Longitude (°)' maxValue={180} minValue={-180} onValueChange={(value) => updatePosition('longitude', value)} size='sm' step={0.01} value={position[1]} />
									<NumberInput className='col-span-1' label='Elevation (m)' maxValue={10000} minValue={-100} onValueChange={(value) => updatePosition('elevation', value)} size='sm' step={1} value={position[2] ?? 0} />
								</div>
								<MapViewer onPositionChange={handlePositionChange} position={position} width={301} />
							</div>
						</ModalBody>
						<ModalFooter {...modal.moveProps}>
							<Button color='success' onPointerUp={handlePositionChoose} startContent={<Lucide.Check size={18} />} variant='flat'>
								Choose
							</Button>
						</ModalFooter>
					</>
				)}
			</ModalContent>
		</Modal>
	)
}
