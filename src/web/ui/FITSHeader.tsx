import { useMolecule } from 'bunshi/react'
import type { FitsHeaderValue } from 'nebulosa/src/fits'
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

function FITSHeaderItem([key, value]: [string, FitsHeaderValue]) {
	return <ListItem label={value === true ? 'T' : value === false ? 'F' : value} description={key} />
}

const Body = memo(() => {
	const header = useMolecule(ImageHeaderMolecule)
	const { info } = useSnapshot(header.viewer.state)

	const entries = useMemo(() => Object.entries(info?.headers ?? {}), [info])

	return (
		<div className="mt-0 px-1 py-2">
			<List itemHeight={48} itemCount={entries.length}>
				{(i) => FITSHeaderItem(entries[i])}
			</List>
		</div>
	)
})
