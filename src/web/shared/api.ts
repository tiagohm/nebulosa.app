import type { CreateDirectory, FileSystem, ImageInfo, ListDirectory, OpenImage } from 'src/api/types'
import { X_IMAGE_INFO_HEADER } from 'src/api/types'
import wretch from 'wretch'
import { abortAddon } from 'wretch/addons'

const uri = localStorage.getItem('api.uri') || `${location.protocol}//${location.host}`
const w = wretch(uri, { cache: 'no-cache' })
const aw = w.addon(abortAddon())

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
		export async function open(req: OpenImage, controller: AbortController) {
			const response = await aw.signal(controller).url('/image/open').post(req).res()
			const blob = await response.blob()
			const info = JSON.parse(response.headers.get(X_IMAGE_INFO_HEADER)!) as ImageInfo
			return { blob, info }
		}
	}
}
