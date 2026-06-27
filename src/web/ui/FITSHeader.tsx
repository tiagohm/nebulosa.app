import type { FitsHeader, FitsHeaderCard, FitsHeaderValue } from 'nebulosa/src/io/formats/fits/fits'
import { memo, useMemo } from 'react'
import { List, ListItem } from './components/List'

export interface FITSHeaderProps extends Omit<React.ComponentProps<'div'>, 'children'> {
	readonly header: FitsHeader
}

export const FITSHeader = memo(({ header, ...props }: FITSHeaderProps) => {
	const entries = useMemo(() => Object.entries(header ?? {}) as FitsHeaderCard[], [header])

	return (
		<div {...props}>
			<List emptyContent="No headers" fullWidth itemCount={entries.length}>
				{(i) => FITSHeaderItem(entries[i])}
			</List>
		</div>
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
