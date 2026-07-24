import { ImageViewerStoreContext } from '@shared/context'
import { formatNumber } from '@shared/util'
import { Icons } from '@ui/Icon'
import { memo, useContext } from 'react'
import { useSnapshot } from 'valtio'

export const ImageInfo = memo(() => {
	const viewer = useContext(ImageViewerStoreContext)
	const { info, scale, angle } = useSnapshot(viewer.state)

	if (!info) return null

	return (
		<div className="pointer-events-none absolute top-2 left-2 z-2 max-w-[calc(100vw-1rem)] rounded-2xl bg-black/60 p-3 text-sm opacity-80 select-none">
			<div className="flex min-w-0 flex-col gap-0">
				<div className="flex flex-row items-center gap-1">
					{info.width}x{info.height}
					<Icons.ZoomIn />
					{formatNumber(scale, 2)}
					<Icons.Restore />
					{formatNumber(angle, 1)}°
				</div>
			</div>
		</div>
	)
})
