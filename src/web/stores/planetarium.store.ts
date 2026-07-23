import { Api } from '@shared/api'
import { mountBus, planetariumBus } from '@shared/bus'
import { initProxy } from '@shared/proxy'
import { skyObjectName } from '@shared/util'
import { equipmentStore } from '@stores/equipment.store'
import { framingStore } from '@stores/framing.store'
import { settingsStore } from '@stores/settings.store'
import type { EquatorialCoordinate } from 'nebulosa/src/astronomy/coordinates/coordinate'
import { TAU } from 'nebulosa/src/core/constants'
import type { Mount } from 'nebulosa/src/devices/indi/device'
import { formatDEC, formatRA, toDeg } from 'nebulosa/src/math/units/angle'
import constellationBoundaries from 'src/data/constellation.boundaries.json'
import constellationLabels from 'src/data/constellation.labels.json'
import constellationLines from 'src/data/constellation.lines.json'
import mw from 'src/data/mw.json'
import type { Celestial, CelestialEventMap, CelestialShape, ConstellationData, MovingBody, ShapeRenderState, ViewTransform } from 'src/lib/celestial/celestial'
import { DEFAULT_BODY_POSITION, type BodyPosition, type PositionOfBody } from 'src/shared/types'
import { unsubscribe } from 'src/shared/util'
import { proxy, ref, subscribe } from 'valtio'

export interface PlanetariumState {
	celestial?: Celestial
	readonly transform: ViewTransform
	selected?: CelestialEventMap['click']
	selectedBodyPosition: BodyPosition
}

const CONSTELLATIONS = {
	lines: constellationLines as never,
	labels: constellationLabels,
	boundaries: constellationBoundaries as never,
} satisfies ConstellationData

const state = proxy<PlanetariumState>({
	selectedBodyPosition: structuredClone(DEFAULT_BODY_POSITION),
	transform: {
		x: 0,
		y: 0,
		k: 0.8,
	},
})

const u: VoidFunction[] = []
let mounted = false
let movingBodyUpdateGeneration = 0

function mount() {
	if (mounted) return unmount

	console.info('planetarium mounted')

	mounted = true

	u[0] = subscribe(settingsStore.state.location, updateLocationFromSettings)

	return unmount
}

function unmount() {
	if (!mounted) return
	console.info('planetarium unmounted')
	unsubscribe(u)
	mounted = false
}

const connectedMounts = new Map<string, CelestialShape>()

function renderMountShape(celestial: Celestial, ctx: CanvasRenderingContext2D, state: ShapeRenderState) {
	ctx.strokeStyle = '#03A9F4'
	ctx.fillStyle = '#03A9F4'
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

function renderSkyRegionShape(celestial: Celestial, ctx: CanvasRenderingContext2D, state: ShapeRenderState) {
	ctx.strokeStyle = '#3F51B5'
	ctx.fillStyle = '#3F51B5'
	ctx.beginPath()
	ctx.arc(state.x, state.y, 6, 0, TAU)
	ctx.stroke()
	ctx.beginPath()
	ctx.arc(state.x, state.y, 4, 0, TAU)
	ctx.fill()
	// ctx.textAlign = 'center'
	// ctx.textBaseline = 'middle'
	// ctx.fillText(state.shape.data as string, state.x, state.y - 12)
}

const SKY_REGION_SELECTION: CelestialShape = { id: 'sky.point', data: 'Sky Point', type: 'SKY POINT', coordinate: { rightAscension: 0, declination: 0 }, render: renderSkyRegionShape, visible: false }

function handleReady(celestial: Celestial) {
	state.celestial = ref(celestial)

	updateLocationFromSettings()
	celestial.loadConstellations(CONSTELLATIONS)
	celestial.loadMilkyWay(mw as never)
	celestial.setMagnitudeLimit(6)
	celestial.startAutoUpdate({ mode: 'realtime', interval: 30000 })
	celestial.addShape(SKY_REGION_SELECTION)

	for (const body of MOVING_BODIES) {
		celestial.addMovingBody(body)
	}

	function addMount(mount: Mount) {
		if (!connectedMounts.has(mount.id)) {
			const shape: CelestialShape = { id: mount.id, data: mount.name, type: 'MOUNT', coordinate: { ...mount.equatorialCoordinate }, render: renderMountShape, visible: mount.connected }
			connectedMounts.set(celestial.addShape(shape), shape)
		}
	}

	const u: VoidFunction[] = []

	u[0] = celestial.on('viewTransformChange', ({ transform }) => Object.assign(state.transform, transform))

	u[1] = celestial.on('updateEnd', ({ time }) => {
		void updateMovingBodies(celestial, time)
		void updateSelectedBodyPosition()
	})

	u[2] = mountBus.subscribe('add', (event) => {
		addMount(event)
	})

	u[3] = mountBus.subscribe('update:equatorialCoordinate', (event) => {
		const shape = connectedMounts.get(event.id)

		if (shape !== undefined) {
			shape.visible = true
			Object.assign(shape.coordinate, event.equatorialCoordinate)
			celestial.markShapeChanged(shape.id)
		}
	})

	u[4] = mountBus.subscribe('update:connected', (event) => {
		const shape = connectedMounts.get(event.id)

		if (shape !== undefined) {
			shape.visible = event.connected === true
			celestial.markShapeChanged(shape.id)
		}
	})

	u[5] = mountBus.subscribe('remove', (event) => {
		connectedMounts.delete(event.id) && celestial.removeShape(event.id)
	})

	u[6] = celestial.on('click', (event) => {
		state.selected = ref(event)
		void updateSelectedBodyPosition()

		if (event.object) {
			if (event.object.type === 'shape' && event.object.shape === SKY_REGION_SELECTION) {
				SKY_REGION_SELECTION.visible = true
			} else {
				return
			}
		} else if (event.event.detail === 2) {
			SKY_REGION_SELECTION.visible = true
			Object.assign(SKY_REGION_SELECTION.coordinate, event.coordinate)
		} else {
			return
		}

		celestial.markShapeChanged('sky.point')
	})

	u[7] = planetariumBus.subscribe('selectedObjectCoordinate', (): EquatorialCoordinate | undefined => {
		const { selectedObject } = celestial

		if (selectedObject) {
			switch (selectedObject.type) {
				case 'star':
					return selectedObject
				case 'deepSky':
					return selectedObject.object
				case 'movingBody':
					return selectedObject.object.position
				case 'shape':
					return selectedObject.shape.coordinate
				case 'constellationLabel':
					return selectedObject.label
			}
		}
	})

	u[8] = initProxy(state, 'planetarium', ['o:transform'])

	celestial.setViewTransform(state.transform)

	for (const mount of equipmentStore.state.mount) {
		addMount(mount)
	}

	void updateMovingBodies(celestial, Date.now())

	void Api.Atlas.planetarium({ types: [29], magnitudeLimit: 16 }).then((response) => {
		if (response?.length) {
			for (const star of response) {
				star.name = skyObjectName(star.name, star.constellation)!
			}

			celestial.loadStars(response)
		}
	})

	void Api.Atlas.planetarium({ types: [1, 2, 3, 4, 6, 7, 8, 9, 11, 12, 13, 14, 15, 16, 17, 18, 19], magnitudeLimit: 12 }).then((response) => {
		if (response?.length) {
			for (const star of response) {
				star.name = skyObjectName(star.name, star.constellation)!
			}

			celestial.loadDeepSkyObjects(response)
		}
	})

	return () => {
		unsubscribe(u)
		connectedMounts.clear()
	}
}

function updateLocationFromSettings() {
	const { location } = settingsStore.state
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
	const req: PositionOfBody = {
		time: { utc: time, offset: settingsStore.state.time.offset },
		location: settingsStore.state.location,
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

async function updateSelectedBodyPosition() {
	const object = state.selected?.object

	if (object) {
		const req: PositionOfBody = { location: settingsStore.state.location, time: { utc: Date.now(), offset: settingsStore.state.time.offset } }
		let task: Promise<BodyPosition | undefined> | undefined

		switch (object.type) {
			case 'star':
				task = Api.Atlas.positionOfSkyObject(req, object.id)
				break
			case 'deepSky':
				task = Api.Atlas.positionOfSkyObject(req, object.object.id)
				break
			case 'movingBody':
				task = Api.Atlas.positionOfPlanet(req, object.object.id)
				break
			case 'constellationLabel':
				task = Api.Atlas.positionOfSkyPoint(req, formatRA(object.label.rightAscension), formatDEC(object.label.declination))
				break
			case 'shape':
				task = Api.Atlas.positionOfSkyPoint(req, formatRA(object.shape.coordinate.rightAscension), formatDEC(object.shape.coordinate.declination))
				break
			default:
				return
		}

		const position = await task

		if (position) {
			state.selectedBodyPosition = position
		}
	}
}

function sync(mount?: Mount) {
	if (mount === undefined || !state.selected) return undefined
	const [rightAscension, declination] = state.selectedBodyPosition.equatorial
	return Api.Mounts.sync(mount, { type: 'JNOW', JNOW: { x: rightAscension, y: declination } })
}

function goTo(mount?: Mount) {
	if (mount === undefined || !state.selected) return undefined
	const [rightAscension, declination] = state.selectedBodyPosition.equatorial
	return Api.Mounts.goTo(mount, { type: 'JNOW', JNOW: { x: rightAscension, y: declination } })
}

function frame() {
	if (!state.selected) return undefined
	const [rightAscension, declination] = state.selectedBodyPosition.equatorialJ2000
	return framingStore.load({ rightAscension: formatRA(rightAscension), declination: formatDEC(declination) })
}

function handleDestroy(celestial: Celestial) {
	movingBodyUpdateGeneration++
	unlink()
}

function unlink() {
	state.celestial = undefined
}

export const planetariumStore = {
	state,
	mount,
	unmount,
	handleReady,
	sync,
	goTo,
	frame,
	handleDestroy,
	unlink,
} as const
