import { Api } from '@shared/api'
import type { AtlasAsteroidStore } from '@stores/atlas.asteroid.store'
import type { AtlasGalaxyStore } from '@stores/atlas.galaxy.store'
import type { AtlasMoonStore } from '@stores/atlas.moon.store'
import type { AtlasPlanetStore } from '@stores/atlas.planet.store'
import type { AtlasSatelliteStore } from '@stores/atlas.satellite.store'
import type { AtlasSunStore } from '@stores/atlas.sun.store'
import type { GeographicCoordinate } from 'nebulosa/src/astronomy/observer/location'
import { temporalAdd, temporalGet, temporalStartOfDay, temporalSubtract, type Temporal } from 'nebulosa/src/astronomy/time/temporal'
import type { UTCTime } from 'nebulosa/src/devices/indi/device'
import { DEFAULT_GEOGRAPHIC_COORDINATE, type LocationAndTime, type Twilight } from 'src/shared/types'
import { proxy } from 'valtio'

export type AtlasStore = typeof atlasStore

export type AtlasTab = 'sun' | 'moon' | 'planet' | 'asteroid' | 'galaxy' | 'satellite'

export interface BookmarkItem {
	readonly name: string
	readonly type: AtlasTab
	readonly code: string // planet code, asteroid spk id, galaxy id, satellite id
}

export interface TagItem {
	readonly label: string
	readonly color: 'primary' | 'success' | 'warning' | 'danger' | 'secondary'
}

export interface AtlasState {
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
	readonly bookmark: {
		readonly items: BookmarkItem[]
	}
}

const state = proxy<AtlasState>({
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
	bookmark: {
		items: [],
	},
})

const pendingTabs = new Set<AtlasTab>()
let twilightUpdate = true
let twilightStartTime = 0

function updateTime(tab: AtlasTab, utc: number, offset: number, manual: boolean = true) {
	state.request.time.offset = offset
	state.calendar.manual = manual
	void tick(tab, utc)
}

function updateLocation(tab: AtlasTab, location: GeographicCoordinate) {
	twilightUpdate ||= isLocationChanged(location, state.request.location)
	Object.assign(state.request.location, location)
	void tick(tab)
}

async function tick(tab: AtlasTab, utc?: Temporal) {
	if (pendingTabs.has(tab)) return

	pendingTabs.add(tab)

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

		void state[tab]!.tick(time, location, dateHasChanged)
	} finally {
		pendingTabs.delete(tab)
	}
}

async function twilight() {
	if (!twilightUpdate) return
	twilightUpdate = false
	const twilight = await Api.Atlas.twilight(state.request)
	if (twilight) state.twilight = twilight
	else twilightUpdate = true
}

export function toggleBookmark(type: AtlasTab, name: string, code: string, favorite: boolean) {
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

export function selectBookmark({ type, code }: BookmarkItem) {
	if (type === 'planet') void state.planet!.select(code, false)
	else if (type === 'asteroid') void state.asteroid!.select(code)
	else if (type === 'galaxy') void state.galaxy!.select(+code, 0, false, false)
	else if (type === 'satellite') void state.satellite!.select(+code, 0, false, false)
}

export function removeBookmark(item: BookmarkItem) {
	toggleBookmark(item.type, item.name, item.code, false)
}

export const atlasStore = {
	state,
	tick,
	updateTime,
	updateLocation,
	toggleBookmark,
	selectBookmark,
	removeBookmark,
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
