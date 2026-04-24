import '@/index.css'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { ToastProvider } from 'src/web/ui/components/Toast'
import { Home } from 'src/web/ui/Home'

// Mounts the web app with a shared toast provider.
function start() {
	const root = createRoot(document.getElementById('root')!)
	root.render(
		<React.StrictMode>
			<ToastProvider color="secondary" delay={2000} maxVisible={1} placement="top-end" size="sm">
				<main className="h-dvh w-dvw">
					<Home />
				</main>
			</ToastProvider>
		</React.StrictMode>,
	)
}

if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', start)
} else {
	start()
}
