import { describe, expect, test } from 'bun:test'
import { resolve, sep } from 'path'
import { isSequencerPathSegment, sequencerArtifactPath, sequencerPathSegments, sequencerSessionDirectory } from 'src/api/sequencer.path'

const ROOT = resolve('/data/nebulosa')

describe('path segments', () => {
	test('a plain name is a segment', () => {
		expect(isSequencerPathSegment('m42')).toBe(true)
		expect(isSequencerPathSegment('LIGHT-60s')).toBe(true)
		expect(isSequencerPathSegment('...')).toBe(true)
	})

	test('the empty name and the relative names are not segments', () => {
		expect(isSequencerPathSegment('')).toBe(false)
		expect(isSequencerPathSegment('.')).toBe(false)
		expect(isSequencerPathSegment('..')).toBe(false)
	})

	test('a separator or a NUL is not a segment', () => {
		expect(isSequencerPathSegment('a/b')).toBe(false)
		expect(isSequencerPathSegment('a\\b')).toBe(false)
		expect(isSequencerPathSegment('a\0b')).toBe(false)
	})

	test('a template splits on either host separator and drops the empty parts', () => {
		expect(sequencerPathSegments('{target}/{frameType}')).toEqual(['{target}', '{frameType}'])
		expect(sequencerPathSegments('\\{target}\\\\{filter}\\')).toEqual(['{target}', '{filter}'])
		expect(sequencerPathSegments('')).toEqual([])
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
})
