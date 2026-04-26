import { memo } from 'react'
import { ConnectionBox } from './ConnectionBox'
import { HomeMenu } from './HomeMenu'
import { ImagePickerButton } from './ImagePickerButton'
import { IndiServerButton } from './IndiServerButton'
import { WakeLockScreenButton } from './WakeLockScreenButton'

export const HomeNavBar = memo(() => {
	return (
		<nav className="sticky top-0 z-1 w-full bg-neutral-900 shadow-none">
			<header className="flex h-16 items-center justify-center gap-6 px-6">
				<div className="flex items-center justify-center gap-3">
					<ConnectionBox />
				</div>
				<ul className="flex items-center justify-center gap-4">
					<li className="flex flex-row items-center justify-start gap-2">
						<HomeMenu />
						<ImagePickerButton />
					</li>
					<li className="flex flex-1 flex-row justify-end gap-2">
						<IndiServerButton />
						<WakeLockScreenButton />
					</li>
				</ul>
			</header>
		</nav>
	)
})
