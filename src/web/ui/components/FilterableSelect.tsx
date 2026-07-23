import { Select, type SelectProps } from '@ui/components/Select'
import { TextInput } from '@ui/components/TextInput'
import { useDebounce } from '@uidotdev/usehooks'
import { useMemo, useState } from 'react'

export interface FilterableSelectProps<T> extends Omit<SelectProps<T>, 'headerContent' | 'items'> {
	readonly items: readonly T[]
	readonly filter: (item: T, search: string) => boolean
	readonly filterPlaceholder?: string
	readonly headerContent?: React.ReactNode
}

// Renders a searchable Select while preserving the shared Select behavior.
export function FilterableSelect<T>({ items, filter, filterPlaceholder = 'Search', headerContent, ...props }: FilterableSelectProps<T>) {
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
			<TextInput fullWidth clearable onClear={clearSearch} onValueChange={setSearch} placeholder={filterPlaceholder} value={search} />
			{headerContent}
		</>
	)

	return <Select items={filtered} headerContent={HeaderContent} {...props} />
}
