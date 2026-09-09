import { proxy, ref } from 'valtio'
import { proxyMap } from 'valtio/utils'
import type { TppaEvent, TppaOverlayEvent } from '#/tppa'

// Transient TPPA presentation shared across dock panels. Each mounted TPPA panel owns at most one
// record; immutable geometry is retained by reference and never persisted or deeply proxied.

// One panel's latest active alignment snapshot and local visibility preference.
export interface TppaOverlayPresentation {
	// Top-level operation owning this geometry.
	readonly operation: string
	// Camera device id, independent of its display name.
	readonly camera: string
	// Mount device id paired with the camera.
	readonly mount: string
	// Capture attempt count, used to reject older snapshots of the same run.
	readonly count: number
	// Whether this panel allows its geometry to be drawn.
	readonly enabled: boolean
	// Most recent geometry or diagnostic, absent before the first successful alignment.
	readonly overlay?: TppaOverlayEvent
}

// Bounded by mounted TPPA panels; keys are the owning dock panel ids.
const state = proxy({
	panels: proxyMap<string, TppaOverlayPresentation>(),
})

// Replaces owner's latest active snapshot without letting another run's refusal clear it.
function update(owner: string, event: TppaEvent, enabled: boolean) {
	const previous = state.panels.get(owner)

	if (event.state === 'idle') {
		if (previous?.operation === event.id) state.panels.delete(owner)
		return
	}

	if (previous && previous.operation !== event.id && !(event.state === 'capturing' && event.count === 1)) return
	if (previous?.operation === event.id && previous.count > event.count) return
	if (event.overlay !== undefined) state.panels.set(owner, { operation: event.id, camera: event.camera, mount: event.mount, count: event.count, enabled, overlay: ref(event.overlay) })
}

// Changes only owner's visibility, leaving its latest geometry available when shown again.
function setEnabled(owner: string, enabled: boolean) {
	const previous = state.panels.get(owner)
	if (previous) state.panels.set(owner, { ...previous, enabled })
}

// Releases owner's transient record on unmount, reset, or connection loss.
function remove(owner: string) {
	state.panels.delete(owner)
}

// Shared presentation actions; subscriptions and persistence remain owned by the TPPA panel store.
export const tppaOverlayStore = {
	state,
	update,
	setEnabled,
	remove,
} as const
