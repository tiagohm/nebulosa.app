import { expect, test } from 'bun:test'
import { decodeLzw, readTiff } from './tiff'

// Encodes bytes as a TIFF LZW strip the way libtiff does: a clear code first, codes most significant bit
// first, the width growing when the next free code passes the largest one of the current width, a clear
// code when the table is full, and the end code written after the last code's table entry.
function encodeLzw(data: Uint8Array) {
	const bits: number[] = []
	const table = new Map<string, number>()
	let width = 9
	let next = 258

	const emit = (code: number) => {
		for (let i = width - 1; i >= 0; i--) bits.push((code >> i) & 1)
	}

	const grow = () => {
		next++

		if (next === 4094) {
			emit(256)
			table.clear()
			next = 258
			width = 9
		} else if (next > (1 << width) - 1) {
			width++
		}
	}

	emit(256)
	let current = ''

	for (const byte of data) {
		const extended = current + String.fromCharCode(byte)

		if (extended.length === 1 || table.has(extended)) {
			current = extended
			continue
		}

		emit(current.length === 1 ? current.charCodeAt(0) : table.get(current)!)
		table.set(extended, next)
		grow()
		current = String.fromCharCode(byte)
	}

	emit(current.length === 1 ? current.charCodeAt(0) : table.get(current)!)
	grow()
	emit(257)

	const output = new Uint8Array(Math.ceil(bits.length / 8))
	for (const [i, bit] of bits.entries()) output[i >> 3] |= bit << (7 - (i & 7))
	return output
}

// Builds a one-strip RGB TIFF of 16-bit samples, uncompressed or LZW.
function tiff(width: number, height: number, samples: Uint16Array, little: boolean, lzw: boolean) {
	const raw = new Uint8Array(samples.length * 2)
	const view = new DataView(raw.buffer)
	for (const [i, sample] of samples.entries()) view.setUint16(i * 2, sample, little)
	const strip = lzw ? encodeLzw(raw) : raw

	const tags: [number, number, number, number][] = [
		[256, 3, 1, width],
		[257, 3, 1, height],
		[258, 3, 1, 16],
		[259, 3, 1, lzw ? 5 : 1],
		[262, 3, 1, 2],
		[273, 4, 1, 0],
		[277, 3, 1, 3],
		[278, 3, 1, height],
		[279, 4, 1, strip.length],
	]
	const ifdSize = 2 + tags.length * 12 + 4
	const file = new Uint8Array(8 + ifdSize + strip.length)
	const header = new DataView(file.buffer)
	file[0] = file[1] = little ? 0x49 : 0x4d
	header.setUint16(2, 42, little)
	header.setUint32(4, 8, little)
	header.setUint16(8, tags.length, little)

	for (const [i, [tag, type, count, value]] of tags.entries()) {
		const entry = 10 + i * 12
		header.setUint16(entry, tag, little)
		header.setUint16(entry + 2, type, little)
		header.setUint32(entry + 4, count, little)
		if (type === 3) header.setUint16(entry + 8, value, little)
		else header.setUint32(entry + 8, tag === 273 ? 8 + ifdSize : value, little)
	}

	file.set(strip, 8 + ifdSize)
	return file
}

// Samples of a test image whose strip is long and varied enough to grow the LZW codes past 9 and 10 bits.
function samples(width: number, height: number) {
	const result = new Uint16Array(width * height * 3)
	for (let i = 0; i < result.length; i++) result[i] = (i * 2654435761) % 65536
	return result
}

test('decodes LZW strips past the 9- and 10-bit code widths', () => {
	const data = new Uint8Array(4000)
	for (let i = 0; i < data.length; i++) data[i] = (i * 7 + (i >> 5)) % 251
	const output = new Uint8Array(data.length)
	decodeLzw(encodeLzw(data), output)
	expect(output).toEqual(data)
})

test('reads 16-bit RGB images, uncompressed or LZW, in either byte order', () => {
	const expected = samples(40, 20)

	for (const little of [true, false]) {
		for (const lzw of [false, true]) {
			const image = readTiff(tiff(40, 20, expected, little, lzw))
			expect(image).toMatchObject({ width: 40, height: 20, samplesPerPixel: 3, bitsPerSample: 16 })
			expect(image.data).toEqual(expected)
		}
	}
})

test('rejects a strip that decodes to the wrong size', () => {
	expect(() => decodeLzw(encodeLzw(new Uint8Array(10)), new Uint8Array(11))).toThrow('truncated')
	expect(() => decodeLzw(encodeLzw(new Uint8Array(10)), new Uint8Array(9))).toThrow('past its size')
})
