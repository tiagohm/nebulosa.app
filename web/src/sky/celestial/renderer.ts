import { clipProjectionDisk } from './drawing'
import { isFiniteDiskProjection } from './geometry'
import type { InternalLayer } from './layers'
import { DEFAULT_HEIGHT, DEFAULT_WIDTH } from './options'
import type { RenderState } from './types'

// Canvas layer manager of the star map: layers share stacked canvases by group so a frame only clears and
// redraws the groups that contain dirty layers. Canvas backing stores follow the device pixel ratio.

// Canvas shared by a group of layers.
interface LayerGroupRecord {
	// Group identifier.
	readonly id: string
	// Layers of the group, sorted by z-index.
	readonly layers: InternalLayer[]
	// Canvas the group draws into.
	readonly canvas: HTMLCanvasElement
	// 2D context of the canvas.
	readonly ctx: CanvasRenderingContext2D
	// Stacking order: the lowest z-index of its layers.
	zIndex: number
	// Whether any layer of the group is visible.
	visible: boolean
}

// Manager of the stacked canvases and the layers drawn into them.
export class CanvasRenderer {
	// Element holding the canvases, appended to the host.
	private readonly root: HTMLDivElement
	// Groups sorted by stacking order.
	private readonly groups: LayerGroupRecord[] = []
	private readonly groupsById = new Map<string, LayerGroupRecord>()
	private readonly layersById = new Map<string, InternalLayer>()
	// Device pixel ratio of the backing stores.
	private dpr = 1
	// Requested root width in pixels, used while the root has no layout size.
	private width = DEFAULT_WIDTH
	// Requested root height in pixels, used while the root has no layout size.
	private height = DEFAULT_HEIGHT

	// Appends the canvas root to the host and sizes it in pixels; the device pixel ratio is capped by
	// `maxDevicePixelRatio`.
	constructor(
		private readonly host: HTMLElement,
		width: number,
		height: number,
		private readonly maxDevicePixelRatio: number,
	) {
		this.root = document.createElement('div')
		this.root.style.position = 'relative'
		this.root.style.overflow = 'hidden'
		this.root.style.touchAction = 'none'
		this.host.append(this.root)
		this.resize(width, height)
	}

	// Adds a layer to a canvas group, creating the group's canvas on first use.
	addLayer(layer: InternalLayer, groupId: string) {
		let group = this.groupsById.get(groupId)

		if (!group) {
			const canvas = document.createElement('canvas')
			const ctx = canvas.getContext('2d', { alpha: true })

			if (!ctx) {
				throw new Error(`Unable to create 2D canvas context for layer group ${groupId}`)
			}

			canvas.style.position = 'absolute'
			canvas.style.inset = '0'
			canvas.style.pointerEvents = 'none'
			this.root.append(canvas)
			group = { id: groupId, layers: [], canvas, ctx, zIndex: layer.zIndex, visible: true }
			this.groups.push(group)
			this.groupsById.set(groupId, group)
			this.resizeCanvas(canvas)
		}

		group.layers.push(layer)
		group.layers.sort((a, b) => a.zIndex - b.zIndex)
		group.zIndex = group.layers[0].zIndex
		group.canvas.style.zIndex = String(group.zIndex)
		this.groups.sort((a, b) => a.zIndex - b.zIndex)
		this.layersById.set(layer.id, layer)
	}

	// Resizes the root and every canvas to a size in pixels and marks every layer dirty.
	resize(width: number, height: number) {
		this.dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, this.maxDevicePixelRatio))
		this.width = width
		this.height = height
		this.root.style.width = `${width}px`
		this.root.style.height = `${height}px`

		for (const group of this.groups) {
			this.resizeCanvas(group.canvas)

			for (const layer of group.layers) {
				layer.markDirty()
			}
		}
	}

	// Redraws the groups containing dirty layers, clipping every layer but the background to the projection
	// disk, and marks their layers clean.
	render(state: RenderState) {
		for (const group of this.groups) {
			let dirty = false
			let visible = false

			for (const layer of group.layers) {
				dirty ||= layer.dirty
				visible ||= layer.visible
			}

			if (group.visible !== visible) {
				group.visible = visible
				group.canvas.style.display = visible ? 'block' : 'none'
			}

			if (!dirty) {
				continue
			}

			if (visible) {
				const ctx = group.ctx
				ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
				ctx.clearRect(0, 0, state.width, state.height)

				for (const layer of group.layers) {
					if (!layer.visible) continue

					ctx.save()

					if (layer.id !== 'background' && isFiniteDiskProjection(state.projection)) {
						clipProjectionDisk(ctx, state)
					}

					layer.render(ctx, state)
					ctx.restore()
				}
			}

			for (const layer of group.layers) {
				layer.markClean()
			}
		}
	}

	// Marks every layer dirty.
	markAllDirty() {
		for (const layer of this.layersById.values()) {
			layer.markDirty()
		}
	}

	// Marks one layer dirty.
	markDirty(id: string) {
		this.layersById.get(id)?.markDirty()
	}

	// Returns a layer by id.
	getLayer(id: string) {
		return this.layersById.get(id) ?? null
	}

	// Removes the canvases from the DOM and forgets every layer.
	destroy() {
		this.root.remove()
		this.groups.length = 0
		this.groupsById.clear()
		this.layersById.clear()
	}

	// Element receiving pointer interactions.
	get element(): HTMLElement {
		return this.root
	}

	// Device pixel ratio of the backing stores.
	get devicePixelRatio() {
		return this.dpr
	}

	// Sizes a canvas backing store to the root layout size (or the requested size before layout) times the
	// device pixel ratio.
	private resizeCanvas(canvas: HTMLCanvasElement) {
		const width = Math.max(1, this.root.clientWidth || this.width)
		const height = Math.max(1, this.root.clientHeight || this.height)
		canvas.width = Math.round(width * this.dpr)
		canvas.height = Math.round(height * this.dpr)
		canvas.style.width = `${width}px`
		canvas.style.height = `${height}px`
	}
}
