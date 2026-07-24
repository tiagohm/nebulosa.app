import { List } from '@ui/components/List'
import type { ListProps } from '@ui/components/List'
import { TextInput } from '@ui/components/TextInput'
import { useDebounce } from '@uidotdev/usehooks'
import { useMemo, useState } from 'react'

export type FilterableListItemRenderer<T> = (item: T, index: number) => React.ReactNode

export interface FilterableListProps<T> extends Omit<ListProps, 'children' | 'items' | 'itemCount'> {
	readonly items: readonly Readonly<T>[]
	readonly filter: (item: T, search: string) => boolean
	readonly filterPlaceholder?: string
	readonly children: FilterableListItemRenderer<T>
	readonly disabled?: boolean
}

export function FilterableList<T>({ items, filter, filterPlaceholder = 'Search', disabled, children, ...props }: FilterableListProps<T>) {
	const [search, setSearch] = useState('')
	const debouncedSearch = useDebounce(search, 500)

	const filtered = useMemo(() => {
		const text = debouncedSearch.toLowerCase().trim()
		return items.length > 0 && text ? items.filter((item) => filter(item, text)) : items
	}, [debouncedSearch, items])

	return (
		<div className="col-span-full flex w-full flex-1 flex-col gap-2">
			<TextInput disabled={disabled || items.length === 0} fullWidth onValueChange={setSearch} placeholder={filterPlaceholder} value={search} />
			<List itemCount={filtered.length} emptyContent="No bookmarks" {...props}>
				{(i) => children(filtered[i], i)}
			</List>
		</div>
	)
}
