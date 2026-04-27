import { useDebounce } from '@uidotdev/usehooks'
import { useMemo, useState } from 'react'
import { SearchTextInput } from './components/SearchTextInput'
import { Select, type SelectProps } from './components/Select'

export interface FilterableSelectProps<T extends object> extends Omit<SelectProps<T>, 'listboxProps' | 'items'> {
	readonly items: readonly Readonly<T>[]
	readonly filter: (item: T, search: string) => boolean
	readonly filterPlaceholder?: string
}

export function FilterableSelect<T extends object>({ items, filter, filterPlaceholder = 'Search', ...props }: FilterableSelectProps<T>) {
	const [search, setSearch] = useState('')
	const debouncedSearch = useDebounce(search, 500)

	const filtered = useMemo(() => {
		const text = debouncedSearch.toLowerCase().trim()
		return items.length > 0 && debouncedSearch ? items.filter((item) => filter(item, text)) : items
	}, [debouncedSearch, items])

	return <Select items={filtered} headerContent={<SearchTextInput fullWidth onValueChange={setSearch} placeholder={filterPlaceholder} value={search} />} {...props} />
}
