import { Select, type SelectProps } from '@heroui/react'
import { useDebounce } from '@uidotdev/usehooks'
import { useMemo, useState } from 'react'
import { SearchInput } from './SearchInput'

export interface FilterableSelectProps<T extends object> extends Omit<SelectProps<T>, 'listboxProps' | 'items'> {
	readonly items: readonly Readonly<T>[]
	readonly showFilter?: boolean
	readonly filter: (item: T, search: string) => boolean
	readonly filterPlaceholder?: string
}

export function FilterableSelect<T extends object>({ showFilter = true, items, filter, filterPlaceholder = 'Search', ...props }: FilterableSelectProps<T>) {
	const [search, setSearch] = useState('')
	const debouncedSearch = useDebounce(search, 500)

	const filtered = useMemo(() => {
		const text = debouncedSearch.toLowerCase().trim()
		return items.length && debouncedSearch ? items.filter((item) => filter(item, text)) : items
	}, [debouncedSearch, items])

	return (
		<Select
			{...props}
			items={filtered}
			listboxProps={{
				topContent: showFilter && <SearchInput className='w-full' onValueChange={setSearch} placeholder={filterPlaceholder} value={search} />,
			}}
		/>
	)
}
