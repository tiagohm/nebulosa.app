import { expect, test } from 'bun:test'
import { resolve } from 'path'
import { homeArgument } from './home'

test('--home names the data directory, resolved against the working directory', () => {
	const cwd = resolve('/srv/nebulosa')
	expect(homeArgument(['--home', '/data/sky'], cwd)).toBe(resolve('/data/sky'))
	expect(homeArgument(['--port', '8080', '--home=observatory'], cwd)).toBe(resolve(cwd, 'observatory'))
})

test('no --home, or an empty one, names nothing', () => {
	const cwd = resolve('/srv/nebulosa')
	expect(homeArgument([], cwd)).toBeUndefined()
	expect(homeArgument(['--home', ' ', '--verbose', 'extra'], cwd)).toBeUndefined()
})
