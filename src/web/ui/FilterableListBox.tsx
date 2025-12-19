import { Listbox, type ListboxProps } from '@heroui/react'
import { useDebounce } from '@uidotdev/usehooks'
import { useMemo, useState } from 'react'
import { SearchInput } from './SearchInput'

export interface FilterableListboxProps<T extends object> extends Omit<ListboxProps<T>, 'topContent' | 'items'> {
	readonly items: readonly Readonly<T>[]
	readonly showFilter?: boolean
	readonly filter: (item: T, search: string) => boolean
	readonly filterPlaceholder?: string
}

export function FilterableListbox<T extends object>({ showFilter = true, items, filter, filterPlaceholder = 'Search', ...props }: FilterableListboxProps<T>) {
	const [search, setSearch] = useState('')
	const debouncedSearch = useDebounce(search, 500)

	const filtered = useMemo(() => {
		const text = debouncedSearch.toLowerCase().trim()
		return items.length && text ? items.filter((item) => filter(item, text)) : items
	}, [debouncedSearch, items])

	return <Listbox {...props} items={filtered} topContent={showFilter && <SearchInput className='w-full' onValueChange={setSearch} placeholder={filterPlaceholder} value={search} />} />
}
