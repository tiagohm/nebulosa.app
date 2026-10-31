import { readImageFromFits, readImageFromXisf } from 'nebulosa/src/imaging/model/image'
import { type CfaPattern, type Image, makeImageRawTypedArray, shiftCfaPattern } from 'nebulosa/src/imaging/model/types'
import { clone } from 'nebulosa/src/imaging/processing/arithmetic'
import { debayer } from 'nebulosa/src/imaging/processing/debayer'
import { grayscale } from 'nebulosa/src/imaging/processing/geometry'
import type { fileHandleSource } from 'nebulosa/src/io/file'
import { readFits } from 'nebulosa/src/io/formats/fits/fits'
import { numericKeyword, uncompressedBitpixKeyword } from 'nebulosa/src/io/formats/fits/util'
import { readXisf } from 'nebulosa/src/io/formats/xisf/xisf'
import type { bufferSource } from 'nebulosa/src/io/io'
import { type ImageFormat, type ImageRect, precisionOf, type SampleConversion } from './images'

// Decoding of FITS and XISF images and of the grayscale copies star detection measures, whole or of one small region,
// shared by the worker threads that decode them: the image worker of the image store and the guide frame worker of the
// guiding sessions.

// Seekable source of a FITS or XISF image: an open file or bytes in memory.
export type ImageSource = ReturnType<typeof fileHandleSource> | ReturnType<typeof bufferSource>

// Reads the image of a FITS or XISF source with the precision its BITPIX needs (precisionOf); a FITS image is read with
// 64 bits when any of its HDUs needs them. Resolves to undefined when the source is neither, and throws whatever the
// decoder throws for a malformed one.
export async function readImageFrom(source: ImageSource): Promise<{ readonly format: ImageFormat; readonly image: Image } | undefined> {
	const fits = await readFits(source)
	const fitsPrecision = fits && (fits.hdus.some((hdu) => precisionOf(uncompressedBitpixKeyword(hdu.header, 0)) === 64) ? 64 : 32)
	const fitsImage = fits && (await readImageFromFits(fits, source, fitsPrecision))
	if (fitsImage) return { format: 'fits', image: fitsImage }

	source.seek(0)
	const xisf = await readXisf(source)
	const xisfImage = xisf?.images[0] && (await readImageFromXisf(xisf, source, precisionOf(xisf.images[0].bitpix)))
	if (xisfImage) return { format: 'xisf', image: xisfImage }

	return undefined
}

// Returns the grayscale copy of an image a star detection measures: a clone of a mono image, the luminance of an RGB
// image, or the luminance of a mono CFA mosaic debayered with `cfa`, its trusted pattern (`debayered`, when given, is
// that debayered image, reused instead of debayering again). The result owns a buffer of its own that can be
// transferred, and names no Bayer pattern.
export function luminanceImage(image: Image, cfa?: CfaPattern, debayered?: Image): Image {
	const source = image.metadata.channels === 1 && cfa ? (debayered ?? debayer(image, cfa) ?? image) : image
	// grayscale returns a mono image itself, which must not be handed over.
	const mono = source.metadata.channels === 1 ? clone(source) : grayscale(source)
	const raw = mono.raw.byteOffset === 0 && mono.raw.byteLength === mono.raw.buffer.byteLength ? mono.raw : mono.raw.slice()
	return { ...mono, raw, metadata: { ...mono.metadata, bayer: undefined } }
}

// Returns a copy of a rectangle of an image, which must lie inside it, in a buffer of its own that can be transferred.
// It keeps the channels, precision, Bayer pattern name, and min-max rescale of the image, and drops its header, which
// describes the whole image.
export function cropImage({ metadata, raw }: Image, { left, top, width, height }: ImageRect): Image {
	const { channels, stride, pixelSizeInBytes } = metadata
	const rowLength = width * channels
	const output = makeImageRawTypedArray(raw, rowLength * height)

	for (let y = 0; y < height; y++) {
		const start = (top + y) * stride + left * channels
		output.set(raw.subarray(start, start + rowLength), y * rowLength)
	}

	return { header: {}, raw: output, metadata: { ...metadata, width, height, stride: rowLength, strideInBytes: rowLength * pixelSizeInBytes, pixelCount: width * height } }
}

// Returns the grayscale copy of a rectangle of an image, sample for sample the same as that rectangle of luminanceImage
// without touching the rest of the image, and with a buffer of its own that can be transferred. A mosaic with a trusted
// pattern `cfa` is debayered on the rectangle plus one pixel on each side inside the image, the neighbors the debayering
// of a pixel reads, with the pattern at the origin of that crop. The rectangle must lie inside the image.
export function luminanceRegion(image: Image, cfa: CfaPattern | undefined, rect: ImageRect): Image {
	const { width, height, channels } = image.metadata
	const halo = channels === 1 && cfa ? 1 : 0
	const left = Math.max(0, rect.left - halo)
	const top = Math.max(0, rect.top - halo)
	const right = Math.min(width, rect.left + rect.width + halo)
	const bottom = Math.min(height, rect.top + rect.height + halo)
	const crop = cropImage(image, { left, top, width: right - left, height: bottom - top })
	const mono = luminanceImage(crop, cfa && shiftCfaPattern(cfa, left, top))
	return halo ? cropImage(mono, { left: rect.left - left, top: rect.top - top, width: rect.width, height: rect.height }) : mono
}

// Returns how the samples of an image convert to the scale of its source. Undoes the min-max rescale of the read, then
// the division by the full scale of integer data, which is ADU unless BSCALE made it another unit; floating-point data
// is kept as stored.
export function sampleConversion({ header, metadata }: Image): SampleConversion {
	const { bitpix, normalization } = metadata
	const fullScale = bitpix > 0 ? 2 ** bitpix - 1 : 1
	const unit = bitpix > 0 && numericKeyword(header, 'BSCALE', 1) === 1 ? 'adu' : 'source'
	return { unit, scale: (normalization?.range ?? 1) * fullScale, offset: (normalization?.minimum ?? 0) * fullScale, rescaled: normalization !== undefined }
}
