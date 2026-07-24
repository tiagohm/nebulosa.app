import type { OpenImage } from '#/image'

export interface SaveImage extends OpenImage {
	readonly saveAt: string
}
