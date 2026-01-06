import { Icon, type LatLngExpression, type LatLngTuple, type Marker as LeafletMarker } from 'leaflet'
import { type CSSProperties, useEffect, useRef } from 'react'
import { MapContainer, Marker, TileLayer, useMapEvents } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import mapIconSvg from '../assets/map-pin.svg'

export interface MapViewerProps extends React.HTMLAttributes<HTMLDivElement> {
	readonly width?: CSSProperties['width']
	readonly height?: CSSProperties['height']
	readonly position?: LatLngExpression
	readonly zoom?: number
	readonly onPositionChange?: (position: LatLngTuple) => void
}

export function MapViewer({ position = [0, 0], zoom = 5, width = 200, height = 200, onPositionChange, ...props }: MapViewerProps) {
	return (
		<div {...props}>
			<MapContainer center={position} className='rounded' doubleClickZoom={false} style={{ height, width }} zoom={zoom} zoomControl={false}>
				<TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url='https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png' />
				<DraggableMarker onPositionChange={onPositionChange} position={position} />
			</MapContainer>
		</div>
	)
}

export interface DraggableMarkerProps {
	readonly position: LatLngExpression
	readonly onPositionChange?: (position: LatLngTuple) => void
}

export const MapPinIcon = new Icon({
	iconUrl: mapIconSvg,
	iconSize: [24, 24],
	iconAnchor: [12, 24],
})

export function DraggableMarker({ position, onPositionChange }: DraggableMarkerProps) {
	const marker = useRef<LeafletMarker>(null)

	const map = useMapEvents({
		click({ latlng }) {
			onPositionChange?.([latlng.lat, latlng.lng, latlng.alt])
		},
	})

	const handleDragEnd = () => {
		if (marker.current) {
			const latlng = marker.current.getLatLng()
			onPositionChange?.([latlng.lat, latlng.lng, latlng.alt])
		}
	}

	useEffect(() => {
		map.flyTo(position, map.getZoom())
	}, [position])

	return <Marker draggable eventHandlers={{ dragend: handleDragEnd }} icon={MapPinIcon} position={position} ref={marker} />
}
