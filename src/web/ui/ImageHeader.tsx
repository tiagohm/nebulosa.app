import { ImageViewerStoreContext } from '@shared/context'
import { FITSHeader } from '@ui/FITSHeader'
import { memo, useContext, useEffect } from 'react'
import { useSnapshot } from 'valtio'

export const ImageHeader = memo(() => {
	const { state, header } = useContext(ImageViewerStoreContext)
	const { info } = useSnapshot(state)

	useEffect(header.mount, [])

	return (
		<div className="grid grid-cols-12 items-center gap-2 p-3">
			<FITSHeader header={info?.headers ?? {}} className="col-span-full h-full overflow-y-auto" />
		</div>
	)
})
