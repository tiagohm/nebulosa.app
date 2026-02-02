import { ListboxItem, Popover, PopoverContent, PopoverTrigger, Tooltip } from '@heroui/react'
import { memo, useState } from 'react'
import { FilterableListbox } from './FilterableListBox'
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

function filter(item: AstroBinEquipmentPopoverItem, text: string) {
	const { name, sensor } = item
	return name.toLowerCase().includes(text) || (!!sensor && sensor.toLowerCase().includes(text))
}

const EquipmentItem = (item: AstroBinEquipmentPopoverItem) => {
	const { sensor, w, h, ps, ap, fl } = item

	return (
		<ListboxItem description={sensor ? `${sensor} ${w}x${h} ${ps}μm` : `AP: ${ap}mm FL: ${fl}mm`} key={item.id}>
			{item.name}
		</ListboxItem>
	)
}

export const AstroBinEquipmentPopover = memo(({ type, items, onSelectedChange }: AstroBinEquipmentPopoverProps) => {
	const [open, setOpen] = useState(false)
	const isCamera = type === 'camera'

	function handleAction(value: React.Key) {
		const id = typeof value === 'string' ? +value : value

		if (onSelectedChange) {
			const item = items.find((e) => e.id === id)
			item && onSelectedChange(item)
		}

		setOpen(false)
	}

	return (
		<Popover isOpen={open} onOpenChange={setOpen} placement='bottom' showArrow>
			<Tooltip content={isCamera ? 'Cameras' : 'Telescopes'} placement='bottom' showArrow>
				<div className='max-w-fit'>
					<PopoverTrigger>
						<IconButton color='secondary' icon={isCamera ? Icons.Camera : Icons.Telescope} variant='flat' />
					</PopoverTrigger>
				</div>
			</Tooltip>
			<PopoverContent>
				<FilterableListbox
					className='col-span-full'
					classNames={{ list: 'max-h-[200px] overflow-scroll', base: 'min-w-80' }}
					filter={filter}
					isVirtualized
					items={items}
					onAction={handleAction}
					selectionMode='none'
					variant='flat'
					virtualization={{
						maxListboxHeight: 200,
						itemHeight: 36,
					}}>
					{EquipmentItem}
				</FilterableListbox>
				<Link className='py-2' href='https://www.astrobin.com/api/v2/equipment/' label={`AstroBin's equipment database API`} />
			</PopoverContent>
		</Popover>
	)
})
