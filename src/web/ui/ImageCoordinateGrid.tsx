import { ImageViewerStoreContext } from '@shared/context'
import { Switch } from '@ui/components/Switch'
import { memo, useContext, useEffect } from 'react'
import { useSnapshot } from 'valtio'

export const ImageCoordinateGrid = memo(() => {
	const { coordinateGrid } = useContext(ImageViewerStoreContext)
	const { enabled } = useSnapshot(coordinateGrid.state)

	useEffect(coordinateGrid.mount, [])

	return (
		<div className="grid grid-cols-12 items-center gap-2 p-3">
			<Switch className="col-span-full min-w-0" label="Enabled" onValueChange={coordinateGrid.setEnabled} value={enabled} />
		</div>
	)
})
