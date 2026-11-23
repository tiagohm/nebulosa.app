import type { CatalogCameraFields, CatalogTelescopeFields } from 'api'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { useSnapshot } from 'valtio'
import { calibrationLibraryRuntime } from '../calibrationlibrary/calibrationlibrary'
import { cameraBindingsState, type CatalogCamera, catalogState, type CatalogTelescope } from '../equipment/catalog'
import { profilesUsingTelescope } from '../equipment/telescopes'
import { formatFocalRatio, formatMillimeters, formatPixelSize } from '../format'
import { profileState } from '../profile/profile'
import { type CatalogKind, navigate, routeState, setLeaveGuard } from '../shell/route'
import { useMediaQuery, WIDE_SCREEN } from '../shell/useMediaQuery'
import { EmptyState } from '../shell/WorkspaceLayout'
import { Button } from '../ui/Button'
import { List, ListItem } from '../ui/List'
import { Modal, ModalActions } from '../ui/Modal'
import { SegmentedControl } from '../ui/SegmentedControl'
import { Select } from '../ui/Select'
import { CatalogCameraEditor, cameraUsageText } from './CatalogCameraEditor'
import { CatalogTelescopeEditor } from './CatalogTelescopeEditor'

// Equipment Catalog section of the Settings page: the physical cameras calibration frames and masters are recorded
// against and the telescopes and lenses the Equipment Setup refers to, one catalog shared by every profile, tab, and
// browser, and the editor of the one shown. Each camera device is bound to a camera in the Equipment Setup, and its
// Telescope and Guide Telescope may refer to a telescope. The kind listed and the item shown are part of the URL; without
// an item, the first one of the kind is shown. The lists show the archived items last. Leaving an item or a new one with
// unsaved changes, for another item, another kind, another section, or another workspace, asks before discarding them.
// Nothing here commands a device.

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
	// Whether it is archived, which lists it last.
	readonly archived: boolean
}

// Content of the Equipment Catalog section.
export function EquipmentCatalogSettings({ catalog = 'cameras', item }: EquipmentCatalogSettingsProps) {
	const { cameras, telescopes } = useSnapshot(catalogState)
	const wide = useMediaQuery(WIDE_SCREEN)
	const [creating, setCreating] = useState(false)
	const [dirty, setDirty] = useState(false)
	// Step held until the person discards the unsaved changes or keeps editing.
	const [pending, setPending] = useState<() => void>()
	// Removes the leave guard of the unsaved changes; absent while there are none.
	const unguard = useRef<() => void>(undefined)
	const listed = listOrder<{ readonly id: string; readonly name: string; readonly archived: boolean }>(catalog === 'cameras' ? cameras : telescopes)
	const selectedId = item !== undefined ? listed.find((entry) => entry.id === item)?.id : listed[0]?.id
	const selectedName = listed.find((entry) => entry.id === selectedId)?.name
	const camera = catalog === 'cameras' ? cameras.find((entry) => entry.id === selectedId) : undefined
	const telescope = catalog === 'telescopes' ? telescopes.find((entry) => entry.id === selectedId) : undefined
	const noun = catalog === 'cameras' ? 'camera' : 'telescope'

	// Holds every navigation away from the item while its changes are unsaved.
	useEffect(() => {
		if (!dirty) return undefined
		const remove = setLeaveGuard((proceed) => {
			setPending(() => proceed)
			return false
		})
		unguard.current = remove
		return () => {
			remove()
			unguard.current = undefined
		}
	}, [dirty])

	// Drops the unsaved changes and their guard at once, so a navigation right after it is not held.
	function forget() {
		unguard.current?.()
		setDirty(false)
	}

	function show(next: Shown) {
		forget()
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

		if (dirty) setPending(() => () => show(next))
		else show(next)
	}

	function closed() {
		show({ kind: 'list', catalog })
	}

	function saved(id: string) {
		if (creating) show({ kind: 'item', catalog, id })
		else forget()
	}

	function discard() {
		const proceed = pending
		setPending(undefined)
		forget()
		proceed?.()
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
			<CameraList cameras={cameras} selected={creating ? undefined : selectedId} onSelect={(id) => request({ kind: 'item', catalog, id })} onAdd={() => request({ kind: 'new', catalog })} wide={wide} kinds={kinds} creating={creating} />
		) : (
			<TelescopeList telescopes={telescopes} selected={creating ? undefined : selectedId} onSelect={(id) => request({ kind: 'item', catalog, id })} onAdd={() => request({ kind: 'new', catalog })} wide={wide} kinds={kinds} creating={creating} />
		)

	return (
		<>
			<div className={wide ? 'relative flex min-h-0 flex-1' : 'relative flex min-h-0 flex-1 flex-col'}>
				{list}
				{detail()}
			</div>
			<Modal open={pending !== undefined} onClose={() => setPending(undefined)} title="Discard unsaved changes?" className="max-w-md">
				<p className="m-0 text-sm leading-5 text-ink-200">The changes to {creating ? `the new ${noun}` : selectedName} were not saved. Leaving them discards them.</p>
				<ModalActions>
					<Button variant="secondary" onClick={() => setPending(undefined)} data-autofocus>
						Keep Editing
					</Button>
					<Button variant="danger" onClick={discard}>
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
	// Text of the select option of an item being created.
	readonly newText: string
	// Whether an item is being created, which shows the list even while the kind has none.
	readonly creating: boolean
}

// Returns the items of a kind in the order the lists show them: as the catalog keeps them, the archived ones last.
function listOrder<T extends { readonly archived: boolean }>(items: readonly T[]): readonly T[] {
	return [...items.filter((entry) => !entry.archived), ...items.filter((entry) => entry.archived)]
}

// Items of a kind of the catalog with the switch of kind and the action that adds one: a sidebar on wide screens, a
// select on narrow ones, whose options name the archived items. A kind with no item and none being created shows only
// the switch, since the empty detail offers the action that adds one.
function ItemList({ items, selected, onSelect, onAdd, wide, kinds, addLabel, newText, creating }: ItemListProps) {
	const ordered = listOrder(items)
	const empty = items.length === 0 && !creating

	if (!wide) {
		return (
			<div className="flex flex-none flex-col gap-2 border-b border-line-100 p-3">
				{kinds}
				{!empty && (
					<div className="flex items-center gap-2">
						{items.length > 0 && (
							<Select
								className="min-w-0 flex-1"
								options={ordered.map((entry) => entry.id)}
								value={selected ?? ''}
								format={(id) => {
									const entry = items.find((candidate) => candidate.id === id)
									return entry ? (entry.archived ? `${entry.name} · Archived` : entry.name) : newText
								}}
								onChange={onSelect}
							/>
						)}
						<Button variant="secondary" className="flex-none" onClick={onAdd}>
							{addLabel}
						</Button>
					</div>
				)}
			</div>
		)
	}

	return (
		<aside className="flex w-80 flex-none flex-col border-r border-line-100 bg-base-000">
			<div className="flex-none border-b border-line-100 p-2">{kinds}</div>
			{!empty && (
				<>
					<List emptyText={newText} className="min-h-0 flex-1 overflow-y-auto p-2">
						{ordered.map((entry) => (
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
				</>
			)}
		</aside>
	)
}

interface KindListProps extends Pick<ItemListProps, 'selected' | 'onSelect' | 'onAdd' | 'wide' | 'kinds' | 'creating'> {}

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
		return cameraUsageText(bound, usage?.frames ?? 0, usage?.masters ?? 0)
	}

	const items = cameras.map((camera) => ({ id: camera.id, name: camera.name, description: cameraDescription(camera), meta: meta(camera), archived: camera.archived }))
	return <ItemList items={items} addLabel="Add Camera" newText="New Camera" {...props} />
}

export interface TelescopeListProps extends KindListProps {
	// Telescopes of the catalog, in list order.
	readonly telescopes: readonly CatalogTelescope[]
}

// Returns what the list says of a telescope: its model, aperture and focal length in millimeters, and focal ratio.
export function telescopeDescription({ model, aperture, focalLength }: Pick<CatalogTelescopeFields, 'model' | 'aperture' | 'focalLength'>) {
	const ratio = aperture !== undefined && focalLength !== undefined && formatFocalRatio(focalLength / aperture)
	return [model, aperture !== undefined && `${formatMillimeters(aperture)} aperture`, focalLength !== undefined && `${formatMillimeters(focalLength)} FL`, ratio].filter(Boolean).join(' · ') || 'No model or optics'
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

	const items = telescopes.map((telescope) => ({ id: telescope.id, name: telescope.name, description: telescopeDescription(telescope), meta: meta(telescope), archived: telescope.archived }))
	return <ItemList items={items} addLabel="Add Telescope" newText="New Telescope" {...props} />
}
