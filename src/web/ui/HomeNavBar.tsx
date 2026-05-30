import { memo } from 'react'
import { ConnectionPopover } from './ConnectionPopover'
import { HomeMenu } from './HomeMenu'
import { ImagePickerButton } from './ImagePickerButton'
import { IndiServerButton } from './IndiServerButton'
import { WakeLockScreenButton } from './WakeLockScreenButton'

export const HomeNavBar = memo(() => (
	<nav className="sticky top-0 z-1 w-full shrink-0 justify-center bg-neutral-900 shadow-none">
		<header className="flex h-16 min-w-0 items-center justify-center gap-3 px-3 sm:px-6">
			<div className="flex w-1/3 min-w-0 flex-row items-center justify-start"></div>
			<div className="flex w-1/3 shrink-0 flex-row items-center justify-center gap-2 sm:gap-4">
				<ConnectionPopover />
				<HomeMenu />
				<ImagePickerButton />
			</div>
			<div className="flex w-1/3 flex-row items-center justify-end gap-2">
				<IndiServerButton />
				<WakeLockScreenButton />
			</div>
		</header>
	</nav>
))
