import { Api } from '@/shared/api'
import { PanZoom, type PanZoomOptions } from '@/shared/panzoom'
import { simpleLocalStorage } from '@/shared/storage'
import type { Image } from '@/shared/types'
import { stopPropagation } from '@/shared/utils'
import { type HomeState, homeState } from '@/stores/home'
import { Spacer, Switch, cn } from '@heroui/react'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuPortal, ContextMenuSeparator, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger, ContextMenuTrigger } from '@radix-ui/react-context-menu'
import * as Lucide from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { ImageInfo } from 'src/api/types'
import { Crosshair } from './Crosshair'

interface CachedImage {
	url: string
	info: ImageInfo
	readonly panZoom: PanZoom
	readonly close: () => void
}

export interface ImageViewerProps {
	readonly image: Image
}

const imageMap = new Map<string, CachedImage>()

export function ImageViewer({ image: { key, path, transformation, index } }: ImageViewerProps) {
	const image = useRef<HTMLImageElement>(null)

	useEffect(() => {
		let isMounted = true
		const controller = new AbortController()
		let url: string | undefined

		async function load() {
			if (imageMap.has(key)) {
				if (image.current && isMounted) {
					console.info('image from cache', key)
					const entry = imageMap.get(key)!
					image.current.src = entry.url
				}

				return
			}

			url = await open(controller)
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
			console.info('image unref', key)
			imageMap.get(key)?.close()
			imageMap.delete(key)
		}
	}, [image])

	async function open(controller?: AbortController) {
		try {
			console.info('opening image', key)
			const { blob, info } = await Api.Image.open({ path, transformation: homeState.images[key].transformation }, controller)

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

				const wrapper = image.current!.closest('.wrapper') as HTMLElement
				const workspace = image.current!.closest('.workspace') as HTMLElement
				const panZoom = new PanZoom(wrapper, options, workspace)

				function handleWheel(e: WheelEvent) {
					if (e.shiftKey) {
						// this.rotateWithWheel(e)
					} else if (!e.target || e.target === workspace || e.target === wrapper || e.target === image.current /*|| e.target === this.roi().nativeElement*/ || (e.target as HTMLElement).tagName === 'circle') {
						panZoom.zoomWithWheel(e)
					}
				}

				wrapper.addEventListener('wheel', handleWheel)

				function close() {
					panZoom.destroy()
					wrapper.removeEventListener('wheel', handleWheel)
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

	function transformImageAndOpen(name: keyof HomeState['images'][string]['transformation'], value?: unknown) {
		const transformation = homeState.images[key].transformation

		try {
			if (name === 'horizontalMirror') transformation.horizontalMirror = !transformation.horizontalMirror
			else if (name === 'verticalMirror') transformation.verticalMirror = !transformation.verticalMirror
			else if (name === 'invert') transformation.invert = !transformation.invert
			else {
				if (name === 'crosshair') transformation.crosshair = !transformation.crosshair
				return
			}
		} finally {
			simpleLocalStorage.set('image.transformation', transformation)
		}

		open()
	}

	function close() {
		delete homeState.images[key]
	}

	return (
		<ContextMenu>
			<ContextMenuTrigger className='block' onContextMenu={(e) => console.info(e, e.nativeEvent.offsetX)}>
				<div className='inline-block absolute wrapper' style={{ zIndex: index }}>
					<img ref={image} className='image select-none shadow-md' onPointerUp={bringToFront} />
					{transformation.crosshair && <Crosshair />}
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
							<ContextMenuItem className={cn({ selected: transformation.horizontalMirror })} onPointerUp={() => transformImageAndOpen('horizontalMirror')}>
								<Lucide.FlipHorizontal size={16} /> Horizontal Mirror
							</ContextMenuItem>
							<ContextMenuItem className={cn({ selected: transformation.verticalMirror })} onPointerUp={() => transformImageAndOpen('verticalMirror')}>
								<Lucide.FlipVertical size={16} /> Vertical Mirror
							</ContextMenuItem>
							<ContextMenuItem className={cn({ selected: transformation.invert })} onPointerUp={() => transformImageAndOpen('invert')}>
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
							<ContextMenuItem className={cn({ selected: transformation.crosshair })} onPointerUp={() => transformImageAndOpen('crosshair')}>
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
				<ContextMenuItem className='danger' onPointerUp={close}>
					<Lucide.X size={16} /> Close
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	)
}

function bringToFront(e: React.PointerEvent<HTMLImageElement>) {
	const target = e.target as HTMLImageElement
	const wrapper = target.closest('.wrapper') as HTMLElement
	const workspace = wrapper.closest('.workspace') as HTMLElement
	const wrappers = workspace.querySelectorAll('.wrapper') ?? []
	const newZIndex = wrappers.length - 1

	// Already at the top, no need to change z-index
	if (parseInt(wrapper.style.zIndex) === newZIndex) {
		return
	}

	// Find the wrapper with the same z-index as newZIndex
	// and set it to the z-index of the clicked image viewer
	// and bring the clicked image viewer to the front
	// by setting its z-index to newZIndex
	for (const div of wrappers) {
		const zIndex = parseInt((div as HTMLElement).style.zIndex)

		if (zIndex === newZIndex) {
			// Bring the clicked image viewer to the front
			;(div as HTMLElement).style.zIndex = wrapper.style.zIndex
			wrapper.style.zIndex = newZIndex.toFixed(0)
			break
		}
	}
}
