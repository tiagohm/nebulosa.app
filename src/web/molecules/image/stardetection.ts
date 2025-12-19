import { addToast } from '@heroui/react'
import { molecule, onMount, use } from 'bunshi'
import type { DetectedStar } from 'nebulosa/src/stardetector'
import bus, { unsubscribe } from 'src/shared/bus'
import { DEFAULT_STAR_DETECTION, type StarDetection } from 'src/shared/types'
import { proxy } from 'valtio'
import { Api } from '@/shared/api'
import { initProxy } from '@/shared/proxy'
import { type ImageLoaded, imageStorageKey } from '@/shared/types'
import { ImageViewerMolecule } from './viewer'

export interface StartDetectionState {
	show: boolean
	visible: boolean
	loading: boolean
	stars: readonly DetectedStar[]
	selected?: DetectedStar
	request: StarDetection
	computed: {
		hfd: number
		snr: number
		fluxMin: number
		fluxMax: number
	}
}

const stateMap = new Map<string, StartDetectionState>()

export const StarDetectionMolecule = molecule(() => {
	const viewer = use(ImageViewerMolecule)
	const { key } = viewer.scope.image

	const state =
		stateMap.get(key) ??
		proxy<StartDetectionState>({
			show: false,
			visible: false,
			loading: false,
			stars: [],
			request: structuredClone(DEFAULT_STAR_DETECTION),
			computed: {
				hfd: 0,
				snr: 0,
				fluxMin: 0,
				fluxMax: 0,
			},
		})

	stateMap.set(key, state)

	onMount(() => {
		const unsubscribers = new Array<VoidFunction>(2)

		unsubscribers[0] = bus.subscribe<ImageLoaded>('image:load', ({ image, newImage }) => {
			if (newImage && image.key === key) {
				reset()
			}
		})

		unsubscribers[1] = initProxy(state, `image.${imageStorageKey(viewer.scope.image)}.stardetection`, ['p:show', 'o:request'])

		return () => {
			unsubscribe(unsubscribers)
		}
	})

	function toggle(enabled?: boolean) {
		state.visible = enabled ?? !state.visible
	}

	async function detect() {
		try {
			state.loading = true

			const request = { ...state.request, path: viewer.path }
			const stars = await Api.StarDetection.detect(request)

			if (!stars) return

			if (stars.length === 0) {
				addToast({ description: 'No stars detected', color: 'warning', title: 'WARN' })
			}

			state.stars = stars
			state.visible = stars.length > 0

			let hfd = 0
			let snr = 0
			let fluxMin = Number.MAX_VALUE
			let fluxMax = Number.MIN_VALUE

			for (const star of stars) {
				hfd += star.hfd
				snr += star.snr
				fluxMin = Math.min(fluxMin, star.flux)
				fluxMax = Math.max(fluxMax, star.flux)
			}

			if (stars.length) {
				hfd /= stars.length
				snr /= stars.length
			} else {
				fluxMin = 0
				fluxMax = 0
			}

			state.computed = { hfd, snr, fluxMin, fluxMax }
		} finally {
			state.loading = false
		}
	}

	function select(star: DetectedStar) {
		state.selected = star

		const canvas = document.getElementById(`${key}-selected-star`) as HTMLCanvasElement | null

		if (!canvas) return

		const ctx = canvas.getContext('2d')
		const image = document.getElementById(key) as HTMLImageElement
		ctx?.drawImage(image, star.x - 8.5, star.y - 8.5, 16, 16, 0, 0, canvas.width, canvas.height)
	}

	function reset() {
		if (state.stars.length) {
			state.stars = []
			state.selected = undefined
			state.computed.hfd = 0
			state.computed.snr = 0
			state.computed.fluxMin = 0
			state.computed.fluxMax = 0
		}
	}

	function show() {
		state.show = true
	}

	function hide() {
		state.show = false
	}

	return { state, viewer, scope: viewer.scope, toggle, detect, select, reset, show, hide } as const
})
