import type { PlateSolution } from 'nebulosa/src/platesolver'
import type { DetectedStar } from 'nebulosa/src/stardetector'
import type { Connect, ConnectionStatus, CreateDirectory, FileSystem, ImageInfo, ListDirectory, OpenImage, PlateSolveStart, PlateSolveStop, StarDetection } from 'src/api/types'
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

	export namespace Connection {
		export function list() {
			return w.url('/connections').get().json<ConnectionStatus[]>()
		}

		export function connect(req: Connect) {
			return w.url('/connections').post(req).json<ConnectionStatus>()
		}

		export function get(id: string) {
			return w.url(`/connections/${id}`).get().json<ConnectionStatus>()
		}

		export function disconnect(id: string) {
			return w.url(`/connections/${id}`).delete().json<void>()
		}
	}

	export namespace Image {
		export async function open(req: OpenImage) {
			const response = await w.url('/image/open').post(req).res()
			if (response.status < 200 || response.status >= 300) throw new Error(await response.text())
			const blob = await response.blob()
			const info = JSON.parse(decodeURIComponent(response.headers.get(X_IMAGE_INFO_HEADER)!)) as ImageInfo
			return { blob, info }
		}
	}

	export namespace PlateSolver {
		export function start(req: PlateSolveStart) {
			return w.url('/plateSolver/start').post(req).json<PlateSolution | { failed: true }>()
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
