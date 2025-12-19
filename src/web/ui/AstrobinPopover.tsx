import { ListboxItem, Popover, PopoverContent, PopoverTrigger, Tooltip } from '@heroui/react'
import { memo, useState } from 'react'
import { FilterableListbox } from './FilterableListBox'
import { Icons } from './Icon'
import { IconButton } from './IconButton'

export interface AstrobinPopoverItem {
	readonly id: number
	readonly name: string
	readonly sensor?: string
	readonly w?: number
	readonly h?: number
	readonly ps?: number
	readonly ap?: number
	readonly fl?: number
}

export interface AstrobinPopoverProps {
	readonly type: 'camera' | 'telescope'
	readonly items: readonly AstrobinPopoverItem[]
	readonly onSelectedChange?: (item: AstrobinPopoverItem) => void
}

function filter(item: AstrobinPopoverItem, text: string) {
	const { name, sensor } = item
	return name.toLowerCase().includes(text) || (!!sensor && sensor.toLowerCase().includes(text))
}

function description(item: AstrobinPopoverItem) {
	const { sensor, w, h, ps, ap, fl } = item
	return sensor ? `${sensor} ${w}x${h} ${ps}μm` : `AP: ${ap}mm FL: ${fl}mm`
}

export const AstrobinPopover = memo(({ type, items, onSelectedChange }: AstrobinPopoverProps) => {
	const isCamera = type === 'camera'
	const [open, setOpen] = useState(false)

	function handleOnAction(value: React.Key) {
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
					onAction={handleOnAction}
					selectionMode='none'
					variant='flat'
					virtualization={{
						maxListboxHeight: 200,
						itemHeight: 36,
					}}>
					{(item) => (
						<ListboxItem description={description(item)} key={item.id}>
							{item.name}
						</ListboxItem>
					)}
				</FilterableListbox>
			</PopoverContent>
		</Popover>
	)
})
