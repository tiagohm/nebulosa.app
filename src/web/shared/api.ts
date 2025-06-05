import type { CreateDirectory, FileSystem, ImageInfo, ListDirectory, OpenImage } from 'src/api/types'
import wretch from 'wretch'

const uri = localStorage.getItem('api.uri') || `${location.protocol}//${location.host}`
const w = wretch(uri, { cache: 'no-cache' })

export namespace Api {
	export namespace FileSystem {
		export function list(req: ListDirectory) {
			return w.url('/fileSystem/list').post(req).json<FileSystem>()
		}

		export function create(req: CreateDirectory) {
			return w.url('/fileSystem/create').post(req).json<{ path: string }>()
		}
	}

	export namespace Image {
		export async function open(req: OpenImage) {
			const response = await w.url('/image/open').post(req).res()
			const blob = await response.blob()
			const info = JSON.parse(response.headers.get('X-Image-Info')!) as ImageInfo
			return { blob, info }
		}
	}
}
