import { useDebounce } from '@uidotdev/usehooks'
import { useMemo, useState } from 'react'
import { List, type ListProps } from './List'
import { SearchTextInput } from './SearchTextInput'

export type FilterableListItemRenderer<T> = (item: T, index: number) => React.ReactNode

export interface FilterableListProps<T> extends Omit<ListProps, 'children' | 'items' | 'itemCount'> {
	readonly items: readonly Readonly<T>[]
	readonly filter: (item: T, search: string) => boolean
	readonly filterPlaceholder?: string
	readonly minLengthToSearch?: number
	readonly children: FilterableListItemRenderer<T>
}

export function FilterableList<T>({ items, filter, filterPlaceholder = 'Search', minLengthToSearch = 3, children, ...props }: FilterableListProps<T>) {
	const [search, setSearch] = useState('')
	const debouncedSearch = useDebounce(search, 500)

	const filtered = useMemo(() => {
		const text = debouncedSearch.toLowerCase().trim()
		return items.length > 0 && text ? items.filter((item) => filter(item, text)) : items
	}, [debouncedSearch, items])

	return (
		<div>
			<SearchTextInput fullWidth minLengthToSearch={minLengthToSearch} onValueChange={setSearch} placeholder={filterPlaceholder} value={search} />
			<List itemCount={filtered.length} {...props}>
				{(i) => children(filtered[i], i)}
			</List>
		</div>
	)
}
