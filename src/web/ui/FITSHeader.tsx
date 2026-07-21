import { List, ListItem, type ListProps } from '@ui/components/List'
import type { FitsHeader, FitsHeaderCard, FitsHeaderValue } from 'nebulosa/src/io/formats/fits/fits'
import { memo, useMemo } from 'react'

export interface FITSHeaderProps extends Omit<ListProps, 'children' | 'itemCount'> {
	readonly header: FitsHeader
}

export const FITSHeader = memo(({ header, ...props }: FITSHeaderProps) => {
	const entries = useMemo(() => Object.entries(header ?? {}) as FitsHeaderCard[], [header])

	return (
		<List {...props} emptyContent="No headers" fullWidth itemCount={entries.length}>
			{(i) => FITSHeaderItem(entries[i])}
		</List>
	)
})

function formatFITSHeaderValue(value: FitsHeaderValue) {
	if (value === true) return 'T'
	if (value === false) return 'F'
	if (value === undefined) return '-'
	return String(value)
}

function FITSHeaderItem(entry: FitsHeaderCard | undefined) {
	if (entry === undefined) return null
	const [key, value] = entry
	return <ListItem label={formatFITSHeaderValue(value)} description={key} />
}
