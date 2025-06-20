import type { PlateSolution } from 'nebulosa/src/platesolver'
import type { DetectedStar } from 'nebulosa/src/stardetector'
import type { CreateDirectory, FileSystem, ImageInfo, ListDirectory, OpenImage, PlateSolveStart, PlateSolveStop, StarDetection } from 'src/api/types'
import { X_IMAGE_INFO_HEADER } from 'src/api/types'
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
			const info = JSON.parse(decodeURIComponent(response.headers.get(X_IMAGE_INFO_HEADER)!)) as ImageInfo
			return { blob, info }
		}
	}

	export namespace PlateSolver {
		export function start(req: PlateSolveStart) {
			return w.url('/plateSolver/start').post(req).json<PlateSolution | { solved: false }>()
		}

		export function stop(req: PlateSolveStop) {
			return w.url('/plateSolver/stop').post(req).json<void>()
		}
	}

	export namespace StarDetection {
		export function detect(req: StarDetection) {
			return w.url('/starDetection').post(req).json<DetectedStar[]>()
		}
	}
}
