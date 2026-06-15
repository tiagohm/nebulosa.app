import { deg, toDeg } from 'nebulosa/src/angle'
import { meter, toMeter } from 'nebulosa/src/distance'
import type { GeographicCoordinate } from 'nebulosa/src/location'
import { createContext, memo, useContext, useEffect, type CSSProperties } from 'react'
import { useSnapshot } from 'valtio'
import { useStore } from '../hooks/store.hook'
import { locationStore, type LocationStore } from '../stores/location.store'
import { Button } from './components/Button'
import { IconButton } from './components/IconButton'
import { NumberInput } from './components/NumberInput'
import { WorldMap, worldMapCoordinateToPoint } from './components/WorldMap'
import { MountDropdown } from './DeviceDropdown'
import { Icons } from './Icon'
import { Modal } from './Modal'

const LocationStoreContext = createContext<LocationStore>(null as never)

export interface LocationProps extends GeographicCoordinate {
	readonly id: string
	readonly onCoordinateChange?: (position: GeographicCoordinate) => void
	readonly onClose?: () => void
}

export function Location({ id, onCoordinateChange, onClose, ...coordinate }: LocationProps) {
	const location = useStore(() => locationStore(coordinate), [])

	useEffect(() => {
		location.update('latitude', toDeg(coordinate.latitude))
		location.update('longitude', toDeg(coordinate.longitude))
		location.update('elevation', toMeter(coordinate.elevation))
	}, [coordinate.latitude, coordinate.longitude, coordinate.elevation])

	function handleChoose() {
		const { latitude, longitude, elevation } = location.state
		onCoordinateChange?.({ latitude: deg(latitude), longitude: deg(longitude), elevation: meter(elevation) })
		onClose?.()
	}

	const Footer = <Button color="success" label="Choose" onClick={handleChoose} startContent={<Icons.Check />} />

	return (
		<LocationStoreContext value={location}>
			<Modal footer={Footer} header={<Header />} id={id} maxWidth="326px" onHide={onClose}>
				<div className="mt-0 flex flex-col gap-2">
					<Inputs />
					<Map />
				</div>
			</Modal>
		</LocationStoreContext>
	)
}

const Header = memo(() => {
	const location = useContext(LocationStoreContext)

	return (
		<div className="flex flex-row items-center justify-start gap-2">
			<span className="me-3 font-bold">Location</span>
			<IconButton className="col-span-2" color="secondary" icon={Icons.HomeMapMarker} onClick={location.findCurrentPosition} tooltipContent="Load from current location" />
			<MountDropdown disallowNoneSelection onValueChange={location.handleMountChange} tooltipContent="Load from mount" />
		</div>
	)
})

const Inputs = memo(() => {
	const location = useContext(LocationStoreContext)
	const { latitude, longitude, elevation } = useSnapshot(location.state)

	return (
		<div className="grid grid-cols-3 gap-2">
			<NumberInput className="col-span-1" fractionDigits={3} label="Latitude (°)" maxValue={90} minValue={-90} onValueChange={(value) => location.update('latitude', value)} step={0.001} value={latitude} />
			<NumberInput className="col-span-1" fractionDigits={3} label="Longitude (°)" maxValue={180} minValue={-180} onValueChange={(value) => location.update('longitude', value)} step={0.001} value={longitude} />
			<NumberInput className="col-span-1" label="Elevation (m)" maxValue={10000} minValue={-100} onValueChange={(value) => location.update('elevation', value)} value={elevation} />
		</div>
	)
})

const Map = memo(() => {
	const location = useContext(LocationStoreContext)

	return <WorldMap defaultScale={5} onCoordinateClick={location.handleCoordinateChange} onTransformChange={location.handleTransformChange} children={<MapMarker />} />
})

const MAP_MARKER_STYLE: CSSProperties = { fill: 'var(--danger)' }

const MapMarker = memo(() => {
	const location = useContext(LocationStoreContext)
	const coordinate = useSnapshot(location.state)
	const point = worldMapCoordinateToPoint(coordinate)
	const size = 172 / coordinate.scale

	return <Icons.MapMarker width={size} height={size} style={{ ...MAP_MARKER_STYLE, transform: `translate(${point.x - size * 0.5}px, ${point.y - size}px)` }} />
})
