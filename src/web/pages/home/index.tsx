import { HeroUIProvider, ToastProvider } from '@heroui/react'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { Home } from '@/ui/Home'

function start() {
	const root = createRoot(document.getElementById('root')!)
	root.render(
		<React.StrictMode>
			<HeroUIProvider disableAnimation disableRipple>
				<ToastProvider
					maxVisibleToasts={1}
					placement='top-right'
					toastProps={{
						radius: 'sm',
						color: 'secondary',
						variant: 'solid',
						timeout: 2000,
						hideCloseButton: true,
					}}
				/>
				<main className='w-dvw h-dvh'>
					<Home />
				</main>
			</HeroUIProvider>
		</React.StrictMode>,
	)
}

if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', start)
} else {
	start()
}
