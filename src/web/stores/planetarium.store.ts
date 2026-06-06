import { toDeg } from 'nebulosa/src/angle'
import type { Celestial, ConstellationData, ShapeRenderState, ViewTransform } from 'src/lib/celestial/celestial'
import { unsubscribe } from 'src/shared/util'
import { proxy, ref, subscribe } from 'valtio'
import constellationBoundaries from '@/../data/constellation.boundaries.json'
import constellationLabels from '@/../data/constellation.labels.json'
import constellationLines from '@/../data/constellation.lines.json'
import mw from '@/../data/mw.json'
import { Api } from '../shared/api'
import { initProxy } from '../shared/proxy'
import { skyObjectName } from '../shared/util'
import { atlasStore } from './atlas.store'

export interface PlanetariumState {
	show: boolean
	celestial?: Celestial
	readonly transform: ViewTransform
}

const CONSTELLATIONS = {
	lines: constellationLines as never,
	labels: constellationLabels,
	boundaries: constellationBoundaries as never,
} satisfies ConstellationData

const state = proxy<PlanetariumState>({
	show: false,
	transform: {
		x: 0,
		y: 0,
		k: 0.8,
	},
})

initProxy(state, 'planetarium', ['p:show', 'o:transform'])

const u: VoidFunction[] = []
let mounted = false

function mount() {
	if (mounted) return

	console.info('planetarium mounted')

	mounted = true

	u[0] = subscribe(atlasStore.state.request.location, updateLocationFromAtlas)
}

function unmount() {
	if (!mounted) return
	console.info('planetarium unmounted')
	unsubscribe(u)
	mounted = false
}

function handleReady(celestial: Celestial) {
	state.celestial = ref(celestial)

	celestial.setViewTransform(state.transform)
	updateLocationFromAtlas()
	celestial.loadConstellations(CONSTELLATIONS)
	celestial.loadMilkyWay(mw as never)
	celestial.setMagnitudeLimit(6)
	celestial.startAutoUpdate({ mode: 'realtime', interval: 15000 })
	celestial.on('viewTransformChange', ({ transform }) => Object.assign(state.transform, transform))

	void Api.Atlas.planetarium({ types: [29], magnitudeLimit: 16 }).then((response) => {
		if (response?.length) {
			for (const star of response) {
				star.name = skyObjectName(star.name!, star.constellation)
			}

			celestial.loadStars(response)
		}
	})

	void Api.Atlas.planetarium({ types: [1, 2, 3, 4, 6, 7, 8, 9, 11, 12, 13, 14, 15, 16, 17, 18, 19], magnitudeLimit: 12 }).then((response) => {
		if (response?.length) {
			for (const star of response) {
				star.name = skyObjectName(star.name!, star.constellation)
			}

			celestial.loadDeepSkyObjects(response)
		}
	})
}

function updateLocationFromAtlas() {
	if (!state.show) return

	const { location } = atlasStore.state.request
	const latitude = toDeg(location.latitude)
	const longitude = toDeg(location.longitude)
	state.celestial?.setObserver({ latitude, longitude })
}

function handleDestroy(celestial: Celestial) {
	unlink()
}

function renderTelescope(celestial: Celestial, ctx: CanvasRenderingContext2D, state: ShapeRenderState) {
	ctx.fillStyle = 'red'
	ctx.beginPath()
	ctx.rect(state.x - 2, state.y - 2, 4, 4)
	ctx.fill()
}

function unlink() {
	state.celestial = undefined
}

function show() {
	state.show = true
}

function hide() {
	state.show = false
}

function toggle() {
	state.show = !state.show
}

export const planetariumStore = {
	state,
	mount,
	unmount,
	handleReady,
	handleDestroy,
	renderTelescope,
	unlink,
	show,
	hide,
	toggle,
} as const
