import { memo, useContext, useEffect } from 'react'
import { useSnapshot } from 'valtio'
import { ImageViewerStoreContext } from '../shared/context'
import { FITSHeader } from './FITSHeader'

export const ImageHeader = memo(() => {
	const { state, header } = useContext(ImageViewerStoreContext)
	const { info } = useSnapshot(state)

	useEffect(header.mount, [])

	return (
		<div className="grid h-full grid-cols-12 items-center gap-2 p-3">
			<FITSHeader header={info?.headers ?? {}} className="col-span-full h-full overflow-y-auto" />
		</div>
	)
})
