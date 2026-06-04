import { memo, useRef } from 'react'
import { FilterableList } from './components/FilterableList'
import { IconButton } from './components/IconButton'
import { Link } from './components/Link'
import { ListItem } from './components/List'
import { Popover, type PopoverMethods } from './components/Popover'
import { Icons } from './Icon'

const EQUIPMENT_ITEM_HEIGHT = 44

export type AstroBinEquipmentType = 'camera' | 'telescope'

export interface AstroBinEquipmentPopoverItem {
	readonly id: number
	readonly name: string
	readonly sensor?: string
	readonly w?: number
	readonly h?: number
	readonly ps?: number
	readonly ap?: number
	readonly fl?: number
}

export interface AstroBinEquipmentPopoverProps {
	readonly type: AstroBinEquipmentType
	readonly items: readonly AstroBinEquipmentPopoverItem[]
	readonly onValueChange?: (item: AstroBinEquipmentPopoverItem) => void
}

interface EquipmentItemProps {
	readonly item: AstroBinEquipmentPopoverItem
	readonly type: AstroBinEquipmentType
	readonly onClick: VoidFunction
}

function isKnownNumber(value: number | undefined) {
	return typeof value === 'number' && Number.isFinite(value)
}

function hasSearchMatch(value: string | number | undefined, text: string) {
	return value !== undefined && `${value}`.toLowerCase().includes(text)
}

function EquipmentFilter(item: AstroBinEquipmentPopoverItem, text: string) {
	const { name, sensor, w, h, ps, ap, fl } = item
	return [name, sensor, w, h, ps, ap, fl].some((value) => hasSearchMatch(value, text))
}

function cameraDescription({ sensor, w, h, ps }: AstroBinEquipmentPopoverItem) {
	const size = isKnownNumber(w) && isKnownNumber(h) ? `${w}x${h}` : undefined
	const pixelSize = isKnownNumber(ps) ? `${ps}μm` : undefined
	return [sensor, size, pixelSize].filter(Boolean).join(' ') || undefined
}

function telescopeDescription({ ap, fl }: AstroBinEquipmentPopoverItem) {
	const aperture = isKnownNumber(ap) ? `AP: ${ap}mm` : undefined
	const focalLength = isKnownNumber(fl) ? `FL: ${fl}mm` : undefined
	return [aperture, focalLength].filter(Boolean).join(' ') || undefined
}

function EquipmentItem({ item, type, onClick }: EquipmentItemProps) {
	const description = type === 'camera' ? cameraDescription(item) : telescopeDescription(item)

	return <ListItem description={description} label={item.name} onClick={onClick} />
}

export const AstroBinEquipmentPopover = memo(({ type, items, onValueChange }: AstroBinEquipmentPopoverProps) => {
	const popoverRef = useRef<PopoverMethods | null>(null)
	const isCamera = type === 'camera'
	const tooltipContent = isCamera ? 'Cameras' : 'Telescopes'
	const filterPlaceholder = isCamera ? 'Search cameras' : 'Search telescopes'
	const emptyContent = isCamera ? 'No cameras found' : 'No telescopes found'

	function handleClick(item: AstroBinEquipmentPopoverItem) {
		onValueChange?.(item)
		popoverRef.current?.hide()
	}

	return (
		<Popover ref={popoverRef} trigger={<IconButton color="secondary" icon={isCamera ? Icons.Camera : Icons.Telescope} tooltipContent={tooltipContent} variant="flat" />}>
			<FilterableList className="w-96 max-w-[calc(100vw-3rem)]" emptyContent={emptyContent} filter={EquipmentFilter} filterPlaceholder={filterPlaceholder} items={items} itemHeight={EQUIPMENT_ITEM_HEIGHT}>
				{(item) => <EquipmentItem item={item} onClick={() => handleClick(item)} type={type} />}
			</FilterableList>
			<Link className="py-2" href="https://www.astrobin.com/api/v2/equipment/" label="AstroBin's equipment database API" />
		</Popover>
	)
})
