import type { CatalogCameraFields } from 'api'
import { useState } from 'react'
import { useSnapshot } from 'valtio'
import { calibrationLibraryRuntime } from '../calibrationlibrary/calibrationlibrary'
import { cameraBindingsState, type CatalogCamera, catalogState } from '../equipment/catalog'
import { navigate, routeState } from '../shell/route'
import { useMediaQuery, WIDE_SCREEN } from '../shell/useMediaQuery'
import { EmptyState } from '../shell/WorkspaceLayout'
import { Button } from '../ui/Button'
import { List, ListItem } from '../ui/List'
import { Modal, ModalActions } from '../ui/Modal'
import { Select } from '../ui/Select'
import { CatalogCameraEditor } from './CatalogCameraEditor'

// Equipment Catalog section of the Settings page: the physical cameras calibration frames and masters are recorded
// against, one catalog shared by every profile, tab, and browser, and the editor of the one shown. Each camera device is
// bound to one of them in the Equipment Setup. The camera shown is part of the URL; without one, the first camera is
// shown. Showing another camera or creating one with unsaved changes asks before discarding them. Nothing here commands a
// device.

export interface EquipmentCatalogSettingsProps {
	// Id of the camera shown, from the route; absent shows the first one.
	readonly camera?: string
}

// What the editor shows: a saved camera, or a new one being created.
type Shown = { readonly kind: 'camera'; readonly id: string } | { readonly kind: 'new' }

// Content of the Equipment Catalog section.
export function EquipmentCatalogSettings({ camera: routeCamera }: EquipmentCatalogSettingsProps) {
	const { cameras } = useSnapshot(catalogState)
	const wide = useMediaQuery(WIDE_SCREEN)
	const [creating, setCreating] = useState(false)
	const [dirty, setDirty] = useState(false)
	const [pending, setPending] = useState<Shown>()
	const selected = routeCamera !== undefined ? cameras.find((entry) => entry.id === routeCamera) : cameras[0]

	function show(next: Shown) {
		setDirty(false)
		setCreating(next.kind === 'new')
		if (next.kind === 'camera') navigate(routeState, { workspace: 'settings', section: 'equipment-catalog', camera: next.id })
	}

	function request(next: Shown) {
		if (next.kind === 'camera' && !creating && next.id === selected?.id) return
		if (next.kind === 'new' && creating) return
		if (dirty) setPending(next)
		else show(next)
	}

	function closed() {
		setDirty(false)
		setCreating(false)
		navigate(routeState, { workspace: 'settings', section: 'equipment-catalog' })
	}

	function detail() {
		if (creating) return <CatalogCameraEditor key="new" onDirtyChange={setDirty} onSaved={(saved) => show({ kind: 'camera', id: saved.id })} onClosed={closed} />
		if (selected) return <CatalogCameraEditor key={selected.id} camera={selected} onDirtyChange={setDirty} onSaved={() => setDirty(false)} onClosed={closed} />
		if (cameras.length === 0) return <EmptyState title="No cameras in the catalog" description="Add the physical cameras you calibrate; each camera device is then bound to one of them in the Equipment Setup." action={<Button onClick={() => request({ kind: 'new' })}>Add Camera</Button>} />
		return <EmptyState title="Camera not found" description="It was deleted, or never saved." />
	}

	const list = <CameraList cameras={cameras} selected={creating ? undefined : selected?.id} onSelect={(id) => request({ kind: 'camera', id })} onAdd={() => request({ kind: 'new' })} wide={wide} />

	return (
		<>
			<div className={wide ? 'relative flex min-h-0 flex-1' : 'relative flex min-h-0 flex-1 flex-col'}>
				{(cameras.length > 0 || creating) && list}
				{detail()}
			</div>
			<Modal open={pending !== undefined} onClose={() => setPending(undefined)} title="Discard unsaved changes?" className="max-w-md">
				<p className="m-0 text-sm leading-5 text-ink-200">The changes to {creating ? 'the new camera' : selected?.name} were not saved. Showing another camera discards them.</p>
				<ModalActions>
					<Button variant="secondary" onClick={() => setPending(undefined)}>
						Keep Editing
					</Button>
					<Button
						data-autofocus
						onClick={() => {
							if (pending) show(pending)
							setPending(undefined)
						}}
					>
						Discard Changes
					</Button>
				</ModalActions>
			</Modal>
		</>
	)
}

export interface CameraListProps {
	// Cameras of the catalog, in list order.
	readonly cameras: readonly CatalogCamera[]
	// Id of the camera shown, if any.
	readonly selected?: string
	// Shows a camera.
	readonly onSelect: (id: string) => void
	// Starts a new camera.
	readonly onAdd: () => void
	// Whether the list is a sidebar (wide screens) or a select (narrow ones).
	readonly wide: boolean
}

// Returns what the list says of a camera: its model and sensor.
function cameraDescription({ model, sensor }: Pick<CatalogCameraFields, 'model' | 'sensor'>) {
	const size = sensor && `${sensor.width} × ${sensor.height}${sensor.pixelSize === undefined ? '' : ` · ${sensor.pixelSize} µm`}`
	return [model, size].filter(Boolean).join(' · ') || 'No model or sensor'
}

// Cameras of the catalog with the action that adds one: a sidebar on wide screens, a select on narrow ones.
function CameraList({ cameras, selected, onSelect, onAdd, wide }: CameraListProps) {
	const { bindings } = useSnapshot(cameraBindingsState)
	const { summary } = useSnapshot(calibrationLibraryRuntime)

	if (!wide) {
		return (
			<div className="flex flex-none items-center gap-2 border-b border-line-100 p-3">
				<Select options={cameras.map((camera) => camera.id)} value={selected ?? ''} format={(id) => cameras.find((camera) => camera.id === id)?.name ?? 'New Camera'} onChange={onSelect} />
				<Button variant="secondary" onClick={onAdd}>
					Add Camera
				</Button>
			</div>
		)
	}

	// Says how many devices are bound to a camera, and how much the library records against it.
	function meta(camera: CatalogCamera) {
		if (camera.archived) return 'Archived'
		const bound = Object.values(bindings).filter((binding) => binding.cameraId === camera.id).length
		const usage = summary?.cameras.find((entry) => entry.cameraId === camera.id)
		return `${bound} bound · ${usage?.frames ?? 0} frames · ${usage?.masters ?? 0} masters`
	}

	return (
		<aside className="flex w-80 flex-none flex-col border-r border-line-100 bg-base-000">
			<List emptyText="No cameras in the catalog." className="min-h-0 flex-1 overflow-y-auto p-2">
				{cameras.map((camera) => (
					<ListItem key={camera.id} title={camera.name} description={cameraDescription(camera)} meta={meta(camera)} selected={camera.id === selected} onClick={() => onSelect(camera.id)} />
				))}
			</List>
			<div className="flex-none border-t border-line-100 p-2">
				<Button variant="secondary" className="w-full" onClick={onAdd}>
					Add Camera
				</Button>
			</div>
		</aside>
	)
}
