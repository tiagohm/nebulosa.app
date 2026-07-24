import '@/index.css'
import { ToastProvider } from '@ui/components/Toast'
import { Home } from '@ui/Home'
import { eraPnm06a, eraPmat06, eraNut06a } from 'nebulosa/src/astronomy/coordinates/erfa/erfa'
import { TIME_PROVIDERS, toJulianDay } from 'nebulosa/src/astronomy/time/time'
import type { MutMat3 } from 'nebulosa/src/math/linear-algebra/mat3'
import type { Angle } from 'nebulosa/src/math/units/angle'
import React from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'

// Speed up Time by caching some expensive ERFA calls.
// The cache is keyed by the rounded Julian epoch, which is the same for all times in a given day.

const PNM_CACHE = new Map<number, MutMat3>()
const PMAT_CACHE = new Map<number, MutMat3>()
const NUT_CACHE = new Map<number, [Angle, Angle]>()

TIME_PROVIDERS.pnm = (time) => PNM_CACHE.getOrInsertComputed(Math.round(toJulianDay(time)), () => eraPnm06a(time.day, time.fraction))
TIME_PROVIDERS.pmat = (time) => PMAT_CACHE.getOrInsertComputed(Math.round(toJulianDay(time)), () => eraPmat06(time.day, time.fraction))
TIME_PROVIDERS.nut = (time) => NUT_CACHE.getOrInsertComputed(Math.round(toJulianDay(time)), () => eraNut06a(time.day, time.fraction))

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
