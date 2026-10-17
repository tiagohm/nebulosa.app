import type { ImageInfo, RenderRequest, RenderResult } from 'api'
import { nanoid } from 'nanoid'
import { proxy, ref } from 'valtio'
import { responseError } from '../http'

// Image documents open in the tab's Images workspace. Each document is a server-side image (opened from
// a file the server reads) plus the tab's current rendering of it: a JPEG held as an object URL. Only
// the latest rendering request of a document counts; starting a new one aborts the previous, and an
// object URL is revoked as soon as a newer rendering replaces it or the document closes. Documents live
// in memory only and are not restored after a reload.

// Where a document's image comes from. Captured frames will add their own kind.
export type ImageSource = { readonly kind: 'file'; readonly path: string }

// Current rendering of a document.
export interface ImageRendering {
	// Object URL of the rendered JPEG, owned by the store.
	readonly url: string
	// Parameters the server applied.
	readonly result: RenderResult
}

// Image document of the tab.
export interface ImageDocument {
	// Id of the document in the tab, assigned before the server opens the image.
	readonly key: string
	// Display name: the file name.
	readonly name: string
	// Origin of the image.
	readonly source: ImageSource
	// Whether the server is opening the image, has opened it, or failed to.
	status: 'loading' | 'ready' | 'error'
	// Server description of the opened image, including its id.
	info?: ImageInfo
	// Current rendering, kept while a newer one is prepared.
	rendering?: ImageRendering
	// Whether a rendering is in progress.
	renderPending: boolean
	// Why opening or rendering failed.
	error?: string
}

// Image documents of the tab.
export interface ImagesState {
	// Open documents in tab order.
	documents: ImageDocument[]
	// Key of the document shown; absent when none is open.
	activeKey?: string
}

// Browser services the store uses, replaced in tests.
export interface ImagesIo {
	// Performs HTTP requests to the API.
	readonly fetch: (input: string, init?: RequestInit) => Promise<Response>
	// Creates an object URL for a rendered JPEG.
	readonly createObjectURL: (blob: Blob) => string
	// Releases an object URL.
	readonly revokeObjectURL: (url: string) => void
}

// Response header with the RenderResult of a rendering (RENDER_HEADER of the API).
const RENDER_HEADER = 'X-Image-Render'

// Image documents of the tab.
export const imagesState = proxy<ImagesState>({ documents: [] })

// Browser implementation of ImagesIo.
export const browserIo: ImagesIo = {
	fetch: (input, init) => fetch(input, init),
	createObjectURL: (blob) => URL.createObjectURL(blob),
	revokeObjectURL: (url) => URL.revokeObjectURL(url),
}

// Pending rendering request of each document, by document key.
const renders = new Map<string, AbortController>()

// Returns the document with key, if still open.
function documentOf(state: ImagesState, key: string): ImageDocument | undefined {
	return state.documents.find((d) => d.key === key)
}

// Returns the document shown, if any.
export function activeDocument(state: { readonly documents: readonly ImageDocument[]; readonly activeKey?: string }): ImageDocument | undefined {
	return state.documents.find((d) => d.key === state.activeKey)
}

// Returns the message of an unknown failure.
function message(error: unknown): string {
	return error instanceof Error ? error.message : 'Unable to reach the server'
}

// Asks the server to release an image, ignoring failures: the document is already gone from the tab.
function release(id: string, io: ImagesIo) {
	void io.fetch(`/api/images/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => undefined)
}

// Opens a server file as a new active document and renders it with an automatic stretch. A document
// closed before the server answers is released on the server.
export async function openImage(state: ImagesState, path: string, io: ImagesIo = browserIo) {
	const key = nanoid()
	const name = path.split(/[\\/]/).at(-1) || path
	state.documents.push({ key, name, source: { kind: 'file', path }, status: 'loading', renderPending: false })
	state.activeKey = key

	try {
		const response = await io.fetch('/api/images', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path }) })
		const document = documentOf(state, key)

		if (!response.ok) {
			if (document) Object.assign(document, { status: 'error', error: await responseError(response) })
			return
		}

		const info = (await response.json()) as ImageInfo

		if (!document) {
			release(info.id, io)
			return
		}

		document.info = ref(info)
		document.status = 'ready'
	} catch (error) {
		const document = documentOf(state, key)
		if (document) Object.assign(document, { status: 'error', error: message(error) })
		return
	}

	await renderImage(state, key, { stretch: 'auto' }, io)
}

// Renders an opened document. Aborts the document's previous rendering request; the current rendering
// stays shown until the new one arrives and is then revoked.
export async function renderImage(state: ImagesState, key: string, request: RenderRequest, io: ImagesIo = browserIo) {
	const document = documentOf(state, key)
	const id = document?.info?.id
	if (!document || !id) return

	renders.get(key)?.abort()
	const controller = new AbortController()
	renders.set(key, controller)
	document.renderPending = true
	document.error = undefined

	try {
		const response = await io.fetch(`/api/images/${encodeURIComponent(id)}/render`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal: controller.signal })
		if (!response.ok) throw new Error(await responseError(response))
		const result = JSON.parse(response.headers.get(RENDER_HEADER) ?? 'null') as RenderResult
		const blob = await response.blob()
		if (controller.signal.aborted) return

		const current = documentOf(state, key)
		if (!current) return

		const previous = current.rendering?.url
		current.rendering = { url: io.createObjectURL(blob), result }
		if (previous) io.revokeObjectURL(previous)
	} catch (error) {
		if (controller.signal.aborted) return
		const current = documentOf(state, key)
		if (current) current.error = message(error)
	} finally {
		if (renders.get(key) === controller) {
			renders.delete(key)
			const current = documentOf(state, key)
			if (current) current.renderPending = false
		}
	}
}

// Shows a document. Ignored for an unknown key.
export function selectImage(state: ImagesState, key: string) {
	if (documentOf(state, key)) state.activeKey = key
}

// Closes a document: aborts its rendering, revokes its object URL, and releases it on the server. The
// next document (or the previous one, for the last) becomes active.
export function closeImage(state: ImagesState, key: string, io: ImagesIo = browserIo) {
	const index = state.documents.findIndex((d) => d.key === key)
	if (index < 0) return

	const document = state.documents[index]
	renders.get(key)?.abort()
	renders.delete(key)
	if (document.rendering) io.revokeObjectURL(document.rendering.url)
	if (document.info) release(document.info.id, io)

	state.documents.splice(index, 1)
	if (state.activeKey === key) state.activeKey = (state.documents[index] ?? state.documents[index - 1])?.key
}
