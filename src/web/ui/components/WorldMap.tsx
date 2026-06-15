import { memo, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import worldMapSvg from 'src/data/world.map.svg'
import { type ClassValue, tv, type VariantProps } from 'tailwind-variants'
import { clamp, tw } from '@/shared/util'
import { type InteractableMethods, type InteractableProps, type InteractTransform, type InteractType, Interactable } from '../Interactable'

export const WORLD_MAP_WIDTH = 2520.631
export const WORLD_MAP_HEIGHT = 1260.315
export const WORLD_MAP_VIEW_BOX = `0 0 ${WORLD_MAP_WIDTH} ${WORLD_MAP_HEIGHT}`

const WORLD_MAP_ASPECT_RATIO = WORLD_MAP_WIDTH / WORLD_MAP_HEIGHT
const ZERO_SURFACE_SIZE = { height: 0, width: 0 } as const

const worldMapStyles = tv({
	slots: {
		base: 'relative aspect-2/1 w-full overflow-hidden rounded-lg bg-neutral-950 select-none',
		map: 'block max-w-none touch-none select-none',
		image: 'pointer-events-none select-none',
		overlay: 'pointer-events-none',
	},
	variants: {
		bordered: {
			true: {
				base: 'border border-neutral-800',
			},
		},
	},
	defaultVariants: {
		bordered: false,
	},
})

type WorldMapVariants = VariantProps<typeof worldMapStyles>
type InteractableClickState = Parameters<NonNullable<InteractableProps['onClick']>>[0]
type InteractableMoveState = Parameters<NonNullable<InteractableProps['onMouseMove']>>[0]

interface WorldMapSurfaceSize {
	readonly width: number
	readonly height: number
}

export interface WorldMapPoint {
	readonly x: number
	readonly y: number
}

export interface WorldMapCoordinate {
	readonly latitude: number
	readonly longitude: number
}

export interface WorldMapPosition extends WorldMapPoint, WorldMapCoordinate {}

export interface WorldMapMethods {
	readonly center: VoidFunction
	readonly zoomTo: (scale: number) => void
	readonly pointToCoordinate: (point: WorldMapPoint) => WorldMapCoordinate
	readonly coordinateToPoint: (coordinate: WorldMapCoordinate) => WorldMapPoint
}

export interface WorldMapClassNames {
	readonly base?: ClassValue
	readonly map?: ClassValue
	readonly image?: ClassValue
	readonly overlay?: ClassValue
}

export interface WorldMapProps extends Omit<React.ComponentPropsWithRef<'div'>, 'children' | 'ref'>, WorldMapVariants {
	readonly children?: React.ReactNode
	readonly classNames?: WorldMapClassNames
	readonly defaultScale?: number
	readonly centerOnResize?: boolean
	readonly zIndex?: number
	readonly onCoordinateClick?: (position: WorldMapPosition, event: MouseEvent) => void
	readonly onCoordinateMove?: (position: WorldMapPosition, event: MouseEvent) => void
	readonly onTransformChange?: InteractableProps['onGesture']
	readonly ref?: React.Ref<WorldMapMethods>
}

function normalizeLongitude(longitude: number) {
	if (!Number.isFinite(longitude)) return 0
	if (longitude === 180 || longitude === -180) return longitude
	return ((((longitude + 180) % 360) + 360) % 360) - 180
}

export function worldMapPointToCoordinate(point: WorldMapPoint): WorldMapCoordinate {
	const x = clamp(point.x, 0, WORLD_MAP_WIDTH)
	const y = clamp(point.y, 0, WORLD_MAP_HEIGHT)

	return {
		longitude: (x / WORLD_MAP_WIDTH) * 360 - 180,
		latitude: 90 - (y / WORLD_MAP_HEIGHT) * 180,
	}
}

export function worldMapCoordinateToPoint(coordinate: WorldMapCoordinate): WorldMapPoint {
	const latitude = clamp(coordinate.latitude, -90, 90)
	const longitude = normalizeLongitude(coordinate.longitude)

	return {
		x: ((longitude + 180) / 360) * WORLD_MAP_WIDTH,
		y: ((90 - latitude) / 180) * WORLD_MAP_HEIGHT,
	}
}

function worldMapPositionFromPoint(point: WorldMapPoint): WorldMapPosition {
	return Object.assign(worldMapPointToCoordinate(point), point)
}

function measureSurfaceSize(root: HTMLDivElement): WorldMapSurfaceSize {
	const width = root.clientWidth
	const height = root.clientHeight

	if (width <= 0 && height <= 0) return ZERO_SURFACE_SIZE
	if (width <= 0) return { width: height * WORLD_MAP_ASPECT_RATIO, height }
	if (height <= 0) return { width, height: width / WORLD_MAP_ASPECT_RATIO }

	return width / height > WORLD_MAP_ASPECT_RATIO ? { width: height * WORLD_MAP_ASPECT_RATIO, height } : { width, height: width / WORLD_MAP_ASPECT_RATIO }
}

function worldMapPositionFromClientPoint(map: SVGSVGElement, clientX: number, clientY: number) {
	const rect = map.getBoundingClientRect()

	if (rect.width <= 0 || rect.height <= 0) return

	return worldMapPositionFromPoint({
		x: clamp(((clientX - rect.left) / rect.width) * WORLD_MAP_WIDTH, 0, WORLD_MAP_WIDTH),
		y: clamp(((clientY - rect.top) / rect.height) * WORLD_MAP_HEIGHT, 0, WORLD_MAP_HEIGHT),
	})
}

export const WorldMap = memo(({ bordered, centerOnResize = false, children, className, classNames, defaultScale = 1, onCoordinateClick, onCoordinateMove, onTransformChange, onWheelCapture, ref, style, zIndex = 0, ...props }: WorldMapProps) => {
	const rootRef = useRef<HTMLDivElement>(null)
	const mapRef = useRef<SVGSVGElement>(null)
	const interactableRef = useRef<InteractableMethods>(null)
	const initialized = useRef(false)
	const userTransformed = useRef(false)
	const [surfaceSize, setSurfaceSize] = useState<WorldMapSurfaceSize>(ZERO_SURFACE_SIZE)
	const styles = worldMapStyles({ bordered })

	useImperativeHandle(
		ref,
		() => ({
			center: () => {
				interactableRef.current?.center()
			},
			zoomTo: (scale) => {
				interactableRef.current?.zoomTo(scale)
			},
			pointToCoordinate: worldMapPointToCoordinate,
			coordinateToPoint: worldMapCoordinateToPoint,
		}),
		[],
	)

	useLayoutEffect(() => {
		const root = rootRef.current
		if (root === null) return

		const observedRoot = root

		function updateSurfaceSize() {
			const next = measureSurfaceSize(observedRoot)

			setSurfaceSize((previous) => (previous.width === next.width && previous.height === next.height ? previous : next))
		}

		updateSurfaceSize()

		const observer = new ResizeObserver(updateSurfaceSize)
		observer.observe(observedRoot)
		window.addEventListener('resize', updateSurfaceSize)

		return () => {
			observer.disconnect()
			window.removeEventListener('resize', updateSurfaceSize)
		}
	}, [])

	useLayoutEffect(() => {
		if (surfaceSize.width <= 0 || surfaceSize.height <= 0) return

		const interactable = interactableRef.current
		if (interactable === null) return

		if (!initialized.current) {
			interactable.zoomTo(defaultScale)
			initialized.current = true
		}

		if (!userTransformed.current || centerOnResize) {
			interactable.center()
		}
	}, [centerOnResize, defaultScale, surfaceSize])

	function handleTransformChange(transform: Readonly<InteractTransform>, type: InteractType, event?: Event) {
		if (type !== 'none') userTransformed.current = true

		// World maps should stay north-up; Interactable still supports generic rotation.
		if (transform.angle !== 0) {
			interactableRef.current?.rotateTo(0)
			onTransformChange?.({ ...transform, angle: 0 }, type, event)
		} else {
			onTransformChange?.(transform, type, event)
		}
	}

	function handleCoordinateClick({ event, dragging, pinching }: InteractableClickState) {
		if (dragging || pinching) return
		const map = mapRef.current
		const position = map && worldMapPositionFromClientPoint(map, event.clientX, event.clientY)
		if (position) onCoordinateClick!(position, event)
	}

	function handleCoordinateMove({ event, dragging, pinching }: InteractableMoveState) {
		if (dragging || pinching) return
		const map = mapRef.current
		const position = map && worldMapPositionFromClientPoint(map, event.clientX, event.clientY)
		if (position) onCoordinateMove!(position, event)
	}

	function handleWheelCapture(event: React.WheelEvent<HTMLDivElement>) {
		onWheelCapture?.(event)

		if (!event.defaultPrevented && event.shiftKey) {
			event.preventDefault()
			event.stopPropagation()
		}
	}

	return (
		<div {...props} className={tw(styles.base(), className, classNames?.base)} onWheelCapture={handleWheelCapture} ref={rootRef} style={style}>
			<Interactable onClick={onCoordinateClick && handleCoordinateClick} onGesture={handleTransformChange} onMouseMove={onCoordinateMove && handleCoordinateMove} ref={interactableRef} zIndex={zIndex}>
				<svg className={tw(styles.map(), classNames?.map)} height={surfaceSize.height} preserveAspectRatio="xMidYMid meet" ref={mapRef} style={{ height: surfaceSize.height, width: surfaceSize.width }} viewBox={WORLD_MAP_VIEW_BOX} width={surfaceSize.width}>
					<image className={tw(styles.image(), classNames?.image)} height={WORLD_MAP_HEIGHT} href={worldMapSvg} width={WORLD_MAP_WIDTH} x={0} y={0} />
					<g className={tw(styles.overlay(), classNames?.overlay)}>{children}</g>
				</svg>
			</Interactable>
		</div>
	)
})
