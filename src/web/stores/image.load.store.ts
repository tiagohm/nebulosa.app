import { proxy, ref } from 'valtio'
import type { ImageInfo, ImageTransformation } from '#/image'

// Serializes viewer image requests with a single latest pending request. Capture identity and mirror
// metadata become visible only after the corresponding DOM image loads. Owns and revokes blob URLs.

// Concrete loader type shared by the image viewer and its SVG presentation.
export type ImageLoadStore = ReturnType<typeof imageLoadStore>

// HTTP and notification callbacks supplied by the owning image viewer.
export interface ImageLoadOptions {
	// Fetches encoded pixels and their authoritative metadata for path and the copied transformation.
	readonly open: (path: string, transformation: ImageTransformation, signal: AbortSignal) => Promise<{ blob: Blob; info: ImageInfo } | undefined>
	// Announces accepted metadata when its blob is assigned, preserving existing image bus semantics.
	readonly loaded: (info: ImageInfo) => void
}

// One request's path and private transformation snapshot; a newer request replaces the pending one.
interface ImageLoadRequest {
	// View revision: changes of path or processing invalidate older requests, captures alone do not.
	readonly revision: number
	// Source path sent to the backend.
	readonly path: string
	// Processing settings captured when the request was queued.
	readonly transformation: ImageTransformation
}

export interface ImageLoadState {
	displayed?: ImageInfo
}

// Creates a scoped image loader; attach supplies the DOM target and detach invalidates all work.
export function imageLoadStore(options: ImageLoadOptions) {
	const state = proxy<ImageLoadState>({ displayed: undefined })

	let target: HTMLImageElement | undefined
	let revision = 0
	let requestedKey: string | undefined
	let pending: ImageLoadRequest | undefined
	let draining: Promise<void> | undefined
	let controller: AbortController | undefined
	let assigned: { url: string; info: ImageInfo; revision: number } | undefined

	// Releases the previously assigned URL on replacement, failure, or disposal.
	function release() {
		if (assigned) URL.revokeObjectURL(assigned.url)
		assigned = undefined
	}

	// Binds the mounted image element without starting a request.
	function attach(node: HTMLImageElement) {
		target = node
	}

	// Invalidates pending HTTP/DOM completions and releases the loader's retained metadata and URL.
	function detach() {
		revision++
		requestedKey = undefined
		controller?.abort()
		pending = undefined
		target = undefined
		state.displayed = undefined
		release()
	}

	// Fetches serially, keeping at most one HTTP request and the newest pending request in memory.
	async function drain() {
		try {
			while (pending !== undefined) {
				const request = pending
				pending = undefined

				try {
					controller = new AbortController()
					const data = await options.open(request.path, request.transformation, controller.signal)
					if (!data || request.revision !== revision || !target) continue

					release()

					assigned = { url: URL.createObjectURL(data.blob), info: data.info, revision }
					target.src = assigned.url
					options.loaded(data.info)
				} catch (error) {
					// Own failures of background camera loads without preventing the newest request from running.
					if (!controller?.signal.aborted) console.error('image load failed:', request.path, error)
				}
			}
		} finally {
			controller = undefined
			draining = undefined
		}
	}

	// Queues path with already copied processing settings and resolves after the HTTP queue drains.
	// Display confirmation remains a separate DOM milestone handled by handleLoad.
	function load(path: string, transformation: ImageTransformation): Promise<void> {
		// Keep showing completed exposures when captures outpace HTTP. Their response carries the
		// actual frame identity, so an overlay still cannot cross exposures. Only a changed view intent
		// makes an older response obsolete. This key contains small settings, never pixels or geometry.
		const key = JSON.stringify([path, transformation])

		if (key !== requestedKey) {
			requestedKey = key
			revision++
		}

		pending = { path, transformation, revision }
		state.displayed = undefined
		draining ??= Promise.resolve().then(drain)
		return draining
	}

	// Confirms only the current blob's DOM load, returning true when pixels became displayable.
	function handleLoad(node: HTMLImageElement) {
		if (!assigned || node !== target || node.src !== assigned.url || node.currentSrc !== assigned.url || assigned.revision !== revision) return false
		state.displayed = ref(assigned.info)
		release()
		return true
	}

	// Discards an undecodable image without retaining its URL or exposing its capture identity.
	function handleError(node: HTMLImageElement) {
		if (assigned && node === target && node.src === assigned.url) {
			state.displayed = undefined
			release()
		}
	}

	return {
		state,
		attach,
		detach,
		load,
		handleLoad,
		handleError,
	} as const
}
