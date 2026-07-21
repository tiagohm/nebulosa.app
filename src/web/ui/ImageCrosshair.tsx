import { ImageViewerStoreContext } from '@shared/context'
import { Switch } from '@ui/components/Switch'
import { memo, useContext, useEffect } from 'react'
import { useSnapshot } from 'valtio'

export const ImageCrosshair = memo(() => {
	const { crosshair } = useContext(ImageViewerStoreContext)
	const { enabled } = useSnapshot(crosshair.state)

	useEffect(crosshair.mount, [])

	return (
		<div className="grid grid-cols-12 items-center gap-2 p-3">
			<Switch className="col-span-full min-w-0" label="Enabled" onValueChange={(value) => crosshair.update('enabled', value)} value={enabled} />
		</div>
	)
})
