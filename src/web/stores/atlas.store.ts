import type { GeographicCoordinate } from 'nebulosa/src/astronomy/observer/location'
import { temporalAdd, temporalGet, temporalStartOfDay, temporalSubtract, type Temporal } from 'nebulosa/src/astronomy/time/temporal'
import type { Mount, UTCTime } from 'nebulosa/src/devices/indi/device'
import { formatDEC, formatRA } from 'nebulosa/src/math/units/angle'
import { DEFAULT_GEOGRAPHIC_COORDINATE, type Framing, type LocationAndTime, type Twilight } from 'src/shared/types'
import { proxy } from 'valtio'
import { subscribeKey } from 'valtio/utils'
import { Api } from '../shared/api'
import { initProxy } from '../shared/proxy'
import type { AtlasAsteroidStore } from './atlas.asteroid.store'
import type { AtlasGalaxyStore } from './atlas.galaxy.store'
import type { AtlasMoonStore } from './atlas.moon.store'
import type { AtlasPlanetStore } from './atlas.planet.store'
import type { AtlasSatelliteStore } from './atlas.satellite.store'
import type { AtlasSunStore } from './atlas.sun.store'
import { framingStore } from './framing.store'

export type AtlasStore = typeof atlasStore

export type AtlasTab = 'sun' | 'moon' | 'planet' | 'asteroid' | 'galaxy' | 'satellite'

export interface BookmarkItem {
	readonly name: string
	readonly type: AtlasTab
	readonly code: string // planet code, asteroid spk id, galaxy id, satellite id
}

export interface AtlasState {
	show: boolean
	tab: AtlasTab
	twilight?: Twilight
	readonly request: LocationAndTime
	sun?: AtlasSunStore
	moon?: AtlasMoonStore
	planet?: AtlasPlanetStore
	asteroid?: AtlasAsteroidStore
	galaxy?: AtlasGalaxyStore
	satellite?: AtlasSatelliteStore
	readonly calendar: {
		manual: boolean
	}
	readonly location: {
		show: boolean
	}
	readonly bookmark: {
		readonly items: BookmarkItem[]
	}
}

const state = proxy<AtlasState>({
	show: false,
	tab: 'sun',
	twilight: undefined,
	request: {
		location: structuredClone(DEFAULT_GEOGRAPHIC_COORDINATE),
		time: {
			utc: 0,
			offset: 0,
		},
	},
	calendar: {
		manual: false,
	},
	location: {
		show: false,
	},
	bookmark: {
		items: [],
	},
})

initProxy(state, 'atlas', ['p:show', 'p:tab', 'o:bookmark'])
initProxy(state.request, 'atlas', ['o:location'])
initProxy(state.request.time, 'atlas.time', ['p:offset'])

const TABS = ['sun', 'moon', 'planet', 'asteroid', 'galaxy', 'satellite'] as const

let updating = false
let twilightUpdate = true
let twilightStartTime = 0

subscribeKey(state, 'show', (show) => show && tick())
subscribeKey(state, 'tab', () => tick())

setInterval(tick, 60000)

if (state.show) {
	void tick()
}

function updateTime(utc: number, offset: number, manual: boolean = true) {
	state.request.time.offset = offset
	state.calendar.manual = manual
	void tick(utc)
}

function updateLocation(location: GeographicCoordinate) {
	twilightUpdate ||= isLocationChanged(location, state.request.location)
	Object.assign(state.request.location, location)
	void tick()
}

async function tick(utc?: Temporal) {
	if (!state.show || updating) return

	updating = true

	try {
		const { time, location } = state.request

		utc ??= state.calendar.manual ? time.utc : Date.now()

		if (!twilightUpdate || twilightStartTime === 0) {
			const b = startTimeFrom(utc, time.offset)

			if (twilightStartTime !== b) {
				twilightUpdate = true
				twilightStartTime = b
			}
		}

		time.utc = utc
		const dateHasChanged = twilightUpdate

		await twilight()

		if (state.tab === 'sun') void state.sun!.tick(time, location, dateHasChanged)
		else if (state.tab === 'moon') void state.moon!.tick(time, location, dateHasChanged)
		else if (state.tab === 'planet') void state.planet!.tick(time, location, dateHasChanged)
		else if (state.tab === 'asteroid') void state.asteroid!.tick(time, location, dateHasChanged)
		else if (state.tab === 'galaxy') void state.galaxy!.tick(time, location, dateHasChanged)
		else if (state.tab === 'satellite') void state.satellite!.tick(time, location, dateHasChanged)
	} finally {
		updating = false
	}
}

async function twilight() {
	if (!twilightUpdate) return
	twilightUpdate = false
	const twilight = await Api.Atlas.twilight(state.request)
	if (twilight) state.twilight = twilight
	else twilightUpdate = true
}

function sync(mount?: Mount) {
	if (!mount) return undefined
	const { position } = state[state.tab]!.state
	const [rightAscension, declination] = position.equatorial
	return Api.Mounts.sync(mount, { type: 'JNOW', JNOW: { x: rightAscension, y: declination } })
}

function goTo(mount?: Mount) {
	if (!mount) return undefined
	const { position } = state[state.tab]!.state
	const [rightAscension, declination] = position.equatorial
	return Api.Mounts.goTo(mount, { type: 'JNOW', JNOW: { x: rightAscension, y: declination } })
}

function frame() {
	const { position } = state[state.tab]!.state
	const [rightAscension, declination] = position.equatorialJ2000
	const request: Partial<Framing> = { rightAscension: formatRA(rightAscension), declination: formatDEC(declination) }
	return framingStore.load(request)
}

function toggleBookmark(type: AtlasTab, name: string, code: string, favorite: boolean) {
	const { items } = state.bookmark

	if (favorite) {
		if (!items.some((e) => e.type === type && e.code === code)) {
			items.push({ type, name, code })
		}
	} else {
		const index = items.findIndex((e) => e.type === type && e.code === code)
		index >= 0 && items.splice(index, 1)
	}
}

function selectBookmark({ type, code }: BookmarkItem) {
	if (type === 'planet') void state.planet!.select(code, false)
	else if (type === 'asteroid') void state.asteroid!.select(code)
	else if (type === 'galaxy') void state.galaxy!.select(+code, 0, false, false)
	else if (type === 'satellite') void state.satellite!.select(+code, 0, false, false)

	state.tab = type
}

function removeBookmark(item: BookmarkItem) {
	toggleBookmark(item.type, item.name, item.code, false)
}

function showLocation() {
	state.location.show = true
}

function hideLocation() {
	state.location.show = false
}

function handleTabWheel(event: React.WheelEvent) {
	if (event.deltaY === 0) return
	const { tab } = state
	const index = event.deltaY < 0 ? (TABS.indexOf(tab) + 1) % TABS.length : (TABS.indexOf(tab) + TABS.length - 1) % TABS.length
	state.tab = TABS[index]
}

function show() {
	state.show = true
}

function hide() {
	state.show = false
}

export const atlasStore = {
	state,
	updateTime,
	updateLocation,
	sync,
	goTo,
	frame,
	toggleBookmark,
	selectBookmark,
	removeBookmark,
	showLocation,
	hideLocation,
	handleTabWheel,
	show,
	hide,
}

export function isLocationChanged(a: GeographicCoordinate, b: GeographicCoordinate) {
	return a.latitude !== b.latitude || a.longitude !== b.longitude || a.elevation !== b.elevation
}

export function isTimeChanged(a: UTCTime, b: UTCTime) {
	return Math.abs(a.utc - b.utc) >= 60000 || a.offset !== b.offset
}

function startTimeFrom(utc: number, offset: number) {
	const local = temporalAdd(utc, offset, 'm')
	const hour = temporalGet(local, 'h')

	let startTime = temporalStartOfDay(local)
	// if not passed noon, go to the previous day
	if (hour < 12) startTime = temporalSubtract(startTime, 1, 'd')
	// set to UTC noon + local offset (if enabled)
	return temporalAdd(startTime, 720 - offset, 'm')
}
