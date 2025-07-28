import { Input, Select, type SelectProps } from '@heroui/react'
import { useMemo, useState } from 'react'
import { Icons } from './Icon'

export interface FilterableSelectProps<T extends object> extends Omit<SelectProps<T>, 'listboxProps' | 'items'> {
	readonly items: readonly Readonly<T>[]
	readonly showFilter?: boolean
	readonly filter: (item: T, search: string) => boolean
	readonly filterPlaceholder?: string
}

export function FilterableSelect<T extends object>({ showFilter = true, items, filter, filterPlaceholder = 'Search', ...props }: FilterableSelectProps<T>) {
	const [search, setSearch] = useState('')

	const filtered = useMemo(() => {
		const text = search.toLowerCase().trim()
		return items.length && search ? items.filter((item) => filter(item, text)) : items
	}, [search, items])

	return (
		<Select
			{...props}
			items={filtered}
			listboxProps={{
				topContent: showFilter && <Input className='w-full' isClearable onValueChange={(value) => setSearch(value)} placeholder={filterPlaceholder} startContent={<Icons.Search />} value={search} />,
			}}
		/>
	)
}
