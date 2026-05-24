import { memo, useContext } from 'react'
import { ImageViewerStoreContext } from '../shared/context'

export const ImageRoi = memo(() => {
	const viewer = useContext(ImageViewerStoreContext)
	const { image } = viewer

	return <div className="roi"></div>
})
