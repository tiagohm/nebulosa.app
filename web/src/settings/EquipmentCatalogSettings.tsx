import type { CatalogCameraFields, CatalogTelescopeFields } from 'api'
import { type ReactNode, useState } from 'react'
import { useSnapshot } from 'valtio'
import { calibrationLibraryRuntime } from '../calibrationlibrary/calibrationlibrary'
import { cameraBindingsState, type CatalogCamera, catalogState, type CatalogTelescope } from '../equipment/catalog'
import { profilesUsingTelescope } from '../equipment/telescopes'
import { formatFocalRatio, formatMillimeters, formatPixelSize } from '../format'
import { profileState } from '../profile/profile'
import { type CatalogKind, navigate, routeState } from '../shell/route'
import { useMediaQuery, WIDE_SCREEN } from '../shell/useMediaQuery'
import { EmptyState } from '../shell/WorkspaceLayout'
import { Button } from '../ui/Button'
import { List, ListItem } from '../ui/List'
import { Modal, ModalActions } from '../ui/Modal'
import { SegmentedControl } from '../ui/SegmentedControl'
import { Select } from '../ui/Select'
import { CatalogCameraEditor } from './CatalogCameraEditor'
import { CatalogTelescopeEditor } from './CatalogTelescopeEditor'

// Equipment Catalog section of the Settings page: the physical cameras calibration frames and masters are recorded
// against and the telescopes and lenses the Equipment Setup refers to, one catalog shared by every profile, tab, and
// browser, and the editor of the one shown. Each camera device is bound to a camera in the Equipment Setup, and its
// Telescope and Guide Telescope may refer to a telescope. The kind listed and the item shown are part of the URL; without
// an item, the first one of the kind is shown. Showing another item, another kind, or creating one with unsaved changes
// asks before discarding them. Nothing here commands a device.

export interface EquipmentCatalogSettingsProps {
	// Kind of equipment listed, from the route; absent lists the cameras.
	readonly catalog?: CatalogKind
	// Id of the camera or telescope shown, from the route; absent shows the first one.
	readonly item?: string
}

// What the editor shows: a saved camera or telescope, or a new one being created, of a kind.
type Shown = { readonly kind: 'item'; readonly catalog: CatalogKind; readonly id: string } | { readonly kind: 'new'; readonly catalog: CatalogKind } | { readonly kind: 'list'; readonly catalog: CatalogKind }

// Kinds of equipment in display order.
const CATALOG_KINDS: readonly CatalogKind[] = ['cameras', 'telescopes']

// Display name of each kind.
const KIND_LABELS: Readonly<Record<CatalogKind, string>> = { cameras: 'Cameras', telescopes: 'Telescopes' }

// One item of a list of the catalog.
interface CatalogItem {
	// Id of the camera or telescope.
	readonly id: string
	// Name shown as its title.
	readonly name: string
	// What it declares.
	readonly description: string
	// Its use, on its own line under the description.
	readonly meta: string
}

// Content of the Equipment Catalog section.
export function EquipmentCatalogSettings({ catalog = 'cameras', item }: EquipmentCatalogSettingsProps) {
	const { cameras, telescopes } = useSnapshot(catalogState)
	const wide = useMediaQuery(WIDE_SCREEN)
	const [creating, setCreating] = useState(false)
	const [dirty, setDirty] = useState(false)
	const [pending, setPending] = useState<Shown>()
	const listed: readonly { readonly id: string; readonly name: string }[] = catalog === 'cameras' ? cameras : telescopes
	const selectedId = item !== undefined ? listed.find((entry) => entry.id === item)?.id : listed[0]?.id
	const selectedName = listed.find((entry) => entry.id === selectedId)?.name
	const camera = catalog === 'cameras' ? cameras.find((entry) => entry.id === selectedId) : undefined
	const telescope = catalog === 'telescopes' ? telescopes.find((entry) => entry.id === selectedId) : undefined
	const noun = catalog === 'cameras' ? 'camera' : 'telescope'

	function show(next: Shown) {
		setDirty(false)
		setCreating(next.kind === 'new')
		if (next.kind === 'item') navigate(routeState, { workspace: 'settings', section: 'equipment-catalog', catalog: next.catalog, item: next.id })
		else navigate(routeState, { workspace: 'settings', section: 'equipment-catalog', ...(next.catalog === 'telescopes' && { catalog: next.catalog }) })
	}

	function request(next: Shown) {
		if (next.catalog === catalog) {
			if (next.kind === 'item' && !creating && next.id === selectedId) return
			if (next.kind === 'new' && creating) return
			if (next.kind === 'list') return
		}

		if (dirty) setPending(next)
		else show(next)
	}

	function closed() {
		show({ kind: 'list', catalog })
	}

	function saved(id: string) {
		if (creating) show({ kind: 'item', catalog, id })
		else setDirty(false)
	}

	function detail() {
		if (catalog === 'cameras') {
			if (creating) return <CatalogCameraEditor key="new" onDirtyChange={setDirty} onSaved={(entry) => saved(entry.id)} onClosed={closed} />
			if (camera) return <CatalogCameraEditor key={camera.id} camera={camera} onDirtyChange={setDirty} onSaved={(entry) => saved(entry.id)} onClosed={closed} />
			if (cameras.length === 0) return <EmptyState title="No cameras in the catalog" description="Add the physical cameras you calibrate; each camera device is then bound to one of them in the Equipment Setup." action={<Button onClick={() => request({ kind: 'new', catalog })}>Add Camera</Button>} />
			return <EmptyState title="Camera not found" description="It was deleted, or never saved." />
		}

		if (creating) return <CatalogTelescopeEditor key="new" onDirtyChange={setDirty} onSaved={(entry) => saved(entry.id)} onClosed={closed} />
		if (telescope) return <CatalogTelescopeEditor key={telescope.id} telescope={telescope} onDirtyChange={setDirty} onSaved={(entry) => saved(entry.id)} onClosed={closed} />
		if (telescopes.length === 0)
			return <EmptyState title="No telescopes in the catalog" description="Add the telescopes and lenses you use; the Telescope and Guide Telescope of the Equipment Setup then refer to one of them." action={<Button onClick={() => request({ kind: 'new', catalog })}>Add Telescope</Button>} />
		return <EmptyState title="Telescope not found" description="It was deleted, or never saved." />
	}

	const kinds = <SegmentedControl options={CATALOG_KINDS} value={catalog} format={(kind) => KIND_LABELS[kind]} onChange={(kind) => request({ kind: 'list', catalog: kind })} />
	const list =
		catalog === 'cameras' ? (
			<CameraList cameras={cameras} selected={creating ? undefined : selectedId} onSelect={(id) => request({ kind: 'item', catalog, id })} onAdd={() => request({ kind: 'new', catalog })} wide={wide} kinds={kinds} />
		) : (
			<TelescopeList telescopes={telescopes} selected={creating ? undefined : selectedId} onSelect={(id) => request({ kind: 'item', catalog, id })} onAdd={() => request({ kind: 'new', catalog })} wide={wide} kinds={kinds} />
		)

	return (
		<>
			<div className={wide ? 'relative flex min-h-0 flex-1' : 'relative flex min-h-0 flex-1 flex-col'}>
				{list}
				{detail()}
			</div>
			<Modal open={pending !== undefined} onClose={() => setPending(undefined)} title="Discard unsaved changes?" className="max-w-md">
				<p className="m-0 text-sm leading-5 text-ink-200">
					The changes to {creating ? `the new ${noun}` : selectedName} were not saved. Showing another {pending?.catalog === catalog ? noun : 'list'} discards them.
				</p>
				<ModalActions>
					<Button variant="secondary" onClick={() => setPending(undefined)} data-autofocus>
						Keep Editing
					</Button>
					<Button
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

interface ItemListProps {
	// Items of the kind listed, in list order.
	readonly items: readonly CatalogItem[]
	// Id of the item shown, if any.
	readonly selected?: string
	// Shows an item.
	readonly onSelect: (id: string) => void
	// Starts a new item.
	readonly onAdd: () => void
	// Whether the list is a sidebar (wide screens) or a select (narrow ones).
	readonly wide: boolean
	// Switch between the kinds of equipment, shown above the list.
	readonly kinds: ReactNode
	// Label of the action that adds an item, such as Add Camera.
	readonly addLabel: string
	// Text of an empty list, and of the select option of an item being created.
	readonly emptyText: string
	readonly newText: string
}

// Items of a kind of the catalog with the switch of kind and the action that adds one: a sidebar on wide screens, a
// select on narrow ones.
function ItemList({ items, selected, onSelect, onAdd, wide, kinds, addLabel, emptyText, newText }: ItemListProps) {
	if (!wide) {
		return (
			<div className="flex flex-none flex-col gap-2 border-b border-line-100 p-3">
				{kinds}
				<div className="flex items-center gap-2">
					{items.length > 0 && <Select className="min-w-0 flex-1" options={items.map((entry) => entry.id)} value={selected ?? ''} format={(id) => items.find((entry) => entry.id === id)?.name ?? newText} onChange={onSelect} />}
					<Button variant="secondary" onClick={onAdd}>
						{addLabel}
					</Button>
				</div>
			</div>
		)
	}

	return (
		<aside className="flex w-80 flex-none flex-col border-r border-line-100 bg-base-000">
			<div className="flex-none border-b border-line-100 p-2">{kinds}</div>
			<List emptyText={emptyText} className="min-h-0 flex-1 overflow-y-auto p-2">
				{items.map((entry) => (
					<ListItem
						opens
						key={entry.id}
						title={entry.name}
						description={
							<span className="flex flex-col">
								<span>{entry.description}</span>
								<span className="text-ink-300 tabular-nums">{entry.meta}</span>
							</span>
						}
						selected={entry.id === selected}
						onClick={() => onSelect(entry.id)}
					/>
				))}
			</List>
			<div className="flex-none border-t border-line-100 p-2">
				<Button variant="secondary" className="w-full" onClick={onAdd}>
					{addLabel}
				</Button>
			</div>
		</aside>
	)
}

interface KindListProps extends Pick<ItemListProps, 'selected' | 'onSelect' | 'onAdd' | 'wide' | 'kinds'> {}

export interface CameraListProps extends KindListProps {
	// Cameras of the catalog, in list order.
	readonly cameras: readonly CatalogCamera[]
}

// Returns what the list says of a camera: its model and sensor.
function cameraDescription({ model, sensor }: Pick<CatalogCameraFields, 'model' | 'sensor'>) {
	const size = sensor && `${sensor.width} × ${sensor.height}${sensor.pixelSize === undefined ? '' : ` · ${formatPixelSize(sensor.pixelSize)}${sensor.bits ? ` · ${sensor.bits} bits` : ''}`}`
	return [model, size].filter(Boolean).join(' · ') || 'No model or sensor'
}

// Cameras of the catalog, with how many devices are bound to each and how much the library records against it.
function CameraList({ cameras, ...props }: CameraListProps) {
	const { bindings } = useSnapshot(cameraBindingsState)
	const { summary } = useSnapshot(calibrationLibraryRuntime)

	// Says how many devices are bound to a camera, and how much the library records against it, on its own line under the
	// description: beside the title it would leave the name too little width in the sidebar.
	function meta(camera: CatalogCamera) {
		if (camera.archived) return 'Archived'
		const bound = Object.values(bindings).filter((binding) => binding.cameraId === camera.id).length
		const usage = summary?.cameras.find((entry) => entry.cameraId === camera.id)
		return `${bound} bound · ${usage?.frames ?? 0} frames · ${usage?.masters ?? 0} masters`
	}

	const items = cameras.map((camera) => ({ id: camera.id, name: camera.name, description: cameraDescription(camera), meta: meta(camera) }))
	return <ItemList items={items} addLabel="Add Camera" emptyText="No cameras in the catalog." newText="New Camera" {...props} />
}

export interface TelescopeListProps extends KindListProps {
	// Telescopes of the catalog, in list order.
	readonly telescopes: readonly CatalogTelescope[]
}

// Returns what the list says of a telescope: its model, aperture, focal length, and focal ratio, in millimeters.
export function telescopeDescription({ model, aperture, focalLength }: Pick<CatalogTelescopeFields, 'model' | 'aperture' | 'focalLength'>) {
	const ratio = aperture !== undefined && focalLength !== undefined && formatFocalRatio(focalLength / aperture)
	return [model, aperture !== undefined && formatMillimeters(aperture), focalLength !== undefined && `${formatMillimeters(focalLength)} FL`, ratio].filter(Boolean).join(' · ') || 'No model or optics'
}

// Telescopes of the catalog, with how many profiles use each.
function TelescopeList({ telescopes, ...props }: TelescopeListProps) {
	const { profiles } = useSnapshot(profileState)

	// Says how many profiles use a telescope.
	function meta(telescope: CatalogTelescope) {
		if (telescope.archived) return 'Archived'
		const used = profilesUsingTelescope(profiles, telescope.id)
		return used === 1 ? '1 profile' : `${used} profiles`
	}

	const items = telescopes.map((telescope) => ({ id: telescope.id, name: telescope.name, description: telescopeDescription(telescope), meta: meta(telescope) }))
	return <ItemList items={items} addLabel="Add Telescope" emptyText="No telescopes in the catalog." newText="New Telescope" {...props} />
}
