import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readdir, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join, sep } from 'path'
import { writeImageToFits, writeImageToXisf } from 'nebulosa/src/imaging/model/image'
import type { Image } from 'nebulosa/src/imaging/model/types'
import { bufferSink } from 'nebulosa/src/io/io'
import { classifySequencerFrame, sequencerTemporaryPath, writeSequencerFrame } from 'src/api/sequencer.write'
import type { SequencerWriteEnvironment } from 'src/api/sequencer.write'

let root = ''

const FRAME = Buffer.from('frame')

function syntheticImage(): Image {
	const width = 8
	const height = 8
	const raw = new Float32Array(width * height)
	for (let i = 0; i < raw.length; i++) raw[i] = i / (raw.length - 1)

	return {
		header: { SIMPLE: true, BITPIX: -32, NAXIS: 2, NAXIS1: width, NAXIS2: height },
		raw,
		metadata: { width, height, channels: 1, stride: width, pixelCount: width * height, strideInBytes: width * 4, pixelSizeInBytes: 4, bitpix: -32, bayer: undefined },
	}
}

async function frameOf(format: 'fits' | 'xisf') {
	const buffer = Buffer.alloc(64 * 1024)
	const sink = bufferSink(buffer)
	if (format === 'fits') await writeImageToFits(syntheticImage(), sink)
	else await writeImageToXisf(syntheticImage(), sink)
	return buffer.subarray(0, sink.position)
}

function accepting(valid = true): SequencerWriteEnvironment {
	return { valid: () => Promise.resolve(valid) }
}

beforeEach(async () => {
	root = await mkdtemp(tmpdir() + sep)
})

afterEach(async () => {
	await rm(root, { recursive: true, force: true })
})

describe('write protocol', () => {
	test('renames a validated temporary into the final path', async () => {
		const path = join(root, 'session', 'm42-lum-0.fit')
		const seen: string[] = []
		const result = await writeSequencerFrame(FRAME, path, {
			valid: (candidate) => {
				seen.push(candidate)
				return Promise.resolve(true)
			},
		})

		expect(result).toEqual({ ok: true, path })
		expect(seen).toEqual([sequencerTemporaryPath(path)])
		expect(await Bun.file(path).text()).toBe('frame')
		expect(await readdir(join(root, 'session'))).toEqual(['m42-lum-0.fit'])
	})

	test('leaves nothing behind when the written frame does not parse', async () => {
		const path = join(root, 'm42-lum-0.fit')
		const result = await writeSequencerFrame(FRAME, path, accepting(false))

		expect(result.ok).toBeFalse()
		if (!result.ok) expect(result.reason).toBe('invalidFrame')
		expect(await Bun.file(path).exists()).toBeFalse()
		expect(await readdir(root)).toEqual([])
	})

	test('never observes the final path before the frame is valid', async () => {
		const path = join(root, 'm42-lum-0.fit')
		let observedDuringValidation: boolean | undefined

		await writeSequencerFrame(FRAME, path, {
			async valid() {
				observedDuringValidation = await Bun.file(path).exists()
				return true
			},
		})

		expect(observedDuringValidation).toBeFalse()
		expect(await Bun.file(path).exists()).toBeTrue()
	})

	test('writes the temporary into the directory it was given', async () => {
		const temporaryDirectory = join(root, 'tmp')
		const path = join(root, 'frames', 'm42-lum-0.fit')
		const result = await writeSequencerFrame(FRAME, path, { ...accepting(), temporaryDirectory })

		expect(result).toEqual({ ok: true, path })
		expect(sequencerTemporaryPath(path, { temporaryDirectory })).toBe(join(temporaryDirectory, 'm42-lum-0.fit.partial'))
		expect(await readdir(temporaryDirectory)).toEqual([])
	})

	test('keeps two sessions sharing a temporary directory apart', () => {
		const temporaryDirectory = join(root, 'tmp')
		const path = join(root, 'frames', 'm42-lum-0.fit')
		const a = sequencerTemporaryPath(path, { temporaryDirectory, session: 's1' })
		const b = sequencerTemporaryPath(path, { temporaryDirectory, session: 's2' })

		expect(a).toBe(join(temporaryDirectory, 's1-m42-lum-0.fit.partial'))
		expect(b).toBe(join(temporaryDirectory, 's2-m42-lum-0.fit.partial'))
	})

	test('reports a write that failed without leaving a temporary', async () => {
		const path = join(root, 'm42-lum-0.fit')
		const result = await writeSequencerFrame(FRAME, path, {
			valid: () => Promise.reject(new Error('parser exploded')),
		})

		expect(result).toEqual({ ok: false, reason: 'writeFailed', error: 'parser exploded' })
		expect(await readdir(root)).toEqual([])
	})

	test('gives two slots temporaries of their own', () => {
		expect(sequencerTemporaryPath(join(root, 'a.fit'))).not.toBe(sequencerTemporaryPath(join(root, 'b.fit')))
		expect(sequencerTemporaryPath(join(root, 'a.fit'))).toEndWith('.fit.partial')
	})
})

describe('reconciliation', () => {
	test('classifies a path nothing was written to', async () => {
		expect(await classifySequencerFrame(join(root, 'm42-lum-0.fit'), accepting())).toBe('missing')
	})

	test('classifies a final that parses and keeps it', async () => {
		const path = join(root, 'm42-lum-0.fit')
		await Bun.write(path, FRAME)

		expect(await classifySequencerFrame(path, accepting())).toBe('validFinal')
		expect(await Bun.file(path).exists()).toBeTrue()
	})

	test('removes an invalid final so it does not keep the clean name', async () => {
		const path = join(root, 'm42-lum-0.fit')
		await Bun.write(path, FRAME)

		expect(await classifySequencerFrame(path, accepting(false))).toBe('invalidFinal')
		expect(await Bun.file(path).exists()).toBeFalse()
		expect(await readdir(root)).toEqual([])
	})

	test('quarantines an invalid final outside the namespace of the slots', async () => {
		const path = join(root, 'frames', 'm42-lum-0.fit')
		const quarantineDirectory = join(root, 'auxiliary')
		await Bun.write(path, FRAME)

		expect(await classifySequencerFrame(path, { ...accepting(false), quarantineDirectory })).toBe('invalidFinal')
		expect(await Bun.file(path).exists()).toBeFalse()
		expect(await readdir(quarantineDirectory)).toEqual(['m42-lum-0.fit.invalid'])
	})

	test('discards an orphan temporary instead of promoting it', async () => {
		const path = join(root, 'm42-lum-0.fit')
		await Bun.write(sequencerTemporaryPath(path), FRAME)

		expect(await classifySequencerFrame(path, accepting())).toBe('orphanTemporary')
		expect(await Bun.file(path).exists()).toBeFalse()
		expect(await readdir(root)).toEqual([])
	})

	test('leaves the temporary of another session in the shared directory alone', async () => {
		const temporaryDirectory = join(root, 'tmp')
		const path = join(root, 'frames', 'm42-lum-0.fit')
		const other = sequencerTemporaryPath(path, { temporaryDirectory, session: 's1' })
		await Bun.write(other, FRAME)

		expect(await classifySequencerFrame(path, { ...accepting(), temporaryDirectory, session: 's2' })).toBe('missing')
		expect(await Bun.file(other).exists()).toBeTrue()
	})

	test('prefers the final over a temporary left beside it', async () => {
		const path = join(root, 'm42-lum-0.fit')
		await Bun.write(path, FRAME)
		await Bun.write(sequencerTemporaryPath(path), FRAME)

		expect(await classifySequencerFrame(path, accepting())).toBe('validFinal')
	})

	test('classifies an empty final as invalid', async () => {
		const path = join(root, 'm42-lum-0.fit')
		await Bun.write(path, new Uint8Array())

		expect(await classifySequencerFrame(path)).toBe('invalidFinal')
		expect(await Bun.file(path).exists()).toBeFalse()
	})

	test('accepts a real frame of each format with the default parser', async () => {
		const fits = join(root, 'm42-lum-0.fit')
		const xisf = join(root, 'm42-lum-1.xisf')

		expect(await writeSequencerFrame(await frameOf('fits'), fits)).toEqual({ ok: true, path: fits })
		expect(await writeSequencerFrame(await frameOf('xisf'), xisf)).toEqual({ ok: true, path: xisf })
		expect(await classifySequencerFrame(fits)).toBe('validFinal')
		expect(await classifySequencerFrame(xisf)).toBe('validFinal')
	})

	test('classifies a truncated final as invalid with the real parser', async () => {
		const path = join(root, 'm42-lum-0.fit')
		await Bun.write(path, Buffer.from('SIMPLE  =                    T'))

		expect(await classifySequencerFrame(path)).toBe('invalidFinal')
		expect(await Bun.file(path).exists()).toBeFalse()
	})
})
