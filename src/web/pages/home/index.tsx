import { HeroUIProvider, ToastProvider } from '@heroui/react'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { Demo } from 'src/web/ui/Demo'

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
					<Demo />
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
