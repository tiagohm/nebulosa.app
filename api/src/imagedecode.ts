import { readImageFromFits, readImageFromXisf } from 'nebulosa/src/imaging/model/image'
import type { CfaPattern, Image } from 'nebulosa/src/imaging/model/types'
import { clone } from 'nebulosa/src/imaging/processing/arithmetic'
import { debayer } from 'nebulosa/src/imaging/processing/debayer'
import { grayscale } from 'nebulosa/src/imaging/processing/geometry'
import type { fileHandleSource } from 'nebulosa/src/io/file'
import { readFits } from 'nebulosa/src/io/formats/fits/fits'
import { uncompressedBitpixKeyword } from 'nebulosa/src/io/formats/fits/util'
import { readXisf } from 'nebulosa/src/io/formats/xisf/xisf'
import type { bufferSource } from 'nebulosa/src/io/io'
import { type ImageFormat, precisionOf } from './images'

// Decoding of FITS and XISF images and of the grayscale copies star detection measures, shared by the worker threads
// that decode them: the image worker of the image store and the guide frame worker of the guiding sessions.

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
