import { memo, useState } from 'react'
import { FilterableList } from './components/FilterableList'
import { ListItem } from './components/List'
import { Popover } from './components/Popover'
import { Icons } from './Icon'
import { IconButton } from './IconButton'
import { Link } from './Link'

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
	readonly type: 'camera' | 'telescope'
	readonly items: readonly AstroBinEquipmentPopoverItem[]
	readonly onSelectedChange?: (item: AstroBinEquipmentPopoverItem) => void
}

function EquipmentFilter(item: AstroBinEquipmentPopoverItem, text: string) {
	const { name, sensor } = item
	return name.toLowerCase().includes(text) || (!!sensor && sensor.toLowerCase().includes(text))
}

function EquipmentItem(item: AstroBinEquipmentPopoverItem, onPointerUp: React.PointerEventHandler) {
	const { sensor, w, h, ps, ap, fl } = item
	return <ListItem description={sensor ? `${sensor} ${w}x${h} ${ps}μm` : `AP: ${ap}mm FL: ${fl}mm`} label={item.name} data-id={item.id} onPointerUp={onPointerUp} />
}

export const AstroBinEquipmentPopover = memo(({ type, items, onSelectedChange }: AstroBinEquipmentPopoverProps) => {
	const [open, setOpen] = useState(false)
	const isCamera = type === 'camera'

	function handlePointerUp(event: React.PointerEvent<HTMLElement>) {
		const id = +event.currentTarget.dataset.id!

		if (onSelectedChange) {
			const item = items.find((e) => e.id === id)
			item && onSelectedChange(item)
		}

		setOpen(false)
	}

	return (
		<Popover onOpenChange={setOpen} open={open} trigger={<IconButton color="secondary" icon={isCamera ? Icons.Camera : Icons.Telescope} tooltipContent={isCamera ? 'Cameras' : 'Telescopes'} variant="flat" />}>
			<FilterableList className="col-span-full" filter={EquipmentFilter} items={items} itemHeight={36}>
				{(item) => EquipmentItem(item, handlePointerUp)}
			</FilterableList>
			<Link className="py-2" href="https://www.astrobin.com/api/v2/equipment/" label={`AstroBin's equipment database API`} />
		</Popover>
	)
})
