import type { DetectedStar } from 'nebulosa/src/star.detector'
import bus from 'src/shared/bus'
import { DEFAULT_STAR_DETECTION, type StarDetection } from 'src/shared/types'
import { unsubscribe } from 'src/shared/util'
import { proxy } from 'valtio'
import { Api } from '../shared/api'
import { initProxy } from '../shared/proxy'
import { toast } from '../shared/toast'
import type { ImageLoaded } from '../shared/types'
import type { ImageViewerStore } from './image.viewer.store'

export type ImageStarDetectionStore = ReturnType<typeof imageStarDetectionStore>

export interface ImageStarDetectionState {
	show: boolean
	visible: boolean
	loading: boolean
	stars: readonly DetectedStar[]
	selected?: DetectedStar
	request: StarDetection
	readonly computed: {
		hfd: number
		snr: number
		fluxMin: number
		fluxMax: number
	}
}

export function imageStarDetectionStore(viewer: ImageViewerStore) {
	const state = proxy<ImageStarDetectionState>({
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

	console.info('image star detection created:', viewer.state.path)

	const u: VoidFunction[] = []
	let mounted = false
	let canvas: HTMLCanvasElement | undefined

	function mount() {
		if (mounted) return

		console.info('image star detection mounted:', viewer.state.path)

		mounted = true

		u[0] = initProxy(state, `image.${viewer.key}.star detection`, ['p:show', 'o:request'])

		u[1] = bus.subscribe<ImageLoaded>('image:load', ({ image, refreshed }) => {
			if (refreshed && image === viewer.image) {
				reset()
			}
		})
	}

	function unmount() {
		if (!mounted) return
		console.info('image star detection unmounted:', viewer.state.path)
		unsubscribe(u)
		mounted = false
	}

	function update<K extends keyof StarDetection>(key: K, value: StarDetection[K]) {
		state.request[key] = value
	}

	function toggle(enabled?: boolean) {
		state.visible = enabled ?? !state.visible
	}

	async function detect() {
		try {
			state.loading = true

			const request = { ...state.request, path: viewer.state.path }
			const stars = await Api.StarDetection.detect(request)

			if (!stars?.length) {
				toast({ title: 'STAR DETECTION', description: 'No stars detected', color: 'warning' })
				reset()
				return
			}

			state.selected = undefined
			clearCanvas()

			state.stars = stars
			state.visible = stars.length > 0

			let hfd = 0
			let snr = 0
			let fluxMin = Number.POSITIVE_INFINITY
			let fluxMax = Number.NEGATIVE_INFINITY

			for (const star of stars) {
				hfd += star.hfd
				snr += star.snr
				fluxMin = Math.min(fluxMin, star.flux)
				fluxMax = Math.max(fluxMax, star.flux)
			}

			if (stars.length > 0) {
				hfd /= stars.length
				snr /= stars.length
			} else {
				fluxMin = 0
				fluxMax = 0
			}

			state.computed.hfd = hfd
			state.computed.snr = snr
			state.computed.fluxMin = fluxMin
			state.computed.fluxMax = fluxMax
		} finally {
			state.loading = false
		}
	}

	function select(star: DetectedStar) {
		state.selected = star
		draw()
	}

	function draw() {
		if (!canvas) return

		const ctx = canvas.getContext('2d')
		if (!ctx) return

		ctx.clearRect(0, 0, canvas.width, canvas.height)

		if (!state.selected) return

		const { x, y } = state.selected
		const image = viewer.target

		if (image) {
			ctx.drawImage(image, x - 8.5, y - 8.5, 16, 16, 0, 0, canvas.width, canvas.height)
		}
	}

	function attach(element: HTMLCanvasElement | null) {
		if (canvas !== element) {
			canvas = element ?? undefined
			draw()
		}
	}

	function reset() {
		state.stars = []
		state.selected = undefined
		state.visible = false
		resetComputed()
		clearCanvas()
	}

	function clearCanvas() {
		if (!canvas) return

		const ctx = canvas.getContext('2d')
		ctx?.clearRect(0, 0, canvas.width, canvas.height)
	}

	function resetComputed() {
		state.computed.hfd = 0
		state.computed.snr = 0
		state.computed.fluxMin = 0
		state.computed.fluxMax = 0
	}

	function show() {
		state.show = true
	}

	function hide() {
		state.show = false
	}

	return {
		state,
		viewer,
		mount,
		unmount,
		update,
		toggle,
		detect,
		select,
		attach,
		reset,
		show,
		hide,
	} as const
}
