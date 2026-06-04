import { Icon, latLng, type LatLngExpression, type LatLngTuple, type Marker as LeafletMarker } from 'leaflet'
import { type CSSProperties, useEffect, useMemo, useRef } from 'react'
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import mapIconSvg from '../assets/map-pin.svg'

export interface MapViewerProps extends React.ComponentProps<'div'> {
	readonly width?: CSSProperties['width']
	readonly height?: CSSProperties['height']
	readonly position?: LatLngExpression
	readonly zoom?: number
	readonly onPositionChange?: (position: LatLngTuple) => void
}

export function MapViewer({ position = [0, 0], zoom = 5, width = 200, height = 200, onPositionChange, ...props }: MapViewerProps) {
	return (
		<div {...props}>
			<MapContainer center={position} className="rounded" doubleClickZoom={false} style={{ height, width }} zoom={zoom} zoomControl={false}>
				<TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
				<MapResizeObserver />
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

function toLatLngTuple({ lat, lng, alt }: { readonly lat: number; readonly lng: number; readonly alt?: number }): LatLngTuple {
	return [lat, lng, alt]
}

function MapResizeObserver() {
	const map = useMap()

	useEffect(() => {
		const container = map.getContainer()
		let animationFrame: number | undefined

		function invalidateSize() {
			if (animationFrame !== undefined) {
				window.cancelAnimationFrame(animationFrame)
			}

			animationFrame = window.requestAnimationFrame(() => {
				animationFrame = undefined
				map.invalidateSize()
			})
		}

		invalidateSize()

		const observer = new ResizeObserver(invalidateSize)
		observer.observe(container)

		return () => {
			observer.disconnect()

			if (animationFrame !== undefined) {
				window.cancelAnimationFrame(animationFrame)
			}
		}
	}, [map])

	return null
}

export function DraggableMarker({ position, onPositionChange }: DraggableMarkerProps) {
	const marker = useRef<LeafletMarker>(null)

	const map = useMapEvents({
		click({ latlng }) {
			onPositionChange?.(toLatLngTuple(latlng))
		},
	})

	const eventHandlers = useMemo(
		() => ({
			dragend() {
				const latlng = marker.current?.getLatLng()
				if (latlng) onPositionChange?.(toLatLngTuple(latlng))
			},
		}),
		[onPositionChange],
	)

	useEffect(() => {
		const center = map.getCenter()
		const nextCenter = latLng(position)

		if (Math.abs(center.lat - nextCenter.lat) < 1e-9 && Math.abs(center.lng - nextCenter.lng) < 1e-9) {
			return
		}

		map.flyTo(nextCenter, map.getZoom())
	}, [map, position])

	return <Marker draggable eventHandlers={eventHandlers} icon={MapPinIcon} position={position} ref={marker} />
}
