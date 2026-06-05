import { type ComponentPropsWithoutRef, type CSSProperties, type Ref, useEffect, useImperativeHandle, useRef } from 'react'
import { Celestial, type CelestialOptions } from 'src/lib/celestial/celestial'
import { tw } from '@/shared/util'

// oxfmt-ignore
export type SkyMapMethods = Pick<Celestial, 'loadStars' | 'loadConstellations' | 'loadDeepSkyObjects' | 'setObserver' | 'setTime' | 'setProjection' | 'setMagnitudeLimit' | 'setStarLabelsVisible' | 'setUpdateInterval' | 'setLayerVisible' | 'startAutoUpdate' | 'stopAutoUpdate' | 'render' | 'screenToEquatorial' | 'addShape' | 'removeShape' | 'clearShapes' | 'markShapeChanged' | 'on' | 'off'>

export interface SkyMapProps extends Omit<ComponentPropsWithoutRef<'div'>, 'children'> {
	readonly height?: CSSProperties['height']
	readonly onReady?: (celestial: Celestial) => void | VoidFunction
	readonly options?: CelestialOptions
	readonly width?: CSSProperties['width']
	readonly ref?: Ref<SkyMapMethods>
}

const DEFAULT_SKY_MAP_SIZE = 320

const DEFAULT_SKY_MAP_OPTIONS: CelestialOptions = {
	coordinateSystem: 'horizontal',
	projection: 'stereographic',
	stars: {
		colorByBV: true,
		labels: true,
		maxMagnitude: 8.5,
		sizeByMagnitude: true,
	},
	theme: {
		background: '#000000',
		stars: {
			labelColor: '#d8deca',
			labelFont: '10px system-ui, sans-serif',
			minRadius: 0.45,
			maxRadius: 1.75,
			magnitudeScale: [-1.5, 8.5],
		},
		grid: {
			color: '#6c7178',
			opacity: 0.38,
		},
		horizon: {
			color: '#1f9a41',
			fillBelowHorizon: 'rgba(0, 0, 0, 0)',
		},
		constellations: {
			color: '#b8bcc4',
			opacity: 0.72,
			labelColor: '#b9c1b6',
			labelFont: '10px system-ui, sans-serif',
		},
		deepSky: {
			color: '#ff9d00',
			labelColor: '#ffb000',
		},
		planets: {
			color: '#ffb000',
			labelColor: '#ffcc58',
		},
	},
	layers: {
		constellationBoundaries: false,
		constellationLabels: true,
		constellations: true,
		deepSky: true,
		grid: true,
		horizon: true,
		planets: false,
		shapes: true,
		stars: true,
	},
}

// Renders an interactive Celestial star-map inside a React-managed container.
export function SkyMap({ ref, className, height = DEFAULT_SKY_MAP_SIZE, onReady, options, style, width = '100%', ...props }: SkyMapProps) {
	const containerRef = useRef<HTMLDivElement | null>(null)
	const celestialRef = useRef<Celestial | null>(null)
	const onReadyCleanupRef = useRef<VoidFunction | undefined>(undefined)

	useImperativeHandle(
		ref,
		() => ({
			loadStars: (nextStars) => celestialRef.current!.loadStars(nextStars),
			loadConstellations: (data) => celestialRef.current!.loadConstellations(data),
			loadDeepSkyObjects: (objects) => celestialRef.current!.loadDeepSkyObjects(objects),
			setObserver: (nextObserver) => celestialRef.current!.setObserver(nextObserver),
			setTime: (date) => celestialRef.current!.setTime(date),
			setProjection: (projection) => celestialRef.current!.setProjection(projection),
			setMagnitudeLimit: (limit) => celestialRef.current!.setMagnitudeLimit(limit),
			setStarLabelsVisible: (visible) => celestialRef.current!.setStarLabelsVisible(visible),
			setUpdateInterval: (ms) => celestialRef.current!.setUpdateInterval(ms),
			setLayerVisible: (layerId, visible) => celestialRef.current!.setLayerVisible(layerId, visible),
			startAutoUpdate: (nextOptions) => celestialRef.current!.startAutoUpdate(nextOptions),
			stopAutoUpdate: () => celestialRef.current!.stopAutoUpdate(),
			render: () => celestialRef.current!.render(),
			screenToEquatorial: (x, y) => celestialRef.current!.screenToEquatorial(x, y),
			addShape: (shape) => celestialRef.current!.addShape(shape),
			removeShape: (id) => celestialRef.current!.removeShape(id),
			clearShapes: () => celestialRef.current!.clearShapes(),
			markShapeChanged: (id) => celestialRef.current!.markShapeChanged(id),
			on: (eventName, callback) => celestialRef.current!.on(eventName, callback),
			off: (eventName, callback) => celestialRef.current!.off(eventName, callback),
		}),
		[],
	)

	useEffect(() => {
		const container = containerRef.current

		if (!container) {
			return
		}

		const size = readContainerSize(container)
		const celestial = new Celestial(container, createCelestialOptions(options, size.width, size.height))
		celestialRef.current = celestial
		const onReadyResult = onReady?.(celestial)
		if (onReady === undefined) celestial.queueRun()
		onReadyCleanupRef.current = typeof onReadyResult === 'function' ? onReadyResult : undefined

		const resizeObserver = new ResizeObserver(([entry]) => {
			if (!entry) return
			const nextWidth = Math.max(1, Math.round(entry.contentRect.width))
			const nextHeight = Math.max(1, Math.round(entry.contentRect.height))
			celestial.resize(nextWidth, nextHeight)
		})

		resizeObserver.observe(container)

		return () => {
			resizeObserver.disconnect()
			onReadyCleanupRef.current?.()
			onReadyCleanupRef.current = undefined
			celestial.destroy()
			celestialRef.current = null
		}
	}, [])

	return <div {...props} className={tw('relative overflow-hidden rounded-lg bg-neutral-950', className)} ref={containerRef} style={{ height, width, ...style }} />
}

// Combines default, caller, and measured sizing options for the Celestial instance.
function createCelestialOptions(options: CelestialOptions | undefined, width: number, height: number): CelestialOptions {
	return {
		...DEFAULT_SKY_MAP_OPTIONS,
		...options,
		width,
		height,
		projection: options?.projection ?? DEFAULT_SKY_MAP_OPTIONS.projection,
		stars: {
			...DEFAULT_SKY_MAP_OPTIONS.stars,
			...options?.stars,
			maxMagnitude: options?.stars?.maxMagnitude ?? DEFAULT_SKY_MAP_OPTIONS.stars?.maxMagnitude,
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
	} as const
}
