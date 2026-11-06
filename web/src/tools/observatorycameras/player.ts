import type { ServerEvent } from 'api'
import { proxy, ref } from 'valtio'
import { cameraUrl, isCameraEvent } from './observatorycameras'
import { type WhepFailure, WhepReader, type WhepReaderOptions } from './whep'

// Players of the observatory cameras in this tab: at most one WHEP session per camera, whose stream every view of the
// camera (its tile, its enlarged view, the mini-player) shows, so a camera is never decoded twice. A player starts only
// when the operator asks; it pauses while its tile is off screen (unless docked in the mini-player) and while the page is
// hidden (unless in picture-in-picture), and resumes when shown again. A lost connection is retried a few times with a
// growing pause; a camera that refuses the stream, or a video that never arrives, fails until Retry. Playing is the
// state of this tab only: the server knows nothing of it but the session.

// State of a player: connecting, playing (a frame was shown), reconnecting after a loss, paused while not shown, or
// failed until Retry.
export type PlayerStatus = 'connecting' | 'playing' | 'reconnecting' | 'paused' | 'failed'

// Player of a camera.
export interface PlayerEntry {
	// State of the player.
	status: PlayerStatus
	// Why it failed or is reconnecting.
	error?: string
	// When the current video started to play, in milliseconds since the Unix epoch.
	startedAt?: number
	// Whether it is shown in the mini-player of the shell, so it plays whatever the workspace.
	docked: boolean
	// Stream of the video, while connected.
	stream?: MediaStream
	// Reconnections tried since the video last played.
	attempt: number
}

// Players of the tab.
export interface PlayerState {
	// Players by camera id; a camera without one is stopped.
	players: Record<string, PlayerEntry>
}

// Time the first frame may take to arrive after a start, in milliseconds; longer than the 15 s the gateway gives a source.
const FIRST_FRAME_TIMEOUT = 25000

// Reconnections tried after a loss before the player fails.
const MAX_RECONNECTIONS = 3

// Pause before the first reconnection, in milliseconds; doubled at each next one.
const RECONNECT_DELAY = 2000

// Codes of the server after which a new request may succeed by itself.
const TRANSIENT_CODES = new Set(['gatewayUnavailable', 'upstreamFailure'])

// Players of the tab, shared by every view.
export const playerState = proxy<PlayerState>({ players: {} })

// Running reader of each camera.
const readers = new Map<string, WhepReader>()

// Pending reconnection or first-frame deadline of each camera.
const timers = new Map<string, Timer>()

// Cameras whose tile is on screen.
const onscreen = new Set<string>()

// Camera shown in picture-in-picture, if any.
let pictureInPicture: string | undefined

// Whether the page is hidden.
let pageHidden = false

// Creates the reader of a camera; replaced by tests.
let createReader = (options: WhepReaderOptions) => new WhepReader(options)

// Replaces the factory of the readers, for tests.
export function setReaderFactory(factory: (options: WhepReaderOptions) => WhepReader) {
	createReader = factory
}

// Whether the player of a camera should run now.
function shouldRun(id: string) {
	if (pictureInPicture === id) return true
	if (pageHidden) return false
	return playerState.players[id]?.docked === true || onscreen.has(id)
}

// Ends the reader and the timer of a camera.
function release(id: string) {
	readers.get(id)?.close()
	readers.delete(id)
	clearTimeout(timers.get(id))
	timers.delete(id)
}

// Starts the player of a camera, or restarts a failed one. A running player is left alone.
export function startPlayer(id: string) {
	const entry = playerState.players[id]
	if (entry && entry.status !== 'failed') return
	playerState.players[id] = { status: 'connecting', docked: entry?.docked ?? false, attempt: 0 }
	connect(id)
}

// Stops the player of a camera, ending its session.
export function stopPlayer(id: string) {
	release(id)
	delete playerState.players[id]
	if (pictureInPicture === id) pictureInPicture = undefined
}

// Stops every player.
export function stopAllPlayers() {
	for (const id of Object.keys(playerState.players)) stopPlayer(id)
}

// Opens a session for a camera, unless it should not run now.
function connect(id: string) {
	release(id)
	const entry = playerState.players[id]
	if (!entry) return

	if (!shouldRun(id)) {
		pause(id)
		return
	}

	if (entry.status !== 'reconnecting') entry.status = 'connecting'
	entry.stream = undefined
	entry.startedAt = undefined

	const reader = createReader({
		url: `${cameraUrl(id)}/whep`,
		onTrack: (stream) => {
			if (readers.get(id) === reader && playerState.players[id]) playerState.players[id].stream = ref(stream)
		},
		onError: (failure) => failed(id, reader, failure),
	})

	readers.set(id, reader)
	timers.set(
		id,
		setTimeout(() => {
			if (readers.get(id) !== reader) return
			release(id)
			const current = playerState.players[id]
			if (!current) return
			current.status = 'failed'
			current.stream = undefined
			current.error = 'No video arrived: the browser may not reach the UDP port of the server, or may not decode what the camera sends.'
		}, FIRST_FRAME_TIMEOUT),
	)
	void reader.start()
}

// Marks the player of a camera as playing once its video shows a frame.
export function markPlaying(id: string) {
	const entry = playerState.players[id]
	if (!entry || entry.status === 'playing' || !readers.has(id)) return
	clearTimeout(timers.get(id))
	timers.delete(id)
	entry.status = 'playing'
	entry.attempt = 0
	entry.error = undefined
	entry.startedAt = Date.now()
}

// Handles the failure of the reader of a camera: a lost connection or a transient refusal is retried, anything else fails.
function failed(id: string, reader: WhepReader, failure: WhepFailure) {
	if (readers.get(id) !== reader) return
	release(id)
	const entry = playerState.players[id]
	if (!entry) return

	entry.stream = undefined
	entry.startedAt = undefined
	entry.error = failure.message
	const transient = (failure.stage === 'media' && failure.connected) || (failure.code !== undefined && TRANSIENT_CODES.has(failure.code))

	if (!transient || entry.attempt >= MAX_RECONNECTIONS) {
		entry.status = 'failed'
		return
	}

	entry.status = 'reconnecting'
	const delay = RECONNECT_DELAY * 2 ** entry.attempt++
	timers.set(
		id,
		setTimeout(() => {
			timers.delete(id)
			if (playerState.players[id]?.status === 'reconnecting') connect(id)
		}, delay),
	)
}

// Pauses the player of a camera: its session ends until it should run again.
function pause(id: string) {
	release(id)
	const entry = playerState.players[id]
	if (!entry) return
	entry.status = 'paused'
	entry.stream = undefined
	entry.startedAt = undefined
}

// Pauses or resumes the player of a camera after something that decides whether it runs changed.
function update(id: string) {
	const entry = playerState.players[id]
	if (!entry || entry.status === 'failed') return
	const run = shouldRun(id)
	if (run && entry.status === 'paused') connect(id)
	else if (!run && entry.status !== 'paused') pause(id)
}

// Shows the player of a camera in the mini-player of the shell, or back in its tile only.
export function dockPlayer(id: string, docked: boolean) {
	const entry = playerState.players[id]
	if (!entry) return
	entry.docked = docked
	update(id)
}

// Tells whether the tile of a camera is on screen.
export function setTileOnscreen(id: string, visible: boolean) {
	if (visible) onscreen.add(id)
	else onscreen.delete(id)
	update(id)
}

// Whether the tile of a camera is on screen.
export function isTileOnscreen(id: string) {
	return onscreen.has(id)
}

// Tells which camera is in picture-in-picture, if any.
export function setPictureInPicture(id: string | undefined) {
	const previous = pictureInPicture
	pictureInPicture = id
	if (previous) update(previous)
	if (id) update(id)
}

// Tells whether the page is hidden.
export function setPageHidden(hidden: boolean) {
	pageHidden = hidden
	for (const id of Object.keys(playerState.players)) update(id)
}

// Stops the players of cameras that were removed or disabled.
export function handlePlayerEvent(event: ServerEvent) {
	if (!isCameraEvent(event)) return
	if (event.type === 'observatoryCamera:removed') stopPlayer(event.cameraId)
	else if (event.type === 'observatoryCamera:updated' && !event.camera.enabled) stopPlayer(event.camera.id)
}

// Follows the visibility of the page, and ends every session when the page goes away. Returns the function that stops
// following it.
export function watchPlayers() {
	const visibility = () => setPageHidden(document.visibilityState === 'hidden')
	document.addEventListener('visibilitychange', visibility)
	window.addEventListener('pagehide', stopAllPlayers)
	visibility()

	return () => {
		document.removeEventListener('visibilitychange', visibility)
		window.removeEventListener('pagehide', stopAllPlayers)
	}
}
