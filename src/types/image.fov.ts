import type { Size } from 'nebulosa/src/math/numerical/geometry'

export interface ImageFovItem {
	id: string
	visible: boolean
	focalLength: number // mm
	aperture: number // mm
	readonly cameraWidth: number // px
	readonly cameraHeight: number // px
	readonly pixelWidth: number // μm
	readonly pixelHeight: number // μm
	barlowReducer: number
	bin: number
	rotation: number // deg
	color: string
}

export interface ComputedImageFov {
	focalRatio: number
	readonly resolution: Size // Camera resolution in arcsec/pixel
	readonly field: Size // FOV in arcmin
	readonly svg: Size // SVG dimensions in % of the image
}

export const DEFAULT_IMAGE_FOV_ITEM: ImageFovItem = {
	id: '',
	visible: true,
	// William Optics RedCat 51
	focalLength: 250,
	aperture: 51,
	// ZWO ASI2600MM
	cameraWidth: 6248,
	cameraHeight: 4176,
	pixelWidth: 3.76,
	pixelHeight: 3.76,
	barlowReducer: 1,
	bin: 1,
	rotation: 0,
	color: '#fff',
}

export const DEFAULT_COMPUTED_FOV: ComputedImageFov = {
	focalRatio: 0,
	resolution: { width: 0, height: 0 },
	field: { width: 0, height: 0 },
	svg: { width: 0, height: 0 },
}
