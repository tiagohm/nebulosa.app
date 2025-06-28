import { addToast } from '@heroui/react'
import type { HipsSurvey } from 'nebulosa/src/hips2fits'
import type { PlateSolution } from 'nebulosa/src/platesolver'
import type { DetectedStar } from 'nebulosa/src/stardetector'
// biome-ignore format: too long
import type { Camera, Confirm, Connect, ConnectionStatus, CreateDirectory, FileSystem, Framing, ImageInfo, ListDirectory, OpenImage, PlateSolveStart, PlateSolveStop, StarDetection } from 'src/api/types'
import { X_IMAGE_INFO_HEADER } from 'src/api/types'
import wretch, { type WretchError } from 'wretch'

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
			return w.url('/connections').post(req).error(500, handleErrorAndShowToast).json<ConnectionStatus | undefined>()
		}

		export function get(id: string) {
			return w.url(`/connections/${id}`).get().json<ConnectionStatus>()
		}

		export function disconnect(id: string) {
			return w.url(`/connections/${id}`).delete().res()
		}
	}

	export namespace Confirmation {
		export function confirm(req: Confirm) {
			return w.url('/confirmation').post(req).res()
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

	export namespace Cameras {
		export function list() {
			return w.url('/cameras').get().json<Camera[]>()
		}

		export function get(name: string) {
			return w.url(`/cameras/${name}`).get().json<Camera>()
		}
	}

	export namespace PlateSolver {
		export function start(req: PlateSolveStart) {
			return w.url('/plateSolver/start').post(req).json<PlateSolution>()
		}

		export function stop(req: PlateSolveStop) {
			return w.url('/plateSolver/stop').post(req).res()
		}
	}

	export namespace StarDetection {
		export function detect(req: StarDetection) {
			return w.url('/starDetection').post(req).json<DetectedStar[]>()
		}
	}

	export namespace Framing {
		export function hipsSurveys() {
			return w.url('/framing/hipsSurveys').get().json<HipsSurvey[]>()
		}

		export function frame(req: Framing) {
			return w.url('/framing').post(req).json<{ path: string }>()
		}
	}
}

function handleErrorAndShowToast(e: WretchError) {
	const description = e.json || e.message || 'Unknown error'
	addToast({ title: 'ERROR', description, color: 'danger' })
	return undefined
}
