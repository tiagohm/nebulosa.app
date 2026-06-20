import { memo, useContext } from 'react'
import { useSnapshot } from 'valtio'
import { ImageViewerStoreContext } from '../shared/context'
import { FITSHeader } from './FITSHeader'
import { Modal } from './Modal'

export const ImageHeader = memo(() => {
	const viewer = useContext(ImageViewerStoreContext)
	const { header } = viewer
	const { show } = useSnapshot(header.state)

	if (!show) return null

	return (
		<Modal header="FITS Header" id={`fitsheader-${viewer.image.id}`} initialWidth="296px" onHide={header.hide}>
			<Body />
		</Modal>
	)
})

const Body = memo(() => {
	const viewer = useContext(ImageViewerStoreContext)
	const { info } = useSnapshot(viewer.state)

	return <FITSHeader header={info?.headers ?? {}} />
})
