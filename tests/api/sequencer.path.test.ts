import { afterAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve, sep } from 'path'
import { SEQUENCER_AUXILIARY_SEGMENT, sequencerArtifactPath, sequencerAuxiliaryDirectory, sequencerAuxiliaryPath, sequencerNightSegment, sequencerPathSegments, sequencerSessionDirectory, sequencerVerifiedArtifactPath, sequencerVerifiedAuxiliaryPath } from 'src/api/sequencer.path'
import { isPathSegment } from 'src/api/util'

const ROOT = resolve('/data/nebulosa')

describe('path segments', () => {
	test('a plain name is a segment', () => {
		expect(isPathSegment('m42')).toBe(true)
		expect(isPathSegment('LIGHT-60s')).toBe(true)
		expect(isPathSegment('...')).toBe(true)
	})

	test('the empty name and the relative names are not segments', () => {
		expect(isPathSegment('')).toBe(false)
		expect(isPathSegment('.')).toBe(false)
		expect(isPathSegment('..')).toBe(false)
	})

	test('a separator or a NUL is not a segment', () => {
		expect(isPathSegment('a/b')).toBe(false)
		expect(isPathSegment('a\\b')).toBe(false)
		expect(isPathSegment('a\0b')).toBe(false)
	})

	test('a template splits on either host separator and drops the empty parts', () => {
		expect(sequencerPathSegments('{target}/{frameType}')).toEqual(['{target}', '{frameType}'])
		expect(sequencerPathSegments('\\{target}\\\\{filter}\\')).toEqual(['{target}', '{filter}'])
		expect(sequencerPathSegments('')).toEqual([])
	})
})

describe('night segments', () => {
	test('the noon mode keeps a night that crosses midnight in one directory', () => {
		expect(sequencerNightSegment('noon', Date.parse('2026-08-10T22:30:00'))).toBe('2026-08-10')
		expect(sequencerNightSegment('noon', Date.parse('2026-08-11T03:15:00'))).toBe('2026-08-10')
		expect(sequencerNightSegment('noon', Date.parse('2026-08-11T12:00:00'))).toBe('2026-08-11')
	})

	test('the midnight mode names the calendar date', () => {
		expect(sequencerNightSegment('midnight', Date.parse('2026-08-10T22:30:00'))).toBe('2026-08-10')
		expect(sequencerNightSegment('midnight', Date.parse('2026-08-11T03:15:00'))).toBe('2026-08-11')
	})

	test('no segment is named when the mode is off', () => {
		expect(sequencerNightSegment('off', Date.parse('2026-08-11T03:15:00'))).toBeUndefined()
	})
})

describe('artifact paths', () => {
	test('the session segment sits directly below the root', () => {
		expect(sequencerSessionDirectory({ root: ROOT, session: 'session-1' })).toBe(resolve(ROOT, 'session-1'))
	})

	test('the night segment sits between the root and the session', () => {
		expect(sequencerSessionDirectory({ root: ROOT, session: 'session-1', night: '2026-08-10' })).toBe(resolve(ROOT, '2026-08-10', 'session-1'))
	})

	test('the rendered directories are created below the session segment', () => {
		const resolution = sequencerArtifactPath({ root: ROOT, session: 'session-1', night: '2026-08-10' }, ['m42', 'LIGHT'], 'm42-lum-60.fits')

		expect(resolution.ok).toBe(true)
		if (resolution.ok) expect(resolution.path).toBe(resolve(ROOT, '2026-08-10', 'session-1', 'm42', 'LIGHT', 'm42-lum-60.fits'))
	})

	test('a directory climbing out of the session directory is refused', () => {
		const resolution = sequencerArtifactPath({ root: ROOT, session: 'session-1' }, ['..', '..'], 'frame.fits')

		expect(resolution.ok).toBe(false)
		if (!resolution.ok) expect(resolution.reason).toBe('the directory segment ".." is not a valid path segment')
	})

	test('a file name with a separator is refused', () => {
		const resolution = sequencerArtifactPath({ root: ROOT, session: 'session-1' }, [], `..${sep}frame.fits`)

		expect(resolution.ok).toBe(false)
		if (!resolution.ok) expect(resolution.reason).toBe(`the file name "..${sep}frame.fits" is not a valid path segment`)
	})

	test('a relative root is refused before anything is composed', () => {
		const resolution = sequencerArtifactPath({ root: 'data/nebulosa', session: 'session-1' }, [], 'frame.fits')

		expect(resolution.ok).toBe(false)
		if (!resolution.ok) expect(resolution.reason).toBe('the storage root "data/nebulosa" is not an absolute path')
	})

	test('two sessions of the same definition never share a directory', () => {
		const first = sequencerArtifactPath({ root: ROOT, session: 'session-1' }, ['m42'], 'frame.fits')
		const second = sequencerArtifactPath({ root: ROOT, session: 'session-2' }, ['m42'], 'frame.fits')

		expect(first.ok && second.ok && first.path === second.path).toBe(false)
	})

	test('a template rendering the reserved segment is refused at any depth', () => {
		for (const directories of [[SEQUENCER_AUXILIARY_SEGMENT], ['m42', SEQUENCER_AUXILIARY_SEGMENT]]) {
			const resolution = sequencerArtifactPath({ root: ROOT, session: 'session-1' }, directories, 'frame.fits')

			expect(resolution.ok).toBe(false)
			if (!resolution.ok) expect(resolution.reason).toBe(`the directory segment "${SEQUENCER_AUXILIARY_SEGMENT}" is reserved for the images that are not frames of the plan`)
		}
	})
})

describe('auxiliary paths', () => {
	test('an auxiliary image lands in the reserved directory of its kind', () => {
		expect(sequencerAuxiliaryDirectory({ root: ROOT, session: 'session-1' }, 'autofocus')).toBe(resolve(ROOT, 'session-1', SEQUENCER_AUXILIARY_SEGMENT, 'autofocus'))
		expect(sequencerAuxiliaryDirectory({ root: ROOT, session: 'session-1', night: '2026-08-10' }, 'guider')).toBe(resolve(ROOT, '2026-08-10', 'session-1', SEQUENCER_AUXILIARY_SEGMENT, 'guider'))

		const resolution = sequencerAuxiliaryPath({ root: ROOT, session: 'session-1' }, 'centering', 'centering-00003.fits')

		expect(resolution.ok).toBe(true)
		if (resolution.ok) expect(resolution.path).toBe(resolve(ROOT, 'session-1', SEQUENCER_AUXILIARY_SEGMENT, 'centering', 'centering-00003.fits'))
	})

	test('an auxiliary image never shares a directory with the frames of the plan', () => {
		const auxiliary = sequencerAuxiliaryPath({ root: ROOT, session: 'session-1' }, 'driftCheck', 'driftCheck-00000.fits')
		const frame = sequencerArtifactPath({ root: ROOT, session: 'session-1' }, [], 'driftCheck-00000.fits')

		expect(auxiliary.ok && frame.ok && auxiliary.path === frame.path).toBe(false)
		expect(auxiliary.ok && auxiliary.path.startsWith(sequencerSessionDirectory({ root: ROOT, session: 'session-1' }) + sep)).toBe(true)
	})

	test('an auxiliary name climbing out of its directory is refused', () => {
		const resolution = sequencerAuxiliaryPath({ root: ROOT, session: 'session-1' }, 'quarantine', `..${sep}..${sep}frame.fits`)

		expect(resolution.ok).toBe(false)
		if (!resolution.ok) expect(resolution.reason).toBe(`the file name "..${sep}..${sep}frame.fits" is not a valid path segment`)
	})

	test('a relative root is refused before anything is composed', () => {
		const resolution = sequencerAuxiliaryPath({ root: 'data/nebulosa', session: 'session-1' }, 'autofocus', 'autofocus-00000.fits')

		expect(resolution.ok).toBe(false)
		if (!resolution.ok) expect(resolution.reason).toBe('the storage root "data/nebulosa" is not an absolute path')
	})
})

describe('verified artifact paths', () => {
	const temporary = mkdtempSync(join(tmpdir(), 'nebulosa-path-'))
	const root = join(temporary, 'storage')
	const outside = join(temporary, 'outside')

	afterAll(() => rmSync(temporary, { recursive: true, force: true }))

	test('a directory tree that does not exist yet is contained', () => {
		const resolution = sequencerVerifiedArtifactPath({ root, session: 'session-1' }, ['m42', 'LIGHT'], 'frame.fits')

		expect(resolution.ok).toBe(true)
		if (resolution.ok) expect(resolution.path).toBe(resolve(root, 'session-1', 'm42', 'LIGHT', 'frame.fits'))
	})

	test('real directories below the session directory are contained', () => {
		mkdirSync(join(root, 'session-2', 'm42'), { recursive: true })

		expect(sequencerVerifiedArtifactPath({ root, session: 'session-2' }, ['m42'], 'frame.fits').ok).toBe(true)
	})

	test('a linked directory below the session directory is refused', () => {
		mkdirSync(outside, { recursive: true })
		mkdirSync(join(root, 'session-3'), { recursive: true })
		symlinkSync(outside, join(root, 'session-3', 'link'), 'junction')

		const resolution = sequencerVerifiedArtifactPath({ root, session: 'session-3' }, ['link'], 'frame.fits')

		expect(resolution.ok).toBe(false)
		if (!resolution.ok) expect(resolution.reason).toBe(`the path component "${join(root, 'session-3', 'link')}" is a symbolic link, and the write would follow it out of the session directory`)
	})

	test('a linked session directory is refused', () => {
		mkdirSync(outside, { recursive: true })
		mkdirSync(root, { recursive: true })
		symlinkSync(outside, join(root, 'session-4'), 'junction')

		const resolution = sequencerVerifiedArtifactPath({ root, session: 'session-4' }, ['m42'], 'frame.fits')

		expect(resolution.ok).toBe(false)
		if (!resolution.ok) expect(resolution.reason).toBe(`the path component "${join(root, 'session-4')}" is a symbolic link, and the write would follow it out of the session directory`)
	})

	test('a lexically escaping path is refused before the filesystem is read', () => {
		const resolution = sequencerVerifiedArtifactPath({ root, session: 'session-1' }, ['..'], 'frame.fits')

		expect(resolution.ok).toBe(false)
		if (!resolution.ok) expect(resolution.reason).toBe('the directory segment ".." is not a valid path segment')
	})
})

describe('verified auxiliary paths', () => {
	const temporary = mkdtempSync(join(tmpdir(), 'nebulosa-auxiliary-'))
	const root = join(temporary, 'storage')
	const outside = join(temporary, 'outside')

	afterAll(() => rmSync(temporary, { recursive: true, force: true }))

	test('a reserved directory that does not exist yet is contained', () => {
		const resolution = sequencerVerifiedAuxiliaryPath({ root, session: 'session-1' }, 'autofocus', 'autofocus-00000.fits')

		expect(resolution.ok).toBe(true)
		if (resolution.ok) expect(resolution.path).toBe(resolve(root, 'session-1', SEQUENCER_AUXILIARY_SEGMENT, 'autofocus', 'autofocus-00000.fits'))
	})

	test('a linked auxiliary segment is refused', () => {
		mkdirSync(outside, { recursive: true })
		mkdirSync(join(root, 'session-2'), { recursive: true })
		symlinkSync(outside, join(root, 'session-2', SEQUENCER_AUXILIARY_SEGMENT), 'junction')

		const resolution = sequencerVerifiedAuxiliaryPath({ root, session: 'session-2' }, 'guider', 'guider-00000.fits')

		expect(resolution.ok).toBe(false)
		if (!resolution.ok) expect(resolution.reason).toBe(`the path component "${join(root, 'session-2', SEQUENCER_AUXILIARY_SEGMENT)}" is a symbolic link, and the write would follow it out of the session directory`)
	})

	test('a linked kind directory is refused', () => {
		mkdirSync(outside, { recursive: true })
		mkdirSync(join(root, '2026-08-10', 'session-3', SEQUENCER_AUXILIARY_SEGMENT), { recursive: true })
		symlinkSync(outside, join(root, '2026-08-10', 'session-3', SEQUENCER_AUXILIARY_SEGMENT, 'quarantine'), 'junction')

		const resolution = sequencerVerifiedAuxiliaryPath({ root, session: 'session-3', night: '2026-08-10' }, 'quarantine', 'frame.fits.invalid')

		expect(resolution.ok).toBe(false)
		if (!resolution.ok) expect(resolution.reason).toBe(`the path component "${join(root, '2026-08-10', 'session-3', SEQUENCER_AUXILIARY_SEGMENT, 'quarantine')}" is a symbolic link, and the write would follow it out of the session directory`)
	})

	test('a real reserved directory below the session directory is contained', () => {
		mkdirSync(join(root, 'session-4', SEQUENCER_AUXILIARY_SEGMENT, 'centering'), { recursive: true })

		expect(sequencerVerifiedAuxiliaryPath({ root, session: 'session-4' }, 'centering', 'centering-00001.fits').ok).toBe(true)
	})

	test('an invalid file name is refused before the filesystem is read', () => {
		const resolution = sequencerVerifiedAuxiliaryPath({ root, session: 'session-1' }, 'driftCheck', '..')

		expect(resolution.ok).toBe(false)
		if (!resolution.ok) expect(resolution.reason).toBe('the file name ".." is not a valid path segment')
	})
})
