import { Api } from '@/shared/api'
import { useMutativeLocalStorage } from '@/shared/hooks'
import { PanZoom, type PanZoomOptions } from '@/shared/panzoom'
import { stopPropagation } from '@/shared/utils'
import { Spacer, Switch, cn } from '@heroui/react'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuPortal, ContextMenuSeparator, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger, ContextMenuTrigger } from '@radix-ui/react-context-menu'
import * as Lucide from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { ImageInfo, ImageTransformation } from 'src/api/types'
import { DEFAULT_IMAGE_TRANSFORMATION } from 'src/api/types'
import { Crosshair } from './Crosshair'
import type { Image } from './Home'

export type ImageViewerActionType = 'h-mirror' | 'v-mirror'

interface CachedImage {
	url: string
	info: ImageInfo
	readonly panZoom: PanZoom
	readonly close: () => void
}

export interface ImageViewerProps {
	readonly image: Image
	readonly owner: HTMLDivElement
	readonly onPointerUp?: (e: React.PointerEvent<HTMLImageElement>) => void
	readonly onClose?: () => void
}

export interface ImageViewerState {
	transformation: ImageTransformation
	crosshair: boolean
}

const DEFAULT_IMAGE_VIEWER_STATE: ImageViewerState = {
	transformation: DEFAULT_IMAGE_TRANSFORMATION,
	crosshair: false,
}

const imageMap = new Map<string, CachedImage>()

export function ImageViewer({ image: { key, path, index }, owner, onPointerUp, onClose }: ImageViewerProps) {
	const wrapper = useRef<HTMLDivElement>(null)
	const image = useRef<HTMLImageElement>(null)
	const [state, setState] = useMutativeLocalStorage<ImageViewerState>('image.state', DEFAULT_IMAGE_VIEWER_STATE)

	useEffect(() => {
		let isMounted = true
		const controller = new AbortController()
		let url: string | undefined

		async function load() {
			if (imageMap.has(key)) {
				if (image.current && isMounted) {
					console.info('image loaded from cache', key)
					const entry = imageMap.get(key)!
					image.current.src = entry.url
				}

				return
			}

			url = await openImage(state!.transformation, controller)
		}

		load()

		return () => {
			console.info('image clean up', key)

			isMounted = false

			// Clean up the image element
			url && URL.revokeObjectURL(url)

			// Abort any ongoing image loading
			controller.abort()
		}
	}, [path])

	useEffect(() => {
		return () => {
			console.info('image unref')
			imageMap.get(key)?.close()
			imageMap.delete(key)
		}
	}, [image])

	async function openImage(transformation: ImageTransformation, controller?: AbortController) {
		try {
			console.info('opening image', key)

			const { blob, info } = await Api.Image.open({ path, transformation }, controller)

			const url = URL.createObjectURL(blob)
			image.current!.src = url

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

			const cached = imageMap.get(key)

			if (!cached) {
				console.info('image PanZoom created', key)

				const imageWrapper = wrapper.current!

				const panZoom = new PanZoom(imageWrapper, options, owner)

				function handleWheel(e: WheelEvent) {
					if (e.shiftKey) {
						// this.rotateWithWheel(e)
					} else if (!e.target || e.target === owner || e.target === imageWrapper || e.target === image.current /*|| e.target === this.roi().nativeElement*/ || (e.target as HTMLElement).tagName === 'circle') {
						panZoom.zoomWithWheel(e)
					}
				}

				imageWrapper.addEventListener('wheel', handleWheel)

				function close() {
					panZoom.destroy()
					imageWrapper.removeEventListener('wheel', handleWheel)
				}

				imageMap.set(key, { url, info, panZoom, close })
			} else {
				cached.url = url
				cached.info = info
			}

			return url
		} catch (e) {
			console.error('failed to open image')
		}
	}

	function updateImageTransformationAndOpen(action: (transformation: ImageTransformation) => void) {
		let open = false

		setState((s) => {
			action(s.transformation)

			if (!open) {
				open = true
				openImage(s.transformation)
			}
		})
	}

	function handleHorizontalMirror() {
		updateImageTransformationAndOpen((t) => void (t.horizontalMirror = !t.horizontalMirror))
	}

	function handleVerticalMirror() {
		updateImageTransformationAndOpen((t) => void (t.verticalMirror = !t.verticalMirror))
	}

	function handleInvert() {
		updateImageTransformationAndOpen((t) => void (t.invert = !t.invert))
	}

	function handleCrosshair() {
		setState((d) => void (d.crosshair = !d.crosshair))
	}

	return (
		<ContextMenu>
			<ContextMenuTrigger className='block' onContextMenu={(e) => console.info(e, e.nativeEvent.offsetX)}>
				<div className='inline-block absolute wrapper' ref={wrapper} style={{ zIndex: index }}>
					<img ref={image} className='image select-none shadow-md' onPointerUp={onPointerUp} />
					{state.crosshair && <Crosshair />}
				</div>
			</ContextMenuTrigger>
			<ContextMenuContent>
				<ContextMenuItem>
					<Lucide.Save size={16} /> Save...
				</ContextMenuItem>
				<ContextMenuSeparator />
				<ContextMenuItem>
					<Lucide.Sigma size={16} /> Plate Solver
				</ContextMenuItem>
				<ContextMenuItem>
					<Lucide.ChartColumnDecreasing size={16} /> Stretch
				</ContextMenuItem>
				<ContextMenuItem>
					<Lucide.WandSparkles size={16} /> Auto Stretch
				</ContextMenuItem>
				<ContextMenuItem>
					<Lucide.Blend size={16} /> SCNR
				</ContextMenuItem>
				<ContextMenuItem>
					<Lucide.Grid3X3 size={16} /> Debayer
				</ContextMenuItem>
				<ContextMenuSub>
					<ContextMenuSubTrigger>
						<Lucide.Palette size={16} /> Transformation
						<Lucide.ChevronRight size={16} />
					</ContextMenuSubTrigger>
					<ContextMenuPortal>
						<ContextMenuSubContent>
							<ContextMenuItem>
								<Lucide.Palette size={16} /> Adjustment
							</ContextMenuItem>
							<ContextMenuItem className={cn({ selected: state.transformation.horizontalMirror })} onPointerUp={handleHorizontalMirror}>
								<Lucide.FlipHorizontal size={16} /> Horizontal Mirror
							</ContextMenuItem>
							<ContextMenuItem className={cn({ selected: state.transformation.verticalMirror })} onPointerUp={handleVerticalMirror}>
								<Lucide.FlipVertical size={16} /> Vertical Mirror
							</ContextMenuItem>
							<ContextMenuItem className={cn({ selected: state.transformation.invert })} onPointerUp={handleInvert}>
								<Lucide.Image size={16} /> Invert
							</ContextMenuItem>
							<ContextMenuItem>
								<Lucide.RotateCw size={16} /> Rotate
							</ContextMenuItem>
						</ContextMenuSubContent>
					</ContextMenuPortal>
				</ContextMenuSub>
				<ContextMenuSeparator />
				<ContextMenuSub>
					<ContextMenuSubTrigger>
						<Lucide.BringToFront size={16} /> Overlay
						<Lucide.ChevronRight size={16} />
					</ContextMenuSubTrigger>
					<ContextMenuPortal>
						<ContextMenuSubContent>
							<ContextMenuItem className={cn({ selected: state.crosshair })} onPointerUp={handleCrosshair}>
								<Lucide.Crosshair size={16} /> Crosshair
							</ContextMenuItem>
							<ContextMenuItem>
								<Lucide.Pen size={16} /> Annotation
								<Spacer className='flex-1' />
								<Switch size='sm' className='flex-1' onPointerUp={stopPropagation} />
							</ContextMenuItem>
							<ContextMenuItem>
								<Lucide.Stars size={16} /> Star Detection
								<Spacer className='flex-1' />
								<Switch size='sm' className='flex-1' onPointerUp={stopPropagation} />
							</ContextMenuItem>
							<ContextMenuItem>
								<Lucide.Crop size={16} /> ROI
								<Spacer className='flex-1' />
								<Switch size='sm' className='flex-1' onPointerUp={stopPropagation} />
							</ContextMenuItem>
							<ContextMenuItem>
								<Lucide.Scan size={16} /> FOV
								<Spacer className='flex-1' />
								<Switch size='sm' className='flex-1' onPointerUp={stopPropagation} />
							</ContextMenuItem>
						</ContextMenuSubContent>
					</ContextMenuPortal>
				</ContextMenuSub>
				<ContextMenuItem>
					<Lucide.ChartNoAxesColumnIncreasing size={16} /> Statistics
				</ContextMenuItem>
				<ContextMenuItem>
					<Lucide.List size={16} /> FITS Header
				</ContextMenuItem>
				<ContextMenuSeparator />
				<ContextMenuItem>
					<Lucide.Telescope size={16} /> Point mount here
				</ContextMenuItem>
				<ContextMenuItem>
					<Lucide.Frame size={16} /> Frame at this coordinate
				</ContextMenuItem>
				<ContextMenuSeparator />
				<ContextMenuItem className='danger' onPointerUp={onClose}>
					<Lucide.X size={16} /> Close
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	)
}
