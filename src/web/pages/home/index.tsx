import '@/index.css'
import { HeroUIProvider, ToastProvider } from '@heroui/react'
import React from 'react'
import { createRoot } from 'react-dom/client'
import Home from '@/ui/Home'

function start() {
	const root = createRoot(document.getElementById('root')!)
	root.render(
		<React.StrictMode>
			<HeroUIProvider disableAnimation disableRipple>
				<ToastProvider
					placement='top-center'
					toastProps={{
						radius: 'sm',
						color: 'secondary',
						variant: 'solid',
						timeout: 3000,
						hideCloseButton: true,
					}}
				/>
				<main className='w-screen h-screen'>
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
