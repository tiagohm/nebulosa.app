import React, { memo, useEffect, useMemo, useState } from 'react'
import DRIVERS from 'src/data/drivers.json' with { type: 'json' }
import { Api } from '@/shared/api'
import { stopPropagation } from '../shared/util'
import { FilterableList } from './components/FilterableList'
import { ListItem } from './components/List'
import { Icons } from './Icon'

type Driver = (typeof DRIVERS)[number]

export interface IndiDriverListboxProps {
	readonly showAll?: boolean
	readonly selected: readonly string[]
	readonly onSelectedChange?: (drivers: string[]) => void
}

function DriverItem(item: Driver, selected: boolean, onClick: React.UIEventHandler) {
	return <ListItem data-driver={item.driver} description={item.driver} endContent={selected ? <Icons.Check color="var(--success)" /> : undefined} label={item.name} onClick={onClick} />
}

function DriverFilter(item: Driver, search: string) {
	return item.name.toLowerCase().includes(search) || item.driver.toLowerCase().includes(search)
}

export const IndiDriverListbox = memo(({ showAll, selected, onSelectedChange }: IndiDriverListboxProps) => {
	const [drivers, setDrivers] = useState<readonly string[]>([])
	const availableDrivers = useMemo(() => new Set(drivers), [drivers])
	const selectedDrivers = useMemo(() => new Set(selected), [selected])
	const items = useMemo(() => (showAll || drivers.length === 0 ? DRIVERS : DRIVERS.filter((item) => availableDrivers.has(item.driver))), [availableDrivers, drivers.length, showAll])

	function handleClick(event: React.UIEvent<HTMLElement>) {
		stopPropagation(event)

		const driver = event.currentTarget.dataset.driver
		if (driver === undefined) return

		if (selectedDrivers.has(driver)) {
			onSelectedChange?.(selected.filter((e) => e !== driver))
		} else {
			onSelectedChange?.([...selected, driver])
		}
	}

	useEffect(() => {
		let mounted = true

		void Api.Indi.Server.drivers().then((drivers) => {
			if (mounted) setDrivers(drivers ?? [])
		})

		return () => {
			mounted = false
		}
	}, [])

	return (
		<FilterableList className="col-span-full min-w-0" emptyContent="No drivers" filter={DriverFilter} items={items}>
			{(item) => DriverItem(item, selectedDrivers.has(item.driver), handleClick)}
		</FilterableList>
	)
})
