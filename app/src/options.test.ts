import { expect, test } from 'bun:test'
import { resolve } from 'path'
import { appOptions } from './options'

const CWD = resolve('/srv/nebulosa')

test('the command line wins over the environment, which wins over the defaults', () => {
	expect(appOptions([], {}, CWD)).toEqual({ host: 'localhost', port: 7000, home: undefined })
	expect(appOptions([], { APP_HOST: '0.0.0.0', APP_PORT: '7100' }, CWD)).toMatchObject({ host: '0.0.0.0', port: 7100 })
	expect(appOptions([], { HOST: '192.168.0.10', APP_HOST: '0.0.0.0', PORT: '7200', APP_PORT: '7100' }, CWD)).toMatchObject({ host: '0.0.0.0', port: 7100 })
	expect(appOptions([], { HOST: '192.168.0.10', PORT: '7200' }, CWD)).toMatchObject({ host: '192.168.0.10', port: 7200 })
	expect(appOptions(['--host', '192.168.0.10', '--port', '8080'], { APP_HOST: '0.0.0.0', APP_PORT: '7100' }, CWD)).toMatchObject({ host: '192.168.0.10', port: 8080 })
	expect(appOptions(['--port=8081'], { APP_HOST: '0.0.0.0' }, CWD)).toMatchObject({ host: '0.0.0.0', port: 8081 })
})

test('an unusable port falls back, and other arguments are ignored', () => {
	expect(appOptions(['--port', 'abc', '--verbose', 'extra'], { APP_PORT: '7100' }, CWD)).toEqual({ host: 'localhost', port: 7100, home: undefined })
	expect(appOptions(['--port', '0', '--host', ' '], {}, CWD)).toMatchObject({ host: 'localhost', port: 7000 })
})

test('--home names the data directory, resolved against the working directory', () => {
	expect(appOptions(['--home', '/data/sky'], {}, CWD).home).toBe(resolve('/data/sky'))
	expect(appOptions(['--port', '8080', '--home=observatory'], {}, CWD)).toEqual({ host: 'localhost', port: 8080, home: resolve(CWD, 'observatory') })
	expect(appOptions(['--home', ' '], {}, CWD).home).toBeUndefined()
})
