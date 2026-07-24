import { Api } from '@shared/api'
import { initProxy } from '@shared/proxy'
import { homeStore } from '@stores/home.store'
import { nanoid } from 'nanoid'
import { unsubscribe } from 'src/shared/util'
import { DEFAULT_FRAMING } from 'src/types/framing'
import type { Framing } from 'src/types/framing'
import { proxy } from 'valtio'

export type FramingStore = typeof framingStore

export interface FramingState {
	readonly request: Framing
	loading: boolean
	openNewImage: boolean
	// images: Image[]
	count: number
}

const state = proxy<FramingState>({
	request: structuredClone(DEFAULT_FRAMING),
	loading: false,
	openNewImage: false,
	// images: [],
	count: 0,
})

const ID = nanoid()

let mounted = false
const u: VoidFunction[] = []

function mount() {
	if (mounted) return unmount

	console.info('framing mounted')

	mounted = true

	u[0] = initProxy(state, 'framing', ['o:request'])

	return unmount
}

function unmount() {
	if (!mounted) return
	console.info('framing unmounted')
	unsubscribe(u)
	mounted = false
}

function setRightAscension(value: string) {
	state.request.rightAscension = value
}

function setDeclination(value: string) {
	state.request.declination = value
}

function setFocalLength(value: number) {
	state.request.focalLength = value
}

function setPixelSize(value: number) {
	state.request.pixelSize = value
}

function setWidth(value: number) {
	state.request.width = value
}

function setHeight(value: number) {
	state.request.height = value
}

function setRotation(value: number) {
	state.request.rotation = value
}

function setHipsSurvey(value: string) {
	state.request.hipsSurvey = value
}

async function load(request: Partial<Framing> = state.request) {
	Object.assign(state.request, request)

	try {
		state.loading = true

		request.id = `${ID}.${state.openNewImage ? state.count++ : DEFAULT_FRAMING.id}`
		const frame = await Api.Framing.frame(state.request)

		if (frame) {
			const image = homeStore.addImage(frame.path, 'framing', request.id)
			// const index = state.images.findIndex((e) => e.id === image.id)
			// index >= 0 ? (state.images[index] = image) : state.images.push(image)
		}
	} finally {
		state.loading = false
	}
}

export const framingStore = {
	state,
	setRightAscension,
	setDeclination,
	setFocalLength,
	setPixelSize,
	setWidth,
	setHeight,
	setRotation,
	setHipsSurvey,
	load,
	mount,
	unmount,
} as const
