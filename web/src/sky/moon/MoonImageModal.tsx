import type { LunarFeatureCategory, MoonAlmanacResponse } from 'api'
import { clamp } from 'nebulosa/src/math/numerical/math'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSnapshot } from 'valtio'
import moon4k from '../../../assets/moon/moon.4k.jpg'
import moonFeatures from '../../../assets/moon/moon.features.json.gz' with { type: 'file' }
import { Checkbox } from '../../ui/Checkbox'
import { IconButton } from '../../ui/IconButton'
import { Modal } from '../../ui/Modal'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { Select } from '../../ui/Select'
import { TextInput } from '../../ui/TextInput'
import { anchoredTransform, beginGesture, type GestureAnchor, type GesturePointer, gestureTransform } from '../celestial/gesture'
import type { ViewTransform } from '../celestial/types'
import { Note } from '../InspectorParts'
import { LUNAR_FEATURE_CATEGORIES, LUNAR_FEATURE_CATEGORY_NAMES, type LunarFeatureFilter, loadMoonFeatures, MOON_IMAGE_CREDIT, MOON_PHASE_NAMES, moonOrientationCaption, moonState, selectFeature, setMoonViewUp } from './moon'
import { featureMarkers, searchFeatures } from './moon.features'
import { CENTERED, type DiscViewport, discViewport, type MoonViewUp, projectPoint, viewMatrix } from './moon.geometry'
import { MoonCanvas } from './MoonCanvas'
import { MoonFeatureDetails } from './MoonFeatureDetails'
import { MoonFeaturesOverlay } from './MoonFeaturesOverlay'

// Lunar Surface Explorer, the larger view of the Moon Inspector's drawing: the same appearance on the 4096×2048 color
// map, zoomed with the wheel or a pinch and panned by dragging, with the official IAU names of the visible features
// at their Gazetteer center points (by category, as many as the zoom tells apart, labels never overlapping), a search
// by name that tells visible features from those turned away, and the details of the feature selected. Zenith up or
// north up is a presentation choice, like the zoom and the pan: none of them changes the observer or the instant,
// which keep driving the drawing and the markers through the same projection. The catalog loads on the first opening.

// Names of the orientations.
const UP_NAMES: Readonly<Record<MoonViewUp, string>> = { zenith: 'Zenith up', north: 'North up' }

// Filters offered, in order.
const FILTERS: readonly LunarFeatureFilter[] = ['all', ...LUNAR_FEATURE_CATEGORIES]

// Largest zoom factor: about 8 km per CSS pixel on a 700-pixel disk.
const MAX_ZOOM = 32

// Zoom change of one wheel notch (100 pixels of delta).
const WHEEL_ZOOM = 1.25

// Distance in CSS pixels a pointer moves before a press becomes a drag rather than a click.
const DRAG_THRESHOLD = 4

// Mean radius of the Moon in km, to size a feature on screen when centering on it.
const MOON_RADIUS_KM = 1737.4

// Credit of the feature names.
const FEATURE_CREDIT = 'Names: Gazetteer of Planetary Nomenclature, USGS Astrogeology Science Center and the IAU. Markers are the official center points, not outlines; sizes are approximate.'

// Returns the name of a filter, for people.
function filterName(filter: LunarFeatureFilter) {
	return filter === 'all' ? 'All features' : LUNAR_FEATURE_CATEGORY_NAMES[filter]
}

// Lunar Surface Explorer.
export function MoonImageModal({ open, onClose, almanac }: { readonly open: boolean; readonly onClose: () => void; readonly almanac: MoonAlmanacResponse }) {
	const { up, features, explorer } = useSnapshot(moonState)
	const { appearance } = almanac
	const [transform, setTransform] = useState<Readonly<ViewTransform>>(CENTERED)
	const [viewport, setViewport] = useState<DiscViewport>()
	const surface = useRef<HTMLDivElement>(null)
	const pointers = useRef(new Map<number, GesturePointer>())
	const anchor = useRef<GestureAnchor>(undefined)
	const press = useRef<{ x: number; y: number; dragged: boolean }>(undefined)
	const view = useMemo(() => viewMatrix(appearance, up), [appearance, up])
	const all = features.value
	const selected = all?.find((e) => e.id === explorer.selected)

	// Loads the catalog the first time the explorer opens.
	useEffect(() => {
		if (open) void loadMoonFeatures(moonState, moonFeatures)
	}, [open])

	const categories = useMemo(() => new Set<LunarFeatureCategory>(explorer.category === 'all' ? LUNAR_FEATURE_CATEGORIES : [explorer.category]), [explorer.category])
	const markers = useMemo(() => (all && viewport ? featureMarkers(all, view, appearance.sunDirection, viewport, categories, explorer.selected, explorer.labels) : []), [all, view, appearance, viewport, categories, explorer.selected, explorer.labels])
	const matches = useMemo(() => (all ? searchFeatures(all, explorer.query, view) : []), [all, explorer.query, view])

	// Zooms with the wheel around the pointer; the listener is not passive so the dialog does not scroll.
	useEffect(() => {
		const element = surface.current
		if (!open || !element) return

		function wheel(event: WheelEvent) {
			event.preventDefault()
			const rect = element!.getBoundingClientRect()
			const x = event.clientX - rect.left
			const y = event.clientY - rect.top
			setTransform((current) => anchoredTransform(current, x, y, x, y, clamp(current.k * WHEEL_ZOOM ** (-event.deltaY / 100), 1, MAX_ZOOM), rect.width, rect.height))
		}

		element.addEventListener('wheel', wheel, { passive: false })
		return () => element.removeEventListener('wheel', wheel)
	}, [open])

	// Returns the position of a pointer event in the surface's CSS pixels.
	function local(event: React.PointerEvent) {
		const rect = surface.current!.getBoundingClientRect()
		return { x: event.clientX - rect.left, y: event.clientY - rect.top }
	}

	// Anchors a pan or pinch on the pointers down.
	function pointerDown(event: React.PointerEvent) {
		const point = local(event)
		pointers.current.set(event.pointerId, point)
		anchor.current = beginGesture(pointers.current.values(), transform)
		press.current = { ...point, dragged: pointers.current.size > 1 }
	}

	// Pans or pinches once the press has moved far enough to be a drag.
	function pointerMove(event: React.PointerEvent) {
		if (!pointers.current.has(event.pointerId) || !anchor.current) return
		const point = local(event)
		pointers.current.set(event.pointerId, point)

		if (press.current && !press.current.dragged && Math.hypot(point.x - press.current.x, point.y - press.current.y) > DRAG_THRESHOLD) {
			press.current.dragged = true
			surface.current!.setPointerCapture(event.pointerId)
		}

		if (press.current?.dragged) {
			const rect = surface.current!.getBoundingClientRect()
			setTransform(gestureTransform(anchor.current, pointers.current.values(), rect.width, rect.height, 1, MAX_ZOOM))
		}
	}

	// Anchors the gesture again on the pointers still down.
	function pointerUp(event: React.PointerEvent) {
		pointers.current.delete(event.pointerId)
		anchor.current = beginGesture(pointers.current.values(), transform)
	}

	// Selects a feature clicked or tapped, unless the press was a drag.
	function choose(id: number) {
		if (!press.current?.dragged) selectFeature(moonState, id)
	}

	// Selects a search result and, when it is visible, centers the view on it, zoomed in enough to tell it apart.
	function focus(id: number) {
		selectFeature(moonState, id)
		const feature = all?.find((e) => e.id === id)
		const rect = surface.current?.getBoundingClientRect()
		if (!feature || !rect) return

		const point = projectPoint(view, feature.vector)
		if (point.z <= 0) return

		const base = discViewport(rect.width, rect.height).radius
		const fit = (Math.min(rect.width, rect.height) / 4 / base) * (MOON_RADIUS_KM / Math.max(feature.dimension ?? 50, 5))
		const k = clamp(Math.max(transform.k, fit), 1, MAX_ZOOM)
		setTransform({ x: -point.x * base * k, y: point.y * base * k, k })
	}

	return (
		<Modal open={open} onClose={onClose} title="Lunar Surface Explorer" fit className="max-w-[min(100%,80rem)]">
			<div className="flex min-h-0 flex-1 flex-col gap-3">
				<div className="flex flex-wrap gap-2 items-center">
					{appearance.parallacticAngle !== undefined && <SegmentedControl options={['zenith', 'north'] as const} value={up} format={(e) => UP_NAMES[e]} onChange={(e) => setMoonViewUp(moonState, e)} className="w-56" />}
					<Select options={FILTERS} value={explorer.category} format={filterName} onChange={(e) => (moonState.explorer.category = e)} className="w-52" />
					<Checkbox label="Names" checked={explorer.labels} onChange={(e) => (moonState.explorer.labels = e)} className="h-[38px]" />
					<IconButton icon="fit" label="Whole Moon" disabled={transform === CENTERED} onClick={() => setTransform(CENTERED)} />
				</div>
				<div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto md:flex-row md:overflow-visible">
					<div ref={surface} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} className="relative h-[min(55vh,46rem)] min-h-64 w-full flex-none cursor-grab touch-none select-none active:cursor-grabbing md:h-[min(65vh,46rem)] md:w-auto md:flex-1">
						{open && (
							<MoonCanvas appearance={appearance} up={up} texture={moon4k} transform={transform} onViewport={setViewport} className="size-full">
								{viewport && <MoonFeaturesOverlay viewport={viewport} markers={markers} selected={explorer.selected} onSelect={choose} />}
							</MoonCanvas>
						)}
					</div>
					<aside className="flex w-full flex-none flex-col gap-3 md:w-80 md:overflow-y-auto">
						<TextInput type="search" placeholder="Search a feature: Tycho, Mare Crisium" value={explorer.query} onChange={(e) => (moonState.explorer.query = e.target.value)} disabled={!all} />
						{matches.length > 0 && (
							<ul className="m-0 flex max-h-56 list-none flex-col overflow-y-auto p-0">
								{matches.map(({ feature, visible }) => (
									<li key={feature.id}>
										<button
											type="button"
											onClick={() => focus(feature.id)}
											className="flex w-full cursor-pointer items-baseline justify-between gap-2 rounded-sm border-0 bg-transparent px-2 py-1 text-left text-[13px] text-ink-100 hover:bg-base-300 focus-visible:outline-2 focus-visible:outline-accent"
										>
											<span className="truncate">{feature.name}</span>
											<span className="flex-none text-xs text-ink-300">{visible ? feature.descriptor.split(',')[0] : 'Not visible now'}</span>
										</button>
									</li>
								))}
							</ul>
						)}
						{explorer.query.trim() && all && matches.length === 0 && <Note>No feature has that name.</Note>}
						{selected ? (
							<MoonFeatureDetails feature={selected} view={view} sun={appearance.sunDirection} />
						) : (
							<Note>{all ? 'Click a marker or search a name to see its details. Zoom in to see smaller features.' : features.error ? `The feature names are unavailable: ${features.error}` : 'Loading the feature names…'}</Note>
						)}
						<Note>
							{MOON_PHASE_NAMES[appearance.phase]} · {(appearance.illuminatedFraction * 100).toFixed(1)}% illuminated · {moonOrientationCaption(almanac, up)}.
						</Note>
						<Note>
							{MOON_IMAGE_CREDIT} {FEATURE_CREDIT}
						</Note>
					</aside>
				</div>
			</div>
		</Modal>
	)
}
