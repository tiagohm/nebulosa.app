import { expect, test } from 'bun:test'
import { serverAddress } from './address'

test('the command line wins over the environment, which wins over the defaults', () => {
	expect(serverAddress([], {})).toEqual({ host: 'localhost', port: 7000 })
	expect(serverAddress([], { APP_HOST: '0.0.0.0', APP_PORT: '7100' })).toEqual({ host: '0.0.0.0', port: 7100 })
	expect(serverAddress(['--host', '192.168.0.10', '--port', '8080'], { APP_HOST: '0.0.0.0', APP_PORT: '7100' })).toEqual({ host: '192.168.0.10', port: 8080 })
	expect(serverAddress(['--port=8081'], { APP_HOST: '0.0.0.0' })).toEqual({ host: '0.0.0.0', port: 8081 })
})

test('an unusable port falls back, and other arguments are ignored', () => {
	expect(serverAddress(['--port', 'abc', '--verbose', 'extra'], { APP_PORT: '7100' })).toEqual({ host: 'localhost', port: 7100 })
	expect(serverAddress(['--port', '0', '--host', ' '], {})).toEqual({ host: 'localhost', port: 7000 })
})
