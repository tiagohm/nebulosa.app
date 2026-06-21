import { toDeg } from 'nebulosa/src/angle'
import { TAU } from 'nebulosa/src/constants'
import type { Mount } from 'nebulosa/src/indi.device'
import type { Celestial, CelestialShape, ConstellationData, MovingBody, ShapeRenderState, ViewTransform } from 'src/lib/celestial/celestial'
import bus from 'src/shared/bus'
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
import { equipmentStore } from './equipment.store'

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
let movingBodyUpdateGeneration = 0

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

const connectedMounts = new Map<string, CelestialShape>()

function mountShapeRenderer(celestial: Celestial, ctx: CanvasRenderingContext2D, state: ShapeRenderState) {
	ctx.strokeStyle = 'blue'
	ctx.fillStyle = 'blue'
	ctx.beginPath()
	ctx.arc(state.x, state.y, 6, 0, TAU)
	ctx.stroke()
	ctx.beginPath()
	ctx.arc(state.x, state.y, 4, 0, TAU)
	ctx.fill()
	ctx.textAlign = 'center'
	ctx.textBaseline = 'middle'
	ctx.fillText(state.shape.data as string, state.x, state.y - 12)
}

function handleReady(celestial: Celestial) {
	state.celestial = ref(celestial)

	celestial.setViewTransform(state.transform)
	updateLocationFromAtlas()
	celestial.loadConstellations(CONSTELLATIONS)
	celestial.loadMilkyWay(mw as never)
	celestial.setMagnitudeLimit(6)
	celestial.startAutoUpdate({ mode: 'realtime', interval: 30000 })

	for (const body of MOVING_BODIES) {
		celestial.addMovingBody(body)
	}

	function addMount(mount: Mount) {
		if (!connectedMounts.has(mount.id)) {
			const shape: CelestialShape = { id: mount.id, data: mount.name, coordinate: { ...mount.equatorialCoordinate }, render: mountShapeRenderer, visible: mount.connected }
			connectedMounts.set(celestial.addShape(shape), shape)
		}
	}

	const u: VoidFunction[] = []
	let refreshed = false

	u[0] = celestial.on('viewTransformChange', ({ transform }) => Object.assign(state.transform, transform))

	u[1] = celestial.on('updateEnd', ({ time }) => {
		refreshed = true
		void updateMovingBodies(celestial, time)
	})

	u[2] = bus.subscribe<Mount>('mount:add', (event) => {
		addMount(event)
	})

	u[3] = bus.subscribe<Mount>('mount:update:equatorialCoordinate', (event) => {
		const shape = connectedMounts.get(event.id)

		if (shape !== undefined) {
			shape.visible = true
			Object.assign(shape.coordinate, event.equatorialCoordinate)

			if (refreshed) {
				refreshed = false
				celestial.markShapeChanged(shape.id)
			}
		}
	})

	u[4] = bus.subscribe<Mount>('mount:update:connected', (event) => {
		const shape = connectedMounts.get(event.id)

		if (shape !== undefined) {
			shape.visible = event.connected === true
			celestial.markShapeChanged(shape.id)
		}
	})

	u[5] = bus.subscribe<Mount>('mount:remove', (event) => {
		connectedMounts.delete(event.id) && celestial.removeShape(event.id)
	})

	for (const mount of equipmentStore.state.mount) {
		addMount(mount)
	}

	void updateMovingBodies(celestial, Date.now())

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

	return () => {
		unsubscribe(u)
		connectedMounts.clear()
	}
}

function updateLocationFromAtlas() {
	if (!state.show) return

	const { location } = atlasStore.state.request
	const latitude = toDeg(location.latitude)
	const longitude = toDeg(location.longitude)
	state.celestial?.setObserver({ latitude, longitude })
}

const MOVING_BODIES: MovingBody[] = [
	{
		id: '10',
		type: 'sun',
		name: 'Sun',
		position: { rightAscension: 0, declination: 0 },
		visible: false,
	},
	{
		id: '301',
		type: 'moon',
		name: 'Moon',
		position: { rightAscension: 0, declination: 0 },
		visible: false,
	},
	{
		id: '499',
		type: 'mars',
		name: 'Mars',
		position: { rightAscension: 0, declination: 0 },
		visible: false,
	},
	{
		id: '599',
		type: 'jupiter',
		name: 'Jupiter',
		position: { rightAscension: 0, declination: 0 },
		visible: false,
	},
	{
		id: '699',
		type: 'saturn',
		name: 'Saturn',
		position: { rightAscension: 0, declination: 0 },
		visible: false,
	},
	{
		id: '799',
		type: 'uranus',
		name: 'Uranus',
		position: { rightAscension: 0, declination: 0 },
		visible: false,
	},
	{
		id: '899',
		type: 'neptune',
		name: 'Neptune',
		position: { rightAscension: 0, declination: 0 },
		visible: false,
	},
	{
		id: '999',
		type: 'asteroid',
		name: 'Pluto',
		position: { rightAscension: 0, declination: 0 },
		visible: false,
	},
]

async function updateMovingBodies(celestial: Celestial, time: number) {
	const generation = ++movingBodyUpdateGeneration
	let dirty = false

	for (const body of MOVING_BODIES) {
		let success = false

		try {
			await positionOfMovingBody(body, time)
			success = true
		} catch (e) {
			console.error(e)
		}

		if (generation !== movingBodyUpdateGeneration || state.celestial !== celestial) {
			return
		}

		body.visible = success

		if (success) {
			dirty = true
		}
	}

	if (dirty && generation === movingBodyUpdateGeneration && state.celestial === celestial) {
		celestial.markMovingBodyDirty()
	}
}

async function positionOfMovingBody(body: MovingBody, time: number): Promise<MovingBody | undefined> {
	const { location } = atlasStore.state.request

	const req = {
		time: { utc: time, offset: 0 },
		location: {
			latitude: location.latitude,
			longitude: location.longitude,
			elevation: location.elevation ?? 0,
		},
	}

	// TODO: Use fast mode
	const position = body.id === '10' ? await Api.Atlas.positionOfSun(req) : body.id === '301' ? await Api.Atlas.positionOfMoon(req) : await Api.Atlas.positionOfPlanet(req, body.id)

	if (position) {
		body.magnitude = position.magnitude ?? undefined
		body.position.rightAscension = position.equatorial[0]
		body.position.declination = position.equatorial[1]
		return body
	}

	return undefined
}

function handleDestroy(celestial: Celestial) {
	movingBodyUpdateGeneration++
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
