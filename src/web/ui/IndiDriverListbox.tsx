import React, { memo, useEffect, useState } from 'react'
import { Api } from '@/shared/api'
import DRIVERS from '../../../data/drivers.json' with { type: 'json' }
import { stopPropagation } from '../shared/util'
import { FilterableList } from './components/FilterableList'
import { ListItem } from './components/List'

type Driver = (typeof DRIVERS)[number]

export interface IndiDriverListboxProps {
	readonly showAll?: boolean
	readonly selected: readonly string[]
	readonly onSelectedChange?: (drivers: string[]) => void
}

function DriverItem(item: Driver, onClick: React.UIEventHandler) {
	return <ListItem description={item.driver} label={item.name} data-driver={item.driver} onClick={onClick} />
}

function DriverFilter(item: Driver, search: string) {
	return item.name.toLowerCase().includes(search) || item.driver.includes(search)
}

export const IndiDriverListbox = memo(({ showAll, selected, onSelectedChange }: IndiDriverListboxProps) => {
	const [drivers, setDrivers] = useState<readonly string[]>([])

	function handleClick(event: React.UIEvent<HTMLElement>) {
		stopPropagation(event)

		const driver = event.currentTarget.dataset.driver!

		if (selected.includes(driver)) {
			onSelectedChange?.(selected.filter((e) => e !== driver))
		} else {
			onSelectedChange?.([...selected, driver])
		}
	}

	useEffect(() => {
		void Api.Indi.Server.drivers().then((drivers) => setDrivers(drivers ?? []))
	}, [])

	return (
		<FilterableList className="col-span-full" filter={DriverFilter} items={showAll || drivers.length === 0 ? DRIVERS : DRIVERS.filter((e) => drivers.includes(e.driver))}>
			{(item) => DriverItem(item, handleClick)}
		</FilterableList>
	)
})
