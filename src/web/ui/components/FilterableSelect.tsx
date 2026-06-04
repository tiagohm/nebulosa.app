import { useDebounce } from '@uidotdev/usehooks'
import { useMemo, useState } from 'react'
import { SearchTextInput } from './SearchTextInput'
import { Select, type SelectProps } from './Select'

export interface FilterableSelectProps<T> extends Omit<SelectProps<T>, 'headerContent' | 'items'> {
	readonly items: readonly T[]
	readonly filter: (item: T, search: string) => boolean
	readonly filterPlaceholder?: string
	readonly headerContent?: React.ReactNode
	readonly minLengthToSearch?: number
}

// Renders a searchable Select while preserving the shared Select behavior.
export function FilterableSelect<T>({ items, filter, filterPlaceholder = 'Search', headerContent, minLengthToSearch = 3, ...props }: FilterableSelectProps<T>) {
	const [search, setSearch] = useState('')
	const debouncedSearch = useDebounce(search, 500)

	const filtered = useMemo(() => {
		const text = debouncedSearch.toLowerCase().trim()
		return text ? items.filter((item) => filter(item, text)) : items
	}, [debouncedSearch, filter, items])

	// Clears the committed filter text from the search field clear button.
	function clearSearch() {
		setSearch('')
	}

	const HeaderContent = (
		<>
			<SearchTextInput fullWidth minLengthToSearch={minLengthToSearch} onClear={clearSearch} onValueChange={setSearch} placeholder={filterPlaceholder} value={search} />
			{headerContent}
		</>
	)

	return <Select items={filtered} headerContent={HeaderContent} {...props} />
}
