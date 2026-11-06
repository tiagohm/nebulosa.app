import { afterEach, beforeEach, expect, test } from 'bun:test'
import { dockPlayer, handlePlayerEvent, markPlaying, playerState, setPageHidden, setPictureInPicture, setReaderFactory, setTileOnscreen, startPlayer, stopAllPlayers, stopPlayer } from './player'
import type { WhepFailure, WhepReader, WhepReaderOptions } from './whep'

interface FakeReader {
	readonly options: WhepReaderOptions
	started: boolean
	closed: boolean
}

let readers: FakeReader[] = []

beforeEach(() => {
	readers = []
	setPageHidden(false)
	setReaderFactory((options) => {
		const reader: FakeReader = { options, started: false, closed: false }
		readers.push(reader)
		return {
			start: () => {
				reader.started = true
				return Promise.resolve()
			},
			close: () => {
				reader.closed = true
			},
		} as unknown as WhepReader
	})
})

afterEach(() => {
	stopAllPlayers()
	setTileOnscreen('c1', false)
	setPictureInPicture(undefined)
})

function fail(reader: FakeReader, failure: Partial<WhepFailure> = {}) {
	reader.options.onError({ stage: 'media', message: 'lost', connected: true, ...failure })
}

test('starts on request, plays on the first frame, and stops', () => {
	setTileOnscreen('c1', true)
	startPlayer('c1')
	expect(readers).toHaveLength(1)
	expect(readers[0].options.url).toBe('/api/observatory-cameras/c1/whep')
	expect(playerState.players.c1.status).toBe('connecting')

	markPlaying('c1')
	expect(playerState.players.c1.status).toBe('playing')
	expect(playerState.players.c1.startedAt).toBeNumber()

	startPlayer('c1')
	expect(readers).toHaveLength(1)

	stopPlayer('c1')
	expect(readers[0].closed).toBeTrue()
	expect(playerState.players.c1).toBeUndefined()
})

test('a refused stream fails until Retry, a lost one reconnects', () => {
	setTileOnscreen('c1', true)
	startPlayer('c1')
	fail(readers[0], { stage: 'signaling', code: 'sourceAuthFailed', connected: false, message: 'refused' })
	expect(playerState.players.c1).toMatchObject({ status: 'failed', error: 'refused' })

	startPlayer('c1')
	expect(readers).toHaveLength(2)
	markPlaying('c1')
	fail(readers[1])
	expect(playerState.players.c1.status).toBe('reconnecting')
})

test('an off-screen tile pauses unless docked, and resumes when shown', () => {
	setTileOnscreen('c1', true)
	startPlayer('c1')
	setTileOnscreen('c1', false)
	expect(playerState.players.c1.status).toBe('paused')
	expect(readers[0].closed).toBeTrue()

	setTileOnscreen('c1', true)
	expect(playerState.players.c1.status).toBe('connecting')
	expect(readers).toHaveLength(2)

	dockPlayer('c1', true)
	setTileOnscreen('c1', false)
	expect(playerState.players.c1.status).toBe('connecting')
	expect(readers[1].closed).toBeFalse()
})

test('a hidden page pauses every player but the one in picture-in-picture', () => {
	setTileOnscreen('c1', true)
	setTileOnscreen('c2', true)
	startPlayer('c1')
	startPlayer('c2')
	setPictureInPicture('c2')
	setPageHidden(true)
	expect(playerState.players.c1.status).toBe('paused')
	expect(playerState.players.c2.status).toBe('connecting')
	setPageHidden(false)
	expect(playerState.players.c1.status).toBe('connecting')
	setTileOnscreen('c2', false)
})

test('a removed or disabled camera stops its player', () => {
	setTileOnscreen('c1', true)
	startPlayer('c1')
	handlePlayerEvent({ type: 'observatoryCamera:removed', epoch: 'e', revision: 1, cameraId: 'c1' })
	expect(playerState.players.c1).toBeUndefined()
})
