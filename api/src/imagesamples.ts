import type { CfaPattern } from 'nebulosa/src/imaging/model/types'
import type { ImageRect, SampleConversion } from './images'

// Binary envelope of a sample tile: the native decoded samples of a small rectangle of an image document, which the
// pixel readout of the Images viewer decodes without ever reading the rendered JPEG. Version 1 is, in order:
// - the length of the header in bytes, an unsigned 32-bit little-endian integer;
// - the header, UTF-8 JSON (SampleTileHeader);
// - zero padding up to a multiple of 8 bytes from the start;
// - the samples, IEEE 754 little-endian floats of the header's precision, interleaved by channel in row-major order
//   (sample c of pixel (x, y) of the tile at ((y × width) + x) × channels + c), in the normalized scale of the document,
//   NaN and infinities kept.
// The header carries the conversion to the scale of the source and the trusted CFA pattern at the image origin, so a
// client can label a photosite by its absolute coordinates.

// Version of the envelope written by encodeSampleTile.
export const SAMPLE_TILE_VERSION = 1

// Largest side of a tile the pixel readout asks for, in pixels.
export const SAMPLE_TILE_SIZE = 64

// Header of a sample tile envelope.
export interface SampleTileHeader extends ImageRect {
	// Envelope version, SAMPLE_TILE_VERSION.
	readonly version: number
	// Channels per pixel: 1 for mono or a mosaic, 3 for RGB.
	readonly channels: number
	// Bits of each little-endian float sample: 32 or 64.
	readonly precision: 32 | 64
	// Conversion of the samples to the scale of the source.
	readonly conversion: SampleConversion
	// Trusted CFA pattern at the image origin of a mono mosaic; absent otherwise.
	readonly cfa?: CfaPattern
}

// Returns the envelope of the samples of a tile, which must hold width × height × channels values.
export function encodeSampleTile(header: Omit<SampleTileHeader, 'version' | 'precision'>, samples: Float32Array | Float64Array): Uint8Array<ArrayBuffer> {
	const precision = samples instanceof Float64Array ? 64 : 32
	const json = new TextEncoder().encode(JSON.stringify({ ...header, version: SAMPLE_TILE_VERSION, precision } satisfies SampleTileHeader))
	const offset = Math.ceil((4 + json.length) / 8) * 8
	const bytes = new Uint8Array(offset + samples.length * (precision / 8))
	const view = new DataView(bytes.buffer)
	view.setUint32(0, json.length, true)
	bytes.set(json, 4)

	if (precision === 64) for (let i = 0; i < samples.length; i++) view.setFloat64(offset + i * 8, samples[i], true)
	else for (let i = 0; i < samples.length; i++) view.setFloat32(offset + i * 4, samples[i], true)

	return bytes
}
