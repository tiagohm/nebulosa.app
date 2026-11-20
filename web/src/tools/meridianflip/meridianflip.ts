import type { MeridianAvailability, MeridianFlipMonitor, MeridianFlipSettings, MeridianFlipSnapshot, MeridianFlipTransition, MeridianMountView, MeridianTiming, MeridianTimingPhase, ServerEvent } from 'api'
import { PI, SIDEREAL_DRIFT_RATE, TAU } from 'nebulosa/src/core/constants'
import type { MountType } from 'nebulosa/src/devices/indi/device'
import { proxy } from 'valtio'
import { formatClockDuration } from '../../format'
import { type ApiFetch, browserFetch, jsonInit, responseError } from '../../http'
import { MERIDIAN_FLIP_MAXIMUM_SECONDS } from '../../profile/schema'
import type { ViewEntry } from '../../profile/view'
import type { StatusTone } from '../../ui/StatusBadge'

// Mirror of the Meridian Flip Monitors of the server, of every mount and connection, their recent transitions, and the
// requests this tab sends to enable, disable, and update them, with the words and interpolations the tool and the
// status bar read them by, and the section of the tool this tab shows. The monitors are the server's: this mirror is fed by
// GET /api/meridian-flip and the meridianFlip:updated and meridianFlip:transition events, and no tab, profile, or
// route change enables, disables, or redirects one. Revisions order the snapshot and the events within one server
// process (epoch), so a snapshot or a response older than an event already applied never brings back a disabled
// monitor. Every decision is the server's; the tab only interpolates countdowns between publications.

// Most transitions kept per monitor, as the server keeps them.
const TRANSITION_HISTORY = 100

// Longest a setting of the settle time may be, in seconds; a mount settles in a few seconds.
export const MERIDIAN_FLIP_MAXIMUM_SETTLE_SECONDS = 600

// Age of a sample after which its forecast is stale, in milliseconds: two missed publications of the server, which
// publishes an unchanged monitor at least every 30 s.
export const MERIDIAN_FLIP_STALE_AFTER = 65000

// Monitors known to the tab and the requests in flight.
export interface MeridianFlipState {
	// Server process the monitors belong to; absent before the first snapshot or event.
	epoch?: string
	// Latest revision applied from the server.
	revision: number
	// Enabled monitors by monitorKey.
	monitors: Record<string, MeridianFlipMonitor>
	// Recent transitions by monitorKey, oldest first.
	transitions: Record<string, MeridianFlipTransition[]>
	// Request in flight, by monitorKey.
	pending: Record<string, 'enable' | 'disable' | 'settings'>
	// Why the last request of a monitor failed, by monitorKey.
	errors: Record<string, string>
}

// Monitors of the server, shared by every view of the tab.
export const meridianFlipState = proxy<MeridianFlipState>({ revision: 0, monitors: {}, transitions: {}, pending: {}, errors: {} })

// Section of the Meridian Flip tool: the passive monitor or the executor that flips.
export type MeridianFlipSection = 'Monitor' | 'Executor'

// Section of the tool this tab shows, kept across its reloads (meridianFlipViewEntry).
export const meridianFlipView = proxy<{ section: MeridianFlipSection }>({ section: 'Monitor' })

// Keeps the section of the Meridian Flip tool this tab shows.
export function meridianFlipViewEntry(view: { section: MeridianFlipSection }): ViewEntry {
	return {
		name: 'meridianFlipSection',
		store: view,
		restore: (value) => {
			if (value === 'Monitor' || value === 'Executor') view.section = value
		},
		value: () => (view.section === 'Executor' ? view.section : undefined),
	}
}

// Difference of longitude between the site a mount reports and the active observing site beyond which the tool warns,
// in degrees: a quarter of a degree moves every instant of the forecast by one minute of time.
export const MOUNT_SITE_LONGITUDE_TOLERANCE = 0.25

// Generation of the latest snapshot request; an older response is dropped.
let generation = 0

// Key of a monitor: the exact mount of an open connection.
export function monitorKey(connectionId: string, deviceId: string) {
	return JSON.stringify([connectionId, deviceId])
}

// Returns settings within what the server accepts, in seconds: the early warning and the window within 6 sidereal
// hours, the minimum not after the maximum, the deadline warning within the window, and a settle time of at most
// MERIDIAN_FLIP_MAXIMUM_SETTLE_SECONDS. A value that is not finite becomes zero.
export function normalizeMeridianFlipSettings(settings: MeridianFlipSettings): MeridianFlipSettings {
	const clamp = (value: number, max: number) => (Number.isFinite(value) ? Math.min(Math.max(value, 0), max) : 0)
	const maximumSeconds = clamp(settings.maximumSeconds, MERIDIAN_FLIP_MAXIMUM_SECONDS)
	const minimumSeconds = clamp(settings.minimumSeconds, maximumSeconds)

	return {
		earlyWarningSeconds: clamp(settings.earlyWarningSeconds, MERIDIAN_FLIP_MAXIMUM_SECONDS),
		minimumSeconds,
		maximumSeconds,
		deadlineWarningSeconds: clamp(settings.deadlineWarningSeconds, maximumSeconds - minimumSeconds),
		settleSeconds: clamp(settings.settleSeconds, MERIDIAN_FLIP_MAXIMUM_SETTLE_SECONDS),
	}
}

// Returns whether two settings are the same.
export function sameMeridianFlipSettings(a: MeridianFlipSettings, b: MeridianFlipSettings) {
	return a.earlyWarningSeconds === b.earlyWarningSeconds && a.minimumSeconds === b.minimumSeconds && a.maximumSeconds === b.maximumSeconds && a.deadlineWarningSeconds === b.deadlineWarningSeconds && a.settleSeconds === b.settleSeconds
}

// Replaces the monitors with a snapshot of the server, unless it is older than the events already applied; the
// transitions of monitors that are gone or enabled again are forgotten.
export function applyMeridianFlipSnapshot(state: MeridianFlipState, snapshot: MeridianFlipSnapshot) {
	if (snapshot.epoch === state.epoch && snapshot.revision < state.revision) return
	if (snapshot.epoch !== state.epoch) state.transitions = {}
	state.epoch = snapshot.epoch
	state.revision = snapshot.revision
	state.monitors = Object.fromEntries(snapshot.monitors.map((monitor) => [monitorKey(monitor.connectionId, monitor.deviceId), monitor]))
	forgetTransitions(state)
}

// Fetches the monitors again; called on every socket (re)open, since they may have changed while it was closed.
export async function refreshMeridianFlip(state: MeridianFlipState, request: ApiFetch = browserFetch) {
	const current = ++generation

	try {
		const response = await request('/api/meridian-flip')
		if (!response.ok || current !== generation) return
		const snapshot = (await response.json()) as MeridianFlipSnapshot
		if (current === generation) applyMeridianFlipSnapshot(state, snapshot)
	} catch {
		// The server is unreachable; the next socket open refreshes the monitors.
	}
}

// Applies a monitor event; any other event is ignored. An update of another server process starts over from it, an
// update already contained in what the tab knows is dropped, and a transition of another process is ignored.
export function handleMeridianFlipEvent(state: MeridianFlipState, event: ServerEvent) {
	if (event.type === 'meridianFlip:transition') {
		if (event.epoch === state.epoch) addTransitions(state, [event.transition])
		return
	}

	if (event.type !== 'meridianFlip:updated') return

	if (event.epoch !== state.epoch) {
		state.epoch = event.epoch
		state.monitors = {}
		state.transitions = {}
	} else if (event.revision <= state.revision) {
		return
	}

	state.revision = event.revision
	const key = monitorKey(event.key.connectionId, event.key.deviceId)

	if (event.monitor) state.monitors[key] = event.monitor
	else delete state.monitors[key]

	forgetTransitions(state)
}

// Fetches the recent transitions of a monitor and merges them with the ones received meanwhile.
export async function loadMeridianFlipTransitions(state: MeridianFlipState, connectionId: string, deviceId: string, request: ApiFetch = browserFetch) {
	try {
		const response = await request(`${monitorUrl(connectionId, deviceId)}/transitions`)
		if (!response.ok) return
		const { transitions } = (await response.json()) as { readonly transitions: readonly MeridianFlipTransition[] }
		addTransitions(state, transitions)
	} catch {
		// The server is unreachable; the events of the next transitions still arrive.
	}
}

// Enables the monitor of a mount with settings. Returns whether it runs; a failure is kept in errors.
export async function enableMeridianFlip(state: MeridianFlipState, connectionId: string, deviceId: string, settings: MeridianFlipSettings, request: ApiFetch = browserFetch) {
	const key = monitorKey(connectionId, deviceId)
	if (state.pending[key]) return false

	state.pending[key] = 'enable'
	delete state.errors[key]

	try {
		const response = await request(`${monitorUrl(connectionId, deviceId)}/enable`, jsonInit('POST', settings))

		if (!response.ok) {
			state.errors[key] = await responseError(response, 'The monitor could not be enabled.')
			return false
		}

		applyMonitor(state, (await response.json()) as MeridianFlipMonitor)
		return true
	} catch {
		state.errors[key] = 'The server is unreachable.'
		return false
	} finally {
		delete state.pending[key]
	}
}

// Disables the monitor of a mount; it disappears with its event. Returns whether the request succeeded.
export async function disableMeridianFlip(state: MeridianFlipState, connectionId: string, deviceId: string, request: ApiFetch = browserFetch) {
	const key = monitorKey(connectionId, deviceId)
	if (state.pending[key]) return false

	state.pending[key] = 'disable'
	delete state.errors[key]

	try {
		const response = await request(`${monitorUrl(connectionId, deviceId)}/disable`, { method: 'POST' })
		if (response.ok) return true
		state.errors[key] = await responseError(response, 'The monitor could not be disabled.')
		return false
	} catch {
		state.errors[key] = 'The server is unreachable.'
		return false
	} finally {
		delete state.pending[key]
	}
}

// Replaces the settings of a running monitor, made from the settings revision expectedRevision. Returns whether they
// were applied; a conflict keeps the monitor the server answered and its message in errors.
export async function updateMeridianFlipSettings(state: MeridianFlipState, connectionId: string, deviceId: string, settings: MeridianFlipSettings, expectedRevision: number, request: ApiFetch = browserFetch) {
	const key = monitorKey(connectionId, deviceId)
	if (state.pending[key]) return false

	state.pending[key] = 'settings'
	delete state.errors[key]

	try {
		const response = await request(`${monitorUrl(connectionId, deviceId)}/settings`, jsonInit('PATCH', { settings, expectedRevision }))

		if (!response.ok) {
			const body = (await response.clone().json()) as { readonly monitor?: MeridianFlipMonitor }
			if (body.monitor) applyMonitor(state, body.monitor)
			state.errors[key] = await responseError(response, 'The settings could not be applied.')
			return false
		}

		applyMonitor(state, (await response.json()) as MeridianFlipMonitor)
		return true
	} catch {
		state.errors[key] = 'The server is unreachable.'
		return false
	} finally {
		delete state.pending[key]
	}
}

// Text of each availability of a monitor.
export const MERIDIAN_AVAILABILITY_LABELS: Readonly<Record<MeridianAvailability, string>> = {
	waitingForMount: 'Waiting for the mount',
	waitingForCoordinates: 'Waiting for coordinates',
	idle: 'Idle',
	repositioning: 'Repositioning',
	settling: 'Settling',
	monitoring: 'Monitoring',
}

// Text of each pier side.
export const MERIDIAN_PIER_SIDES: Readonly<Record<MeridianMountView['pierSide'], string>> = { EAST: 'East', WEST: 'West', NEITHER: 'Unknown' }

// Text of each mount type.
export const MOUNT_TYPE_LABELS: Readonly<Record<MountType, string>> = { EQ_GEM: 'German equatorial', EQ_FORK: 'Fork', ALTAZ: 'Altazimuth', UNKNOWN: 'Not reported' }

// Headline of a monitor at instant now (Unix milliseconds; the instant of its sample when absent): its state in words
// and the tone it is shown with; Disabled without a monitor. The approach is said apart before and after the transit,
// in a neutral tone, since nothing runs then. Only a flip candidate in or past the window is a warning or a danger,
// never a mount already on the expected side.
export function meridianFlipHeadline(monitor: Pick<MeridianFlipMonitor, 'availability' | 'timing' | 'mechanical' | 'sampledAt'> | undefined, now?: number): readonly [string, StatusTone] {
	if (!monitor) return ['Disabled', 'muted']
	if (monitor.availability !== 'monitoring') return [MERIDIAN_AVAILABILITY_LABELS[monitor.availability], monitor.availability === 'waitingForMount' || monitor.availability === 'waitingForCoordinates' ? 'warning' : 'neutral']
	const candidate = monitor.mechanical === 'flipCandidate'
	if (monitor.timing.phase === 'pastDeadline') return candidate ? ['Deadline passed', 'danger'] : ['Past the window', 'neutral']
	if (monitor.timing.phase === 'windowOpen') return candidate ? ['Flip window open', 'warning'] : ['Window open', 'neutral']
	if (monitor.timing.phase === 'approaching') return [pastTransit(monitor, now) ? 'Past the meridian' : 'Approaching', 'neutral']
	return ['Monitoring', 'success']
}

// Words of each timing phase; the approach reads Past the meridian after the transit (meridianPhaseText).
const MERIDIAN_PHASES: Readonly<Record<MeridianTimingPhase, string>> = {
	unavailable: 'No forecast',
	before: 'Before the early warning',
	approaching: 'Approaching the meridian',
	windowOpen: 'Preferred window open',
	pastDeadline: 'Preferred window closed',
}

// Words of the timing phase of a monitor at instant now (Unix milliseconds; the instant of its sample when absent), the
// approach told apart before and after the transit.
export function meridianPhaseText(monitor: Pick<MeridianFlipMonitor, 'timing' | 'sampledAt'>, now?: number) {
	if (monitor.timing.phase === 'approaching' && pastTransit(monitor, now)) return 'Past the meridian'
	return MERIDIAN_PHASES[monitor.timing.phase]
}

// Whether the transit of a monitor is behind instant now (Unix milliseconds; the instant of its sample when absent).
function pastTransit(monitor: Pick<MeridianFlipMonitor, 'timing' | 'sampledAt'>, now: number = monitor.sampledAt) {
	const seconds = monitor.timing.secondsToTransit
	return seconds !== undefined && seconds - (now - monitor.sampledAt) / 1000 <= 0
}

// Instant of the forecast that comes next after instant now (Unix milliseconds), with its words: the early warning, the
// transit, the opening, the closing warning, or the closing of the window. Undefined without a forecast or once the
// window closed.
export function nextMeridianEvent(timing: MeridianTiming, now: number): { readonly label: string; readonly at: number } | undefined {
	const events = [
		{ label: 'Early warning', at: timing.warningAt },
		{ label: 'Transit', at: timing.transitAt },
		{ label: 'Window opens', at: timing.windowOpensAt },
		{ label: 'Window closing', at: timing.deadlineWarningAt },
		{ label: 'Window closes', at: timing.windowClosesAt },
	]

	let next: { readonly label: string; readonly at: number } | undefined
	for (const { label, at } of events) if (at !== undefined && at > now && (!next || at < next.at)) next = { label, at }
	return next
}

// Wall-clock time to or since the upper transit, from its seconds before it (negative once past): "T−09:25" before,
// "T+06:10" from the transit on, as the tool and the status bar write it.
export function formatTransitOffset(seconds: number) {
	return `T${seconds > 0 ? '−' : '+'}${formatClockDuration(Math.abs(seconds))}`
}

// Wall-clock time from instant now to instant at, or since it, both Unix milliseconds: "in 07:41" for an instant still
// ahead (now included), "03:12 ago" for one past.
export function formatFromNow(at: number, now: number) {
	return at >= now ? `in ${formatClockDuration((at - now) / 1000)}` : `${formatClockDuration((now - at) / 1000)} ago`
}

// Short status of a monitor at instant now (Unix milliseconds), for the status bar: its headline and, while a forecast is
// current, the wall-clock time relative to the transit ("T−09:25", "T+06:10", formatTransitOffset).
export function meridianFlipStatusText(monitor: Pick<MeridianFlipMonitor, 'availability' | 'timing' | 'mechanical' | 'sampledAt'>, now: number) {
	const [label] = meridianFlipHeadline(monitor, now)
	const seconds = monitor.availability === 'monitoring' ? secondsToTransit(monitor, now) : undefined
	return seconds === undefined ? label : `${label} · ${formatTransitOffset(seconds)}`
}

// Hour angle of the position of a monitor at instant now (Unix milliseconds), radians in (−π, π], positive west: moved
// on from its sample at the sidereal rate while the mount tracks a monitored target at that rate, the sample's
// otherwise; undefined without one or when the sample is stale.
export function meridianHourAngle(monitor: Pick<MeridianFlipMonitor, 'availability' | 'timing' | 'mount' | 'sampledAt'>, now: number) {
	const { hourAngle, quality } = monitor.timing
	if (hourAngle === undefined || now - monitor.sampledAt > MERIDIAN_FLIP_STALE_AFTER) return undefined
	if (monitor.availability !== 'monitoring' || !monitor.mount.tracking || quality !== 'valid') return hourAngle
	const angle = hourAngle + (Math.max(now - monitor.sampledAt, 0) / 1000) * SIDEREAL_DRIFT_RATE
	return angle > PI ? angle - TAU : angle
}

// Longitude of the site a mount reports less that of the active observing site, both in degrees east positive, as
// degrees in [−180, 180), east positive: a mount that believes itself east of the site forecasts every instant early.
export function mountSiteLongitudeOffset(mountLongitude: number, siteLongitude: number) {
	return ((((mountLongitude - siteLongitude + 180) % 360) + 360) % 360) - 180
}

// Wall-clock seconds to the upper transit at instant now (Unix milliseconds), interpolated from the sample of a monitor,
// negative once past it; undefined without a forecast or when the sample is stale.
export function secondsToTransit(monitor: Pick<MeridianFlipMonitor, 'sampledAt' | 'timing'>, now: number) {
	const seconds = monitor.timing.secondsToTransit
	if (seconds === undefined || now - monitor.sampledAt > MERIDIAN_FLIP_STALE_AFTER) return undefined
	return seconds - (now - monitor.sampledAt) / 1000
}

// Applies a monitor a response answered, unless an event already brought it or a newer revision; the revision of the
// tab is left to the events, so none published before the response is dropped.
function applyMonitor(state: MeridianFlipState, monitor: MeridianFlipMonitor) {
	if (monitor.revision <= state.revision) return
	state.monitors[monitorKey(monitor.connectionId, monitor.deviceId)] = monitor
	forgetTransitions(state)
}

// Adds transitions to their monitors, without repeating one, oldest first and at most TRANSITION_HISTORY each; a
// transition of a monitor that is not enabled, or of an earlier enablement, is dropped.
function addTransitions(state: MeridianFlipState, transitions: readonly MeridianFlipTransition[]) {
	for (const transition of transitions) {
		const key = monitorKey(transition.connectionId, transition.deviceId)
		if (state.monitors[key]?.monitorId !== transition.monitorId) continue
		const list = (state.transitions[key] ??= [])
		if (list.some((known) => known.transitionId === transition.transitionId)) continue
		list.push(transition)
		list.sort((a, b) => a.at - b.at || a.revision - b.revision)
		if (list.length > TRANSITION_HISTORY) list.splice(0, list.length - TRANSITION_HISTORY)
	}
}

// Forgets the transitions of monitors that are no longer enabled, or that were enabled again.
function forgetTransitions(state: MeridianFlipState) {
	for (const [key, list] of Object.entries(state.transitions)) {
		const monitorId = state.monitors[key]?.monitorId
		if (!monitorId || list.some((transition) => transition.monitorId !== monitorId)) delete state.transitions[key]
	}
}

// Base URL of the routes of the monitor of a mount.
function monitorUrl(connectionId: string, deviceId: string) {
	return `/api/connections/${encodeURIComponent(connectionId)}/mounts/${encodeURIComponent(deviceId)}/meridian-flip`
}
