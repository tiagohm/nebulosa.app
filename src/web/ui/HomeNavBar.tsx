import { memo } from 'react'
import { ConnectionBox } from './ConnectionBox'
import { HomeMenu } from './HomeMenu'
import { ImagePickerButton } from './ImagePickerButton'
import { IndiServerButton } from './IndiServerButton'
import { WakeLockScreenButton } from './WakeLockScreenButton'

export const HomeNavBar = memo(() => (
	<nav className="sticky top-0 z-1 w-full shrink-0 justify-center bg-neutral-900 shadow-none">
		<header className="flex h-16 min-w-0 items-center justify-center gap-3 px-3 sm:px-6">
			<div className="flex min-w-0 items-center">
				<ConnectionBox />
			</div>
			<ul className="flex shrink-0 items-center justify-end gap-2 sm:gap-4">
				<li className="flex flex-row items-center gap-2">
					<HomeMenu />
					<ImagePickerButton />
				</li>
				<li className="flex flex-row items-center gap-2">
					<IndiServerButton />
					<WakeLockScreenButton />
				</li>
			</ul>
		</header>
	</nav>
))
