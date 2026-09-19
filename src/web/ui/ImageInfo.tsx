import { ImageViewerStoreContext } from '@shared/context'
import { formatNumber } from '@shared/util'
import { IconButton } from '@ui/components/IconButton'
import { Popover } from '@ui/components/Popover'
import { SlideMenu } from '@ui/components/SlideMenu'
import type { SlideMenuEntry } from '@ui/components/SlideMenu'
import { Icons } from '@ui/Icon'
import { memo, useContext } from 'react'
import { useSnapshot } from 'valtio'

const MENU: readonly SlideMenuEntry[] = [
	{ id: 'invert', label: 'Invert', startContent: <Icons.InvertColor /> },
	{ id: 'horizontalMirror', label: 'Horizontal mirror', startContent: <Icons.FlipHorizontal /> },
	{ id: 'verticalMirror', label: 'Vertical mirror', startContent: <Icons.FlipVertical /> },
]

export const ImageInfo = memo(() => {
	const viewer = useContext(ImageViewerStoreContext)
	const { info, scale, angle } = useSnapshot(viewer.state)

	if (!info) return null

	return (
		<div className="pointer-events-none absolute top-2 left-2 z-2 max-w-[calc(100vw-1rem)] rounded-2xl bg-black/60 p-3 text-sm opacity-80 select-none">
			<div className="flex min-w-0 flex-col gap-0">
				<div className="flex flex-row items-center gap-2">
					<span>
						{info.width}x{info.height}
					</span>
					<span className="flex flex-row items-center gap-1">
						<Icons.ZoomIn />
						{formatNumber(scale, 2)}
					</span>
					<span className="flex flex-row items-center gap-1">
						<Icons.Restore />
						{formatNumber(angle, 1)}°
					</span>
					<Popover classNames={{ content: 'p-0' }} trigger={<IconButton className="pointer-events-auto" icon={Icons.DotsVertical} />}>
						<SlideMenu items={MENU} onAction={viewer.handleAction} />
					</Popover>
				</div>
			</div>
		</div>
	)
})
