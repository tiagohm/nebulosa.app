import { addToast } from '@heroui/react'
import type { HipsSurvey } from 'nebulosa/src/hips2fits'
import type { PlateSolution } from 'nebulosa/src/platesolver'
import type { DetectedStar } from 'nebulosa/src/stardetector'
// biome-ignore format: too long
import type { Camera, CameraCaptureStart, Confirm, Connect, ConnectionStatus, CreateDirectory, Device, FileSystem, Framing, ImageInfo, ListDirectory, OpenImage, PlateSolveStart, PlateSolveStop, StarDetection } from 'src/shared/types'
import { X_IMAGE_INFO_HEADER } from 'src/shared/types'
import wretch, { type WretchError } from 'wretch'

const uri = localStorage.getItem('api.uri') || `${location.protocol}//${location.host}`
const w = wretch(uri, { cache: 'no-cache' })

export namespace Api {
	export namespace FileSystem {
		export function list(req: ListDirectory) {
			return json<FileSystem>('/fileSystem/list', 'post', req)
		}

		export function create(req: CreateDirectory) {
			return json<{ path: string }>('/fileSystem/create', 'post', req)
		}
	}

	export namespace Connection {
		export function list() {
			return json<ConnectionStatus[]>('/connections', 'get')
		}

		export function connect(req: Connect) {
			return json<ConnectionStatus>('/connections', 'post', req)
		}

		export function get(id: string) {
			return json<ConnectionStatus>(`/connections/${id}`, 'get')
		}

		export function disconnect(id: string) {
			return res(`/connections/${id}`, 'delete')
		}
	}

	export namespace Confirmation {
		export function confirm(req: Confirm) {
			return res('/confirmation', 'post', req)
		}
	}

	export namespace Image {
		export async function open(req: OpenImage) {
			const response = await res('/image/open', 'post', req)
			if (!response || response.status < 200 || response.status >= 300) return undefined
			const blob = await response.blob()
			const info = JSON.parse(decodeURIComponent(response.headers.get(X_IMAGE_INFO_HEADER)!)) as ImageInfo
			return { blob, info }
		}
	}

	export namespace Indi {
		export function connect(device: Device) {
			return res(`/indi/${device.name}/connect`, 'post')
		}

		export function disconnect(device: Device) {
			return res(`/indi/${device.name}/disconnect`, 'post')
		}
	}

	export namespace Cameras {
		export function list() {
			return json<Camera[]>('/cameras', 'get')
		}

		export function get(name: string) {
			return json<Camera>(`/cameras/${name}`, 'get')
		}

		export function cooler(camera: Camera, enabled: boolean) {
			return res(`/cameras/${camera.name}/cooler`, 'post', enabled)
		}

		export function temperature(camera: Camera, value: number) {
			return res(`/cameras/${camera.name}/temperature`, 'post', value)
		}

		export function start(camera: Camera, req: CameraCaptureStart) {
			return res(`/cameras/${camera.name}/start`, 'post', req)
		}

		export function stop(camera: Camera) {
			return res(`/cameras/${camera.name}/stop`, 'post')
		}
	}

	export namespace PlateSolver {
		export function start(req: PlateSolveStart) {
			return json<PlateSolution>('/plateSolver/start', 'post', req)
		}

		export function stop(req: PlateSolveStop) {
			return res('/plateSolver/stop', 'post', req)
		}
	}

	export namespace StarDetection {
		export function detect(req: StarDetection) {
			return json<DetectedStar[]>('/starDetection', 'post', req)
		}
	}

	export namespace Framing {
		export function hipsSurveys() {
			return json<HipsSurvey[]>('/framing/hipsSurveys', 'get')
		}

		export function frame(req: Framing) {
			return json<{ path: string }>('/framing', 'post', req)
		}
	}
}

function req(path: string, method: 'get' | 'post' | 'put' | 'delete', body?: unknown) {
	return w.url(path)[method](method === 'get' || method === 'delete' ? undefined : (body as never))
}

function json<T>(path: string, method: 'get' | 'post' | 'put', body?: unknown) {
	return req(path, method, body).json<T>().catch(handleErrorAndShowToast)
}

function res(path: string, method: 'get' | 'post' | 'put' | 'delete', body?: unknown) {
	return req(path, method, body).res().catch(handleErrorAndShowToast)
}

function handleErrorAndShowToast(e: WretchError) {
	const description = e.json || e.message || 'Unknown error'
	addToast({ title: 'ERROR', description, color: 'danger' })
	return undefined
}
