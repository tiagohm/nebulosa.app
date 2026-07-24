import type { OpenImage } from 'src/types/image'

export interface SaveImage extends OpenImage {
	readonly saveAt: string
}
