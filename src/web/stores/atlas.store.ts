import { Api } from '@shared/api'
import type { AtlasAsteroidStore } from '@stores/atlas.asteroid.store'
import type { AtlasGalaxyStore } from '@stores/atlas.galaxy.store'
import type { AtlasMoonStore } from '@stores/atlas.moon.store'
import type { AtlasPlanetStore } from '@stores/atlas.planet.store'
import type { AtlasSatelliteStore } from '@stores/atlas.satellite.store'
import type { AtlasSunStore } from '@stores/atlas.sun.store'
import { settingsStore } from '@stores/settings.store'
import type { GeographicCoordinate } from 'nebulosa/src/astronomy/observer/location'
import { temporalAdd, temporalGet, temporalStartOfDay, temporalSubtract } from 'nebulosa/src/astronomy/time/temporal'
import type { Temporal } from 'nebulosa/src/astronomy/time/temporal'
import type { UTCTime } from 'nebulosa/src/devices/indi/device'
import { unsubscribe } from 'src/shared/util'
import { proxy } from 'valtio'
import type { Twilight } from '#/sun'

export type AtlasStore = typeof atlasStore

export type AtlasTab = (typeof TABS)[number]

const TABS = ['sun', 'moon', 'planet', 'asteroid', 'galaxy', 'satellite'] as const
const TICK_INTERVAL = 10000

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
	sun?: AtlasSunStore
	moon?: AtlasMoonStore
	planet?: AtlasPlanetStore
	asteroid?: AtlasAsteroidStore
	galaxy?: AtlasGalaxyStore
	satellite?: AtlasSatelliteStore
}

const state = proxy<AtlasState>({
	twilight: undefined,
})

let twilightUpdate = true
let twilightStartTime = 0
let mounted = false
const u: VoidFunction[] = []

function mount() {
	if (mounted) return unmount

	console.info('atlas mounted')

	mounted = true

	const timer = setInterval(tick, TICK_INTERVAL)
	u[0] = () => clearInterval(timer)

	void tick()

	return unmount
}

function unmount() {
	if (!mounted) return
	console.info('atlas unmounted')
	unsubscribe(u)
	mounted = false
}

async function tick(tab?: AtlasTab, utc?: Temporal) {
	if (!mounted) return

	const { offset } = settingsStore.state.time

	// utc ??= state.calendar.manual ? settingsStore.state.time.utc : Date.now()
	utc ??= Date.now()

	if (!twilightUpdate || twilightStartTime === 0) {
		const b = startTimeFrom(utc, offset)

		if (twilightStartTime !== b) {
			twilightUpdate = true
			twilightStartTime = b
		}
	}

	settingsStore.state.time.utc = utc
	const dateHasChanged = twilightUpdate

	await twilight()

	if (tab) {
		void state[tab]?.tick(settingsStore.state.time, dateHasChanged)
	} else {
		for (const tab of TABS) void state[tab]?.tick(settingsStore.state.time, dateHasChanged)
	}
}

async function twilight() {
	if (!twilightUpdate) return
	twilightUpdate = false
	const { time, location } = settingsStore.state
	const twilight = await Api.Atlas.twilight({ time, location })
	if (twilight) state.twilight = twilight
	else twilightUpdate = true
}

export function isLocationChanged(a: GeographicCoordinate, b: GeographicCoordinate) {
	return a.latitude !== b.latitude || a.longitude !== b.longitude || a.elevation !== b.elevation
}

export function isTimeChanged(a: UTCTime, b: UTCTime) {
	return Math.abs(a.utc - b.utc) >= TICK_INTERVAL || a.offset !== b.offset
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

export const atlasStore = {
	state,
	mount,
	unmount,
	tick,
}
