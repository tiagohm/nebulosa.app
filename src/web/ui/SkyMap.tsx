import { type ComponentProps, type CSSProperties, useEffect, useRef } from 'react'
import Celestial, { type AutoUpdateOptions, type CelestialEventName, type CelestialOptions, type ConstellationData, type DeepSkyObject, type ObserverLocation, type ProjectionType, type Star, type StarCatalogInput } from 'src/lib/celestial/celestial'
import { tw } from '@/shared/util'

export interface SkyMapProps extends Omit<ComponentProps<'div'>, 'children'> {
	readonly autoUpdate?: boolean | AutoUpdateOptions
	readonly constellations?: ConstellationData
	readonly deepSkyObjects?: DeepSkyObject[]
	readonly height?: CSSProperties['height']
	readonly magnitudeLimit?: number
	readonly observer?: ObserverLocation
	readonly onCelestialEvent?: (eventName: CelestialEventName, payload: unknown) => void
	readonly onReady?: (celestial: Celestial) => void | (() => void)
	readonly options?: CelestialOptions
	readonly projection?: ProjectionType
	readonly stars?: Star[] | StarCatalogInput
	readonly time?: Date
	readonly width?: CSSProperties['width']
}

const CELESTIAL_EVENT_NAMES: CelestialEventName[] = ['objectClick', 'objectHover', 'objectLeave', 'selectionChange', 'renderStart', 'renderEnd', 'updateStart', 'updateEnd', 'resize', 'error']

const DEFAULT_OBSERVER: ObserverLocation = {
	latitude: 0,
	longitude: 0,
	elevation: 0,
}

const DEFAULT_SKY_MAP_SIZE = 320

const DEFAULT_SKY_MAP_OPTIONS: CelestialOptions = {
	coordinateSystem: 'horizontal',
	observer: DEFAULT_OBSERVER,
	projection: 'azimuthalEquidistant',
	stars: {
		colorByBV: true,
		maxMagnitude: 8,
		sizeByMagnitude: true,
	},
	layers: {
		constellationLabels: true,
		constellations: true,
		debug: false,
		deepSky: true,
		grid: true,
		horizon: true,
		planets: false,
		stars: true,
	},
}

// Renders an interactive Celestial star-map inside a React-managed container.
export function SkyMap({ autoUpdate, className, constellations, deepSkyObjects, height = DEFAULT_SKY_MAP_SIZE, magnitudeLimit, observer, onCelestialEvent, onReady, options, projection, stars, style, time, width = '100%', ...props }: SkyMapProps) {
	const containerRef = useRef<HTMLDivElement | null>(null)
	const celestialRef = useRef<Celestial | null>(null)
	const onReadyCleanupRef = useRef<(() => void) | undefined>(undefined)
	const effectiveMagnitudeLimit = magnitudeLimit ?? options?.stars?.maxMagnitude
	const effectiveObserver = observer ?? options?.observer
	const effectiveProjection = projection ?? options?.projection
	const effectiveTime = time ?? options?.time

	useEffect(() => {
		const container = containerRef.current

		if (!container) {
			return
		}

		const size = readContainerSize(container)
		const celestial = new Celestial(container, createCelestialOptions(options, size.width, size.height, effectiveObserver, effectiveTime, effectiveProjection, effectiveMagnitudeLimit))
		celestialRef.current = celestial
		const onReadyResult = onReady?.(celestial)
		onReadyCleanupRef.current = typeof onReadyResult === 'function' ? onReadyResult : undefined

		const resizeObserver = new ResizeObserver(([entry]) => {
			if (!entry) {
				return
			}

			const nextWidth = Math.max(1, Math.round(entry.contentRect.width))
			const nextHeight = Math.max(1, Math.round(entry.contentRect.height))
			celestial.resize(nextWidth, nextHeight)
		})

		resizeObserver.observe(container)

		return () => {
			resizeObserver.disconnect()
			if (onReadyCleanupRef.current) {
				onReadyCleanupRef.current()
			}
			onReadyCleanupRef.current = undefined
			celestial.destroy()
			celestialRef.current = null
		}
	}, [])

	useEffect(() => {
		celestialRef.current?.loadStars(stars ?? [])
	}, [stars])

	useEffect(() => {
		celestialRef.current?.loadConstellations(constellations ?? {})
	}, [constellations])

	useEffect(() => {
		celestialRef.current?.loadDeepSkyObjects(deepSkyObjects ?? [])
	}, [deepSkyObjects])

	useEffect(() => {
		if (effectiveObserver) {
			celestialRef.current?.setObserver(effectiveObserver)
		}
	}, [effectiveObserver])

	useEffect(() => {
		if (effectiveTime) {
			celestialRef.current?.setTime(effectiveTime)
		}
	}, [effectiveTime])

	useEffect(() => {
		if (effectiveProjection) {
			celestialRef.current?.setProjection(effectiveProjection)
		}
	}, [effectiveProjection])

	useEffect(() => {
		if (effectiveMagnitudeLimit !== undefined) {
			celestialRef.current?.setMagnitudeLimit(effectiveMagnitudeLimit)
		}
	}, [effectiveMagnitudeLimit])

	useEffect(() => {
		if (options?.updateInterval !== undefined) {
			celestialRef.current?.setUpdateInterval(options.updateInterval)
		}
	}, [options?.updateInterval])

	useEffect(() => {
		for (const [layerId, visible] of Object.entries(options?.layers ?? {})) {
			if (typeof visible === 'boolean') {
				celestialRef.current?.setLayerVisible(layerId, visible)
			}
		}
	}, [options?.layers])

	useEffect(() => {
		const celestial = celestialRef.current

		if (!celestial) {
			return
		}

		if (autoUpdate) {
			celestial.startAutoUpdate(typeof autoUpdate === 'object' ? autoUpdate : undefined)
		} else {
			celestial.stopAutoUpdate()
		}

		return () => celestial.stopAutoUpdate()
	}, [autoUpdate])

	useEffect(() => {
		if (!onCelestialEvent) {
			return
		}

		const celestial = celestialRef.current
		if (!celestial) {
			return
		}

		const unsubscribers = CELESTIAL_EVENT_NAMES.map((eventName) => celestial.on(eventName, (payload) => onCelestialEvent(eventName, payload)))
		return () => {
			for (const unsubscribe of unsubscribers) {
				unsubscribe()
			}
		}
	}, [onCelestialEvent])

	return <div {...props} className={tw('relative overflow-hidden rounded-lg bg-neutral-950', className)} ref={containerRef} style={{ height, width, ...style }} />
}

// Combines default, caller, and measured sizing options for the Celestial instance.
function createCelestialOptions(options: CelestialOptions | undefined, width: number, height: number, observer?: ObserverLocation, time?: Date, projection?: ProjectionType, magnitudeLimit?: number): CelestialOptions {
	return {
		...DEFAULT_SKY_MAP_OPTIONS,
		...options,
		width,
		height,
		observer: observer ?? options?.observer ?? DEFAULT_OBSERVER,
		time: time ?? options?.time,
		projection: projection ?? options?.projection ?? DEFAULT_SKY_MAP_OPTIONS.projection,
		stars: {
			...DEFAULT_SKY_MAP_OPTIONS.stars,
			...options?.stars,
			maxMagnitude: magnitudeLimit ?? options?.stars?.maxMagnitude ?? DEFAULT_SKY_MAP_OPTIONS.stars?.maxMagnitude,
		},
		layers: {
			...DEFAULT_SKY_MAP_OPTIONS.layers,
			...options?.layers,
		},
	}
}

// Reads the currently laid out container size with a safe initial fallback.
function readContainerSize(container: HTMLElement) {
	const rect = container.getBoundingClientRect()

	return {
		width: Math.max(1, Math.round(rect.width || container.clientWidth || DEFAULT_SKY_MAP_SIZE)),
		height: Math.max(1, Math.round(rect.height || container.clientHeight || DEFAULT_SKY_MAP_SIZE)),
	}
}
