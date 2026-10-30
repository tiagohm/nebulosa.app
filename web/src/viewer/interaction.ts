import type { OverlayView, Point } from './transform'

// Ownership of the pointer gestures of the image viewer: which of the default pan, a two-finger pinch, or the
// interaction of a tool a press belongs to, and what each pointer event then does. A pure reducer over pointer ids and
// client positions (CSS pixels), so the routing is tested without a DOM. A press belongs to the tool only when the
// tool took it on its first pointer; a second pointer always turns the gesture into a pinch, cancelling what the tool
// was doing, and nothing is resumed until every pointer is lifted. A press of the pan released within the click
// tolerance is a click, never a drag or a pinch.

// Interaction of a tool with the viewer, in image coordinates and the current view. The viewer stays unaware of what
// the tool does: it only hands it the presses it takes, and keeps zoom and pan otherwise.
export interface ViewerInteraction {
	// Pointer shown over the image while the interaction is active and Space is not held.
	readonly cursor: 'crosshair' | 'default'
	// Called on the first pointer of a press; returns whether the tool takes the gesture, otherwise the viewer pans.
	readonly onPointerDown: (point: Point, view: OverlayView) => boolean
	// Called as the pointer moves during a gesture the tool took, and as a mouse hovers without any button pressed.
	readonly onPointerMove: (point: Point, view: OverlayView) => void
	// Called when the press the tool took is released.
	readonly onPointerUp: (point: Point, view: OverlayView) => void
	// Called when what the tool was doing must be abandoned: a pinch, a cancelled or lost pointer, or Escape.
	readonly onCancel: () => void
	// Called on Delete or Backspace while the viewport has the focus.
	readonly onDelete?: () => void
}

// Who a gesture belongs to.
export type GestureOwner = 'pan' | 'tool' | 'pinch'

// Gesture in progress over the viewport.
export interface GestureState {
	// Ids of the pressed pointers, in pressing order.
	readonly pressed: readonly number[]
	// Owner of the gesture; absent while no pointer is pressed.
	readonly owner?: GestureOwner
	// Pointer and client position (CSS pixels) of a press that may still be a click; cleared once it moves beyond the
	// tolerance or another pointer is pressed.
	readonly press?: { readonly id: number; readonly at: Point }
}

// Pointer event of the viewport, client positions in CSS pixels.
export type GestureEvent =
	// A pointer is pressed; tool tells whether the tool took it (only asked for the first pointer).
	| { readonly type: 'down'; readonly id: number; readonly at: Point; readonly tool: boolean }
	// A pointer moves, pressed or not.
	| { readonly type: 'move'; readonly id: number; readonly at: Point }
	// A pointer is released.
	| { readonly type: 'up'; readonly id: number }
	// A pointer is cancelled by the browser or loses its capture.
	| { readonly type: 'cancel'; readonly id: number }

// What the viewer does for an event: give it to the tool (move, release, cancel, or a hover), pan, pinch, report a
// click, or nothing.
export type GestureEffect = 'toolMove' | 'toolUp' | 'toolCancel' | 'hover' | 'pan' | 'pinch' | 'click' | undefined

// Result of an event.
export interface GestureStep {
	// Gesture after the event.
	readonly state: GestureState
	// What the viewer does for it.
	readonly effect: GestureEffect
}

// Gesture when no pointer is pressed.
export const IDLE_GESTURE: GestureState = { pressed: [] }

// Returns the gesture after a pointer event and what the viewer does for it; tolerance is the distance in CSS pixels a
// press may move and still be a click.
export function routeGesture(state: GestureState, event: GestureEvent, tolerance: number): GestureStep {
	switch (event.type) {
		case 'down': {
			if (state.pressed.includes(event.id)) return { state, effect: undefined }
			const pressed = [...state.pressed, event.id]
			if (pressed.length === 1) return { state: { pressed, owner: event.tool ? 'tool' : 'pan', press: { id: event.id, at: event.at } }, effect: undefined }
			return { state: { pressed, owner: 'pinch' }, effect: state.owner === 'tool' ? 'toolCancel' : 'pinch' }
		}
		case 'move': {
			if (!state.pressed.includes(event.id)) return { state, effect: state.owner === undefined ? 'hover' : undefined }
			const moved = state.press?.id === event.id && Math.hypot(event.at.x - state.press.at.x, event.at.y - state.press.at.y) > tolerance
			const next = moved ? { pressed: state.pressed, owner: state.owner } : state
			return { state: next, effect: state.owner === 'tool' ? 'toolMove' : state.owner === 'pinch' ? 'pinch' : 'pan' }
		}
		case 'up':
		case 'cancel': {
			if (!state.pressed.includes(event.id)) return { state, effect: undefined }
			const pressed = state.pressed.filter((id) => id !== event.id)
			// A finger left down after a pinch does nothing until every pointer is lifted.
			const next: GestureState = pressed.length === 0 ? IDLE_GESTURE : { pressed, owner: 'pinch' }
			if (state.owner === 'tool') return { state: next, effect: event.type === 'up' ? 'toolUp' : 'toolCancel' }
			if (state.owner === 'pan' && event.type === 'up' && state.press?.id === event.id) return { state: next, effect: 'click' }
			return { state: next, effect: undefined }
		}
	}
}
