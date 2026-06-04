import '@/index.css'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ToastProvider } from '@/ui/components/Toast'
import { Demo } from '@/ui/Demo'

import.meta.hot.accept()

// Mounts the web app with a shared toast provider.
function start() {
	const root: Root = (import.meta.hot.data.root ??= createRoot(document.getElementById('root')!))

	root.render(
		<React.StrictMode>
			<ToastProvider color="secondary" maxVisible={1} placement="top-end" size="sm">
				<main className="h-dvh w-dvw">
					<Demo />
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
