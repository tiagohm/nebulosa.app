import { Api } from '@/shared/api'
import { PanZoom, type PanZoomOptions } from '@/shared/panzoom'
import { useLocalStorage } from '@uidotdev/usehooks'
import { useEffect, useRef, useState } from 'react'
import { DEFAULT_IMAGE_TRANSFORMATION, type ImageInfo, type ImageTransformation } from 'src/api/types'

export interface ImageWorkspaceProps {
	readonly paths: string[]
}

export function ImageWorkspace({ paths }: ImageWorkspaceProps) {
	const owner = useRef<HTMLDivElement>(null)

	function handleImageViewerPointerUp(e: React.PointerEvent<HTMLImageElement>) {
		const target = (e.target as HTMLImageElement).parentElement as HTMLDivElement
		const wrappers = owner.current?.querySelectorAll('div.wrapper') ?? []
		const newZIndex = wrappers.length - 1

		// Already at the top, no need to change z-index
		if (parseInt(target.style.zIndex) === newZIndex) {
			return
		}

		// Find the wrapper with the same z-index as newZIndex
		// and set it to the z-index of the clicked image viewer
		// and bring the clicked image viewer to the front
		// by setting its z-index to newZIndex
		for (const wrapper of wrappers) {
			const div = wrapper as HTMLDivElement
			const zIndex = parseInt(div.style.zIndex)

			if (zIndex === newZIndex) {
				console.log(div.style.zIndex, target.style.zIndex, zIndex, newZIndex)

				// Bring the clicked image viewer to the front
				div.style.zIndex = target.style.zIndex
				target.style.zIndex = newZIndex.toFixed(0)
				break
			}
		}
	}

	return (
		<div ref={owner} className='relative h-full w-full'>
			{paths.map((path, index) => (
				<ImageViewer key={path} path={path} index={index} owner={owner.current!} onPointerUp={handleImageViewerPointerUp} />
			))}
		</div>
	)
}

interface CachedImage {
	readonly url: string
	readonly info: ImageInfo
}

const imageCache = new Map<string, CachedImage>()

export interface ImageViewerProps {
	readonly path: string
	readonly index: number
	readonly owner: HTMLDivElement
	readonly onPointerUp?: (e: React.PointerEvent<HTMLImageElement>) => void
}

export function ImageViewer({ path, index, owner, onPointerUp }: ImageViewerProps) {
	const wrapper = useRef<HTMLDivElement>(null)
	const image = useRef<HTMLImageElement>(null)
	const [imageUrl, setImageUrl] = useState<string | undefined>(undefined)
	const panZoom = useRef<PanZoom | null>(null)
	const [transformation] = useLocalStorage<ImageTransformation>('image.transformation', DEFAULT_IMAGE_TRANSFORMATION)

	useEffect(() => {
		let isMounted = true
		const controller = new AbortController()
		let url: string | undefined

		async function loadImage() {
			if (imageCache.has(path)) {
				if (isMounted) {
					const cached = imageCache.get(path)!
					setImageUrl(cached.url)
				}

				return
			}

			try {
				const { blob, info } = await Api.Image.open({ path, transformation: transformation! }, controller)

				url = URL.createObjectURL(blob)
				setImageUrl(url)

				imageCache.set(path, { url, info })
			} catch (e) {
				console.error('failed', e)
			}
		}

		loadImage()

		return () => {
			console.info('image clean up')

			isMounted = false

			// Clean up the image element
			url && !imageCache.has(path) && URL.revokeObjectURL(url)

			// Clean up the panZoom instance
			panZoom.current?.destroy()
			panZoom.current = null

			// Abort any ongoing image loading
			controller.abort()
		}
	}, [path])

	useEffect(() => {
		const img = image.current

		if (!img || !imageUrl) return

		function handleWheel(e: WheelEvent) {
			if (e.shiftKey) {
				// this.rotateWithWheel(e)
			} else if (!e.target || e.target === owner || e.target === wrapper.current || e.target === image.current /*|| e.target === this.roi().nativeElement*/ || (e.target as HTMLElement).tagName === 'circle') {
				panZoom.current?.zoomWithWheel(e)
			}
		}

		function handleLoad() {
			panZoom.current?.destroy()

			const options: Partial<PanZoomOptions> = {
				maxScale: 500,
				canExclude: (e) => {
					return !!e.tagName && (e.classList.contains('roi') || e.classList.contains('moveable-control'))
				},
				on: (event, detail) => {
					if (event === 'panzoomzoom') {
						// this.zoom.scale = detail.transformation.scale
					}
				},
			}

			console.log('panzoom')
			panZoom.current = new PanZoom(wrapper.current!, options)

			wrapper.current!.addEventListener('wheel', handleWheel)
		}

		img.addEventListener('load', handleLoad)

		return () => {
			img.removeEventListener('load', handleLoad)
			img.removeEventListener('wheel', handleWheel)

			panZoom.current?.destroy()
			panZoom.current = null
		}
	}, [imageUrl])

	return (
		<div className='inline-block absolute wrapper' ref={wrapper} style={{ zIndex: index }}>
			<img ref={image} src={imageUrl} className='select-none shadow-md' onPointerUp={onPointerUp} />
		</div>
	)
}
