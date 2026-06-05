import { toDeg } from 'nebulosa/src/angle'
import type { Celestial, ConstellationData, ShapeRenderState, ViewTransform } from 'src/lib/celestial/celestial'
import { proxy, ref, subscribe } from 'valtio'
import constellationBoundaries from '@/../data/constellation.boundaries.json' with { type: 'json' }
import constellationLabels from '@/../data/constellation.labels.json' with { type: 'json' }
import constellationLines from '@/../data/constellation.lines.json' with { type: 'json' }
import mw from '@/../data/mw.json' with { type: 'json' }
import { initProxy } from '../shared/proxy'
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

subscribe(atlasStore.state.request.location, updateLocationFromAtlas)

function mount() {
	console.info('planetarium mounted')
}

function unmount() {
	console.info('planetarium unmounted')
}

function handleReady(celestial: Celestial) {
	state.celestial = ref(celestial)

	celestial.setViewTransform(state.transform)
	celestial.loadConstellations(CONSTELLATIONS)
	// celestial.loadDeepSkyObjects(SKY_MAP_DEEP_SKY_OBJECTS)
	// celestial.loadStars(SKY_MAP_STARS)
	celestial.loadMilkyWay(mw as never)
	updateLocationFromAtlas()
	celestial.setMagnitudeLimit(6)
	celestial.startAutoUpdate({ mode: 'realtime', interval: 15000 })
	celestial.on('viewTransformChange', ({ transform }) => Object.assign(state.transform, transform))
}

function updateLocationFromAtlas() {
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
