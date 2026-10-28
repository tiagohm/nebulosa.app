import type { MoonAppearance } from 'api'
import { cn } from 'cn'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import type { ViewTransform } from '../celestial/types'
import { type DiscViewport, discViewport, type MoonViewUp, viewMatrix } from './moon.geometry'
import { MoonRenderer } from './moon.renderer'

// Moon drawing of the Moon Inspector: a canvas sized to its container on which MoonRenderer draws the textured,
// sunlit Moon of an appearance, zoomed and panned by a view transform, and an overlay (children) laid over it with
// the same viewport. Color maps are bundled assets, decoded once per URL and kept for the tab.

// Decoded color maps by URL.
const images = new Map<string, Promise<HTMLImageElement>>()

// Returns the decoded color map of a URL, loading it on the first call.
function loadImage(url: string) {
	let image = images.get(url)

	if (!image) {
		const element = new Image()
		element.src = url
		image = element.decode().then(() => element)
		image.catch(() => images.delete(url))
		images.set(url, image)
	}

	return image
}

export interface MoonCanvasProps {
	// Appearance drawn.
	readonly appearance: MoonAppearance
	// Which direction is up.
	readonly up: MoonViewUp
	// URL of the color map.
	readonly texture: string
	// Zoom and pan of the disk; centered at zoom 1 when absent.
	readonly transform?: Readonly<ViewTransform>
	// Whether the drawing is faded, while a newer appearance loads.
	readonly faded?: boolean
	readonly className?: string
	// Called with the viewport whenever the drawing's size or transform changes.
	readonly onViewport?: (viewport: DiscViewport) => void
	// Overlay drawn over the Moon, in the same CSS pixels as the viewport.
	readonly children?: ReactNode
}

// Moon drawing.
export function MoonCanvas({ appearance, up, texture, transform, faded, className, onViewport, children }: MoonCanvasProps) {
	const container = useRef<HTMLDivElement>(null)
	const canvas = useRef<HTMLCanvasElement>(null)
	const renderer = useRef<MoonRenderer>(undefined)
	const [size, setSize] = useState<readonly [number, number]>([0, 0])
	const [error, setError] = useState<string>()

	// Creates the renderer of the canvas and follows the size of the container.
	useEffect(() => {
		const element = container.current!
		renderer.current = new MoonRenderer(canvas.current!)
		const observer = new ResizeObserver(([entry]) => setSize([entry.contentRect.width, entry.contentRect.height]))
		observer.observe(element)

		return () => {
			observer.disconnect()
			renderer.current?.dispose()
			renderer.current = undefined
		}
	}, [])

	// Loads the color map; a failure leaves the previous one drawn and says so.
	useEffect(() => {
		let current = true

		loadImage(texture).then(
			(image) => current && renderer.current?.setTexture(image),
			() => current && setError('The Moon image could not be loaded.'),
		)

		return () => {
			current = false
		}
	}, [texture])

	const [width, height] = size
	const viewport = discViewport(width, height, transform)

	// Draws a frame whenever the appearance, the orientation, the size, or the transform changes.
	useEffect(() => {
		if (width === 0 || height === 0) return
		renderer.current?.render({ view: viewMatrix(appearance, up), sun: appearance.sunDirection, viewport, pixelRatio: window.devicePixelRatio || 1 })
		onViewport?.(viewport)
	}, [appearance, up, width, height, transform?.x, transform?.y, transform?.k])

	return (
		<div ref={container} className={cn('relative overflow-hidden', className)}>
			<canvas ref={canvas} className={cn('absolute inset-0 size-full transition-opacity duration-150', faded && 'opacity-60')} />
			{children}
			{error && <p className="absolute inset-x-0 bottom-0 m-0 text-center text-xs text-danger">{error}</p>}
		</div>
	)
}
