// Minimal baseline TIFF reader for the generator's NASA textures: the first image of the file, stored
// in strips with interleaved samples (planar configuration 1), uncompressed or LZW without a predictor,
// 8 or 16 bits per sample, in either byte order. Anything else (tiles, other compressions, predictors,
// separate planes) fails instead of returning a wrong image.

// TIFF tags read by the reader.
const TAG = {
	width: 256,
	height: 257,
	bitsPerSample: 258,
	compression: 259,
	stripOffsets: 273,
	samplesPerPixel: 277,
	rowsPerStrip: 278,
	stripByteCounts: 279,
	planarConfiguration: 284,
	predictor: 317,
	tileWidth: 322,
} as const

// Byte size of each TIFF field type that may hold the tags read: BYTE, ASCII, SHORT, LONG, RATIONAL.
const TYPE_SIZES: Readonly<Record<number, number>> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8 }

// Compression of an uncompressed image.
const NO_COMPRESSION = 1

// Compression of an LZW image.
const LZW_COMPRESSION = 5

// LZW code that resets the dictionary.
const LZW_CLEAR = 256

// LZW code that ends a strip.
const LZW_END = 257

// Size of the LZW dictionary: codes are at most 12 bits.
const LZW_TABLE_SIZE = 4096

// A decoded TIFF image.
export interface TiffImage {
	// Width in pixels.
	readonly width: number
	// Height in pixels.
	readonly height: number
	// Samples per pixel (3 for RGB).
	readonly samplesPerPixel: number
	// Bits per sample: 8 or 16.
	readonly bitsPerSample: 8 | 16
	// Samples row by row from the top-left pixel, interleaved per pixel.
	readonly data: Uint8Array | Uint16Array
}

// Decodes the first image of a TIFF file.
export function readTiff(file: Uint8Array): TiffImage {
	const view = new DataView(file.buffer, file.byteOffset, file.byteLength)
	const order = String.fromCharCode(file[0], file[1])
	if (order !== 'II' && order !== 'MM') throw new Error('not a TIFF file')
	const little = order === 'II'
	if (view.getUint16(2, little) !== 42) throw new Error('not a classic TIFF file')

	const directory = view.getUint32(4, little)
	const tags = new Map<number, number[]>()

	for (let i = 0, count = view.getUint16(directory, little); i < count; i++) {
		const entry = directory + 2 + i * 12
		const tag = view.getUint16(entry, little)
		const type = view.getUint16(entry + 2, little)
		const values = view.getUint32(entry + 4, little)
		const size = TYPE_SIZES[type]
		if (size === undefined || type === 2 || type === 5) continue

		const offset = size * values <= 4 ? entry + 8 : view.getUint32(entry + 8, little)
		const list: number[] = []
		for (let j = 0; j < values; j++) list.push(type === 1 ? file[offset + j] : type === 3 ? view.getUint16(offset + j * 2, little) : view.getUint32(offset + j * 4, little))
		tags.set(tag, list)
	}

	const one = (tag: number, fallback?: number) => {
		const value = tags.get(tag)?.[0] ?? fallback
		if (value === undefined) throw new Error(`TIFF tag ${tag} is missing`)
		return value
	}

	const width = one(TAG.width)
	const height = one(TAG.height)
	const samplesPerPixel = one(TAG.samplesPerPixel, 1)
	const bits = tags.get(TAG.bitsPerSample) ?? [1]
	const compression = one(TAG.compression, NO_COMPRESSION)
	const rowsPerStrip = Math.min(one(TAG.rowsPerStrip, height), height)
	const offsets = tags.get(TAG.stripOffsets)
	const counts = tags.get(TAG.stripByteCounts)

	if (tags.has(TAG.tileWidth)) throw new Error('tiled TIFF images are not supported')
	if (one(TAG.planarConfiguration, 1) !== 1) throw new Error('separate TIFF planes are not supported')
	if (one(TAG.predictor, 1) !== 1) throw new Error('TIFF predictors are not supported')
	if (compression !== NO_COMPRESSION && compression !== LZW_COMPRESSION) throw new Error(`TIFF compression ${compression} is not supported`)
	if ((bits.length !== 1 && bits.length !== samplesPerPixel) || bits.some((e) => e !== bits[0]) || (bits[0] !== 8 && bits[0] !== 16)) throw new Error(`TIFF samples of ${bits.join(', ')} bits are not supported`)
	if (!offsets || !counts || offsets.length !== counts.length || offsets.length !== Math.ceil(height / rowsPerStrip)) throw new Error('corrupt TIFF strips')

	const bitsPerSample = bits[0] === 8 ? 8 : 16
	const bytesPerRow = (width * samplesPerPixel * bitsPerSample) / 8
	const bytes = new Uint8Array(bytesPerRow * height)

	for (let strip = 0; strip < offsets.length; strip++) {
		const expected = Math.min(rowsPerStrip, height - strip * rowsPerStrip) * bytesPerRow
		const input = file.subarray(offsets[strip], offsets[strip] + counts[strip])
		const output = bytes.subarray(strip * rowsPerStrip * bytesPerRow, strip * rowsPerStrip * bytesPerRow + expected)

		if (compression === LZW_COMPRESSION) decodeLzw(input, output)
		else if (input.byteLength < expected) throw new Error('truncated TIFF strip')
		else output.set(input.subarray(0, expected))
	}

	if (bitsPerSample === 8) return { width, height, samplesPerPixel, bitsPerSample, data: bytes }

	const samples = new Uint16Array(bytes.byteLength / 2)
	const words = new DataView(bytes.buffer)
	for (let i = 0; i < samples.length; i++) samples[i] = words.getUint16(i * 2, little)
	return { width, height, samplesPerPixel, bitsPerSample, data: samples }
}

// Decodes a TIFF LZW strip into `output`, which it fills exactly: codes are read most significant bit
// first, from 9 to 12 bits, widening one code early (at 511, 1023, and 2047) as TIFF 6.0 specifies.
// Throws when the strip is corrupt or does not decode to the output's size.
export function decodeLzw(input: Uint8Array, output: Uint8Array) {
	const prefix = new Int16Array(LZW_TABLE_SIZE)
	const suffix = new Uint8Array(LZW_TABLE_SIZE)
	const first = new Uint8Array(LZW_TABLE_SIZE)
	const lengths = new Uint16Array(LZW_TABLE_SIZE)

	for (let i = 0; i < 256; i++) {
		prefix[i] = -1
		suffix[i] = i
		first[i] = i
		lengths[i] = 1
	}

	const totalBits = input.byteLength * 8
	let position = 0
	let width = 9
	let next = 258
	let previous = -1
	let written = 0

	// Writes the string of a code at the end of the output.
	function write(code: number) {
		const length = lengths[code]
		if (written + length > output.byteLength) throw new Error('TIFF LZW strip decodes past its size')
		for (let i = written + length - 1, c = code; i >= written; i--, c = prefix[c]) output[i] = suffix[c]
		written += length
	}

	while (position + width <= totalBits) {
		const byte = position >> 3
		const window = (input[byte] << 16) | ((input[byte + 1] ?? 0) << 8) | (input[byte + 2] ?? 0)
		const code = (window >> (24 - (position & 7) - width)) & ((1 << width) - 1)
		position += width

		if (code === LZW_END) break

		if (code === LZW_CLEAR) {
			width = 9
			next = 258
			previous = -1
			continue
		}

		if (previous < 0) {
			if (code > 255) throw new Error('corrupt TIFF LZW strip')
			write(code)
			previous = code
			continue
		}

		if (code > next || next >= LZW_TABLE_SIZE) throw new Error('corrupt TIFF LZW strip')

		// A code not yet in the table is the previous string followed by its own first byte.
		const added = code === next ? first[previous] : first[code]
		prefix[next] = previous
		suffix[next] = added
		first[next] = first[previous]
		lengths[next] = lengths[previous] + 1
		next++
		write(code)
		previous = code

		if (next === 511) width = 10
		else if (next === 1023) width = 11
		else if (next === 2047) width = 12
	}

	if (written !== output.byteLength) throw new Error('truncated TIFF LZW strip')
}
