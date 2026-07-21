import { ImageViewerStoreContext } from '@shared/context'
import { FITSHeader } from '@ui/FITSHeader'
import { memo, useContext, useEffect } from 'react'
import { useSnapshot } from 'valtio'

export const ImageHeader = memo(() => {
	const { state, header } = useContext(ImageViewerStoreContext)
	const { info } = useSnapshot(state)

	useEffect(header.mount, [])

	return <FITSHeader header={info?.headers ?? {}} className="flex h-full overflow-y-auto" />
})
