import '@/index.css'
import { ToastProvider } from '@ui/components/Toast'
import { Home } from '@ui/Home'
import React from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { speedUpTime } from 'src/shared/util'

speedUpTime()

// TODO: load IERSB from Atlas endpoint

import.meta.hot.accept()

// Mounts the web app with a shared toast provider.
function start() {
	const root: Root = (import.meta.hot.data.root ??= createRoot(document.getElementById('root')!))

	root.render(
		<React.StrictMode>
			<ToastProvider color="secondary" maxVisible={1} placement="top-end" size="sm">
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
