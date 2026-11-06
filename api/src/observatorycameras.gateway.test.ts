import { describe, expect, test } from 'bun:test'
import { join } from 'path'
import { classifyLine, type GatewayListener, type GatewayState, gatewayEnvironment, isBindFailure, MediaMtxGateway, parseVersion, pathConfiguration, supportedVersion } from './observatorycameras.gateway'

const FAKE = join(import.meta.dir, 'observatorycameras.fake.ts')

describe('configuration', () => {
	test('only the control API and WebRTC listen, on loopback but for the UDP media port', () => {
		const env = gatewayEnvironment(19997, 18889, 18189)
		expect(env).toMatchObject({ MTX_API: 'yes', MTX_APIADDRESS: '127.0.0.1:19997', MTX_WEBRTC: 'yes', MTX_WEBRTCADDRESS: '127.0.0.1:18889', MTX_WEBRTCLOCALUDPADDRESS: ':18189' })
		for (const off of ['MTX_RTSP', 'MTX_RTMP', 'MTX_HLS', 'MTX_SRT', 'MTX_MOQ', 'MTX_PLAYBACK', 'MTX_METRICS', 'MTX_PPROF']) expect(env[off]).toBe('no')
	})

	test('a path reads its source on demand over the chosen transport, never recording', () => {
		expect(pathConfiguration({ source: 'rtsp://u:p@cam/x', rtspTransport: 'tcp' })).toEqual({ source: 'rtsp://u:p@cam/x', sourceOnDemand: true, sourceOnDemandStartTimeout: '15s', sourceOnDemandCloseAfter: '10s', rtspTransport: 'tcp', record: false })
	})

	test('versions', () => {
		expect(parseVersion('v1.21.3\n')).toEqual([1, 21, 3])
		expect(parseVersion('mediamtx')).toBeUndefined()
		expect(supportedVersion([1, 21, 0])).toBeTrue()
		expect(supportedVersion([1, 30, 2])).toBeTrue()
		expect(supportedVersion([1, 20, 9])).toBeFalse()
		expect(supportedVersion([2, 0, 0])).toBeFalse()
	})
})

describe('output', () => {
	test('classifies the failures of the camera sources as MediaMTX prints them', () => {
		expect(classifyLine('2026/11/06 10:58:59 ERR [path obs-c1] [RTSP source] bad status code: 401 (Unauthorized)')).toEqual({ cameraId: 'c1', code: 'sourceAuthFailed' })
		expect(classifyLine('2026/11/06 10:58:59 ERR [path obs-c1] [RTSP source] bad status code: 404 (Not Found)')).toEqual({ cameraId: 'c1', code: 'sourceNotFound' })
		expect(classifyLine('2026/11/06 10:59:09 ERR [path obs-c1] [RTSP source] dial tcp 192.0.2.250:554: i/o timeout')).toEqual({ cameraId: 'c1', code: 'sourceUnreachable' })
		expect(classifyLine('2026/11/06 10:58:59 ERR [path obs-c1] [RTSP source] dial tcp 127.0.0.1:5999: connectex: Nenhuma conexão pôde ser feita')).toEqual({ cameraId: 'c1', code: 'sourceUnreachable' })
		expect(classifyLine('2026/11/06 10:58:59 ERR [path obs-c1] [RTSP source] something else')).toEqual({ cameraId: 'c1', code: 'sourceFailed' })
		expect(classifyLine('2026/11/06 10:58:06 INF [path obs-c1] stream is available and online, 2 tracks (H264, MPEG-4 Audio)')).toEqual({ cameraId: 'c1', code: undefined })
		expect(classifyLine('2026/11/06 10:58:06 INF [path obs-c1] [RTSP source] started on demand')).toBeUndefined()
		expect(classifyLine('2026/11/06 10:58:06 ERR [path other] [RTSP source] bad status code: 401')).toBeUndefined()
		expect(classifyLine('2026/11/06 10:58:01 INF [API] started with listener on 127.0.0.1:19997 (TCP/HTTP)')).toBeUndefined()
	})

	test('tells a listener that could not be opened, in any language', () => {
		expect(isBindFailure('2026/11/06 11:34:32 ERR listen udp :8189: bind: Normalmente é permitida apenas uma utilização de cada endereço de soquete (protocolo/endereço de rede/porta).')).toBeTrue()
		expect(isBindFailure('2026/11/06 11:34:32 ERR listen tcp 127.0.0.1:9997: bind: address already in use')).toBeTrue()
		expect(isBindFailure('2026/11/06 10:59:09 ERR [path obs-c1] [RTSP source] dial tcp 192.0.2.250:554: i/o timeout')).toBeFalse()
	})
})

function gateway(mode: string, timeout = 5000) {
	const states: GatewayState[] = []
	let starts = 0
	let exits = 0
	const listener: GatewayListener = { stateChanged: (state) => states.push(state), started: () => starts++, exited: () => exits++, sourceChanged: () => undefined }
	const instance = new MediaMtxGateway({ program: () => Promise.resolve(mode === 'none' ? undefined : { executable: FAKE, timeout }), listener, command: (_, args) => [process.execPath, FAKE, mode, ...args] })
	return { gateway: instance, states, counts: () => ({ starts, exits }) }
}

describe('supervision', () => {
	test('starts, configures paths through the control API, and stops', async () => {
		const { gateway: g, states, counts } = gateway('ok')
		try {
			expect(await g.ensure(true)).toBeTrue()
			expect(g.state.status).toBe('ready')
			expect(g.epoch).toBeString()
			expect(g.webrtcUrl).toStartWith('http://127.0.0.1:')

			await g.setPath('c1', { source: 'rtsp://cam/1', rtspTransport: 'tcp' }, false)
			await g.setPath('c1', { source: 'rtsp://cam/2', rtspTransport: 'automatic' }, true)
			expect(await g.cameraPaths()).toEqual(['obs-c1'])
			await g.deletePath('obs-c1')
			await g.deletePath('obs-c1')
			expect(await g.cameraPaths()).toEqual([])
			expect(await g.ensure(true)).toBeTrue()
			expect(counts().starts).toBe(1)
		} finally {
			await g.stop()
		}

		expect(g.state.status).toBe('stopped')
		expect(g.webrtcUrl).toBeUndefined()
		expect(counts().exits).toBe(1)
		expect(states.map((state) => state.status)).toEqual(['starting', 'ready', 'stopping', 'stopped'])
	})

	test('without an executable, it is not installed', async () => {
		const { gateway: g } = gateway('none')
		expect(await g.ensure(true)).toBeFalse()
		expect(g.state).toMatchObject({ status: 'notInstalled', code: 'notConfigured' })
		expect(await g.ensure(false)).toBeFalse()
		expect(g.state).toMatchObject({ status: 'notInstalled', code: 'notConfigured' })
	})

	test('an old version is refused', async () => {
		const { gateway: g } = gateway('old')
		expect(await g.ensure(true)).toBeFalse()
		expect(g.state).toMatchObject({ status: 'unavailable', code: 'incompatibleVersion' })
	})

	test('a gateway that never answers times out', async () => {
		const { gateway: g } = gateway('silent', 1000)
		expect(await g.ensure(true)).toBeFalse()
		expect(g.state).toMatchObject({ status: 'unavailable', code: 'readinessTimeout' })
	})

	test('an unexpected exit is followed by a restart', async () => {
		const { gateway: g, states, counts } = gateway('exit')
		try {
			expect(await g.ensure(true)).toBeTrue()
			while (counts().starts < 2) await Bun.sleep(50)
			expect(states.map((state) => state.status)).toContain('restarting')
			expect(states.find((state) => state.status === 'restarting')?.code).toBe('exited')
		} finally {
			await g.stop()
		}
		expect(g.state.status).toBe('stopped')
	})

	test('stop during the start ends the process', async () => {
		const { gateway: g } = gateway('silent', 5000)
		const starting = g.ensure(true)
		await Bun.sleep(300)
		await g.stop()
		expect(await starting).toBeFalse()
		expect(g.state.status).toBe('stopped')
	})
})
