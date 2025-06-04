import '@/index.css'
import Home from '@/ui/Home'
import { HeroUIProvider } from '@heroui/react'
import React from 'react'
import { createRoot } from 'react-dom/client'

function start() {
	const root = createRoot(document.getElementById('root')!)
	root.render(
		<React.StrictMode>
			<HeroUIProvider>
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
