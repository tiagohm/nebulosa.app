import { ListboxItem } from '@heroui/react'
import { memo, useEffect, useState } from 'react'
import { Api } from '@/shared/api'
import DRIVERS from '../../../data/drivers.json' with { type: 'json' }
import { FilterableListbox } from './FilterableListBox'

export interface IndiDriverListboxProps {
	readonly showAll?: boolean
	readonly selected: readonly string[]
	readonly onSelectedChange?: (drivers: string[]) => void
}

export const IndiDriverListbox = memo(({ showAll, selected, onSelectedChange }: IndiDriverListboxProps) => {
	const [drivers, setDrivers] = useState<readonly string[]>([])

	useEffect(() => {
		void Api.Indi.Server.drivers().then((drivers) => setDrivers(drivers ?? []))
	}, [])

	return (
		<FilterableListbox
			className='col-span-full'
			classNames={{ list: 'max-h-[200px] overflow-scroll' }}
			filter={(item, search) => item.name.toLowerCase().includes(search) || item.driver.includes(search)}
			items={showAll || drivers.length === 0 ? DRIVERS : DRIVERS.filter((e) => drivers.includes(e.driver))}
			onSelectionChange={(value) => onSelectedChange?.([...(value as Set<string>)])}
			selectedKeys={new Set(selected)}
			selectionMode='multiple'
			variant='flat'>
			{(item) => (
				<ListboxItem description={item.driver} key={item.driver}>
					{item.name}
				</ListboxItem>
			)}
		</FilterableListbox>
	)
})
