import { useMolecule } from 'bunshi/react'
import type { FitsHeaderCard, FitsHeaderValue } from 'nebulosa/src/fits'
import { memo, useMemo } from 'react'
import { useSnapshot } from 'valtio'
import { ImageHeaderMolecule } from '@/molecules/image/header'
import { List, ListItem } from './components/List'
import { Modal } from './Modal'

export const FITSHeader = memo(() => {
	const header = useMolecule(ImageHeaderMolecule)

	return (
		<Modal header="FITS Header" id={`fits-header-${header.viewer.storageKey}`} maxWidth="296px" onHide={header.hide}>
			<Body />
		</Modal>
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

const Body = memo(() => {
	const header = useMolecule(ImageHeaderMolecule)
	const { info } = useSnapshot(header.viewer.state)
	const headers = info?.headers

	const entries = useMemo(() => Object.entries(headers ?? {}) as FitsHeaderCard[], [headers])

	return (
		<div className="mt-0 px-1 py-2">
			<List emptyContent="No headers" fullWidth itemCount={entries.length}>
				{(i) => FITSHeaderItem(entries[i])}
			</List>
		</div>
	)
})
