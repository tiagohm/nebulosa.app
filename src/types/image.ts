import type { PlateSolution } from 'nebulosa/src/astrometry/solvers/platesolver'
import type { EquatorialCoordinate } from 'nebulosa/src/astronomy/coordinates/coordinate'
import type { DeepRequired } from 'nebulosa/src/core/types'
import type { Camera } from 'nebulosa/src/devices/indi/device'
import type { CfaPattern, ImageFormat, ImageMetadata, WriteImageToFormatOptions } from 'nebulosa/src/imaging/model/types'
import type { FitsHeader } from 'nebulosa/src/io/formats/fits/fits'
import type { Point, Size } from 'nebulosa/src/math/numerical/geometry'
import { DEFAULT_IMAGE_ADJUSTMENT } from '#/image.adjustment'
import type { ImageAdjustment } from '#/image.adjustment'
import { DEFAULT_IMAGE_CALIBRATION } from '#/image.calibration'
import type { ImageCalibration } from '#/image.calibration'
import { DEFAULT_IMAGE_FFT } from '#/image.fft'
import type { ImageFFT } from '#/image.fft'
import { DEFAULT_IMAGE_FILTER } from '#/image.filter'
import type { ImageFilter } from '#/image.filter'
import { DEFAULT_IMAGE_SCNR } from '#/image.scnr'
import type { ImageScnr } from '#/image.scnr'
import { DEFAULT_IMAGE_STRETCH } from '#/image.stretch'
import type { ImageStretch } from '#/image.stretch'
import { finiteNumber } from '#/util'

export type ImageSource = 'file' | 'framing' | 'camera'

export interface OpenImage {
	readonly path: string
	readonly camera?: string
	readonly transformation: ImageTransformation
}

export interface CloseImage {
	readonly path: string
	readonly hash?: string
	readonly camera?: string
}

export interface ImageTransformation {
	enabled: boolean
	debayer: boolean
	cfaPattern: CfaPattern | 'AUTO'
	stretch: ImageStretch
	horizontalMirror: boolean
	verticalMirror: boolean
	invert: boolean
	scnr: ImageScnr
	format: {
		type: ImageFormat
	} & DeepRequired<WriteImageToFormatOptions>
	adjustment: ImageAdjustment
	filter: ImageFilter
	calibration: ImageCalibration
	fft: ImageFFT
}

export interface ImageInfo extends Partial<EquatorialCoordinate>, Size {
	readonly path: string
	readonly mono: boolean
	readonly metadata: ImageMetadata
	readonly transformation: ImageTransformation
	readonly headers: FitsHeader
	readonly solution?: PlateSolution
	readonly hash: string
}

export interface Image {
	readonly id: string
	readonly path: string
	readonly source: ImageSource
	readonly camera?: Camera
}

export interface ImageLoaded {
	readonly image: Image
	readonly info: ImageInfo
	readonly first: boolean
	readonly refreshed: boolean
}

export const X_IMAGE_INFO_HEADER = 'X-Image-Info'

export const DEFAULT_IMAGE_TRANSFORMATION: ImageTransformation = {
	enabled: true,
	debayer: true,
	cfaPattern: 'AUTO',
	stretch: DEFAULT_IMAGE_STRETCH,
	horizontalMirror: false,
	verticalMirror: false,
	invert: false,
	scnr: DEFAULT_IMAGE_SCNR,
	format: {
		type: 'jpeg',
		jpeg: {
			quality: 90,
			chrominanceSubsampling: '4:2:0',
		},
	},
	adjustment: DEFAULT_IMAGE_ADJUSTMENT,
	filter: DEFAULT_IMAGE_FILTER,
	calibration: DEFAULT_IMAGE_CALIBRATION,
	fft: DEFAULT_IMAGE_FFT,
}

export function screenDeltaInImage(screenX: number, screenY: number, scale: number, angle: number): Point {
	const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1
	const radians = finiteNumber(angle, 0) * (-Math.PI / 180)
	const x = finiteNumber(screenX, 0) / safeScale
	const y = finiteNumber(screenY, 0) / safeScale
	const cos = Math.cos(radians)
	const sin = Math.sin(radians)

	return { x: x * cos - y * sin, y: x * sin + y * cos }
}
