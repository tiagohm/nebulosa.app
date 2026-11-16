// Keyboard shortcuts of the Sky workspace, for an operator who keeps a hand on the keyboard: / focuses the search, + and
// − zoom the map around its middle, and N returns the clock to the real time. They act only while the Sky is the
// workspace shown, never while a field, a menu, or a dialog takes the keys, and never with Ctrl, Alt, or Meta held, so
// the browser's own shortcuts are untouched.

// Command of a shortcut.
export type SkyShortcut = 'search' | 'zoomIn' | 'zoomOut' | 'now'

// Zoom factor of one zoom shortcut: about two wheel notches.
export const SHORTCUT_ZOOM_FACTOR = 1.5

// Commands by key (KeyboardEvent.key); = is the unshifted + of most layouts.
const SHORTCUTS: Readonly<Record<string, SkyShortcut>> = { '/': 'search', '+': 'zoomIn', '=': 'zoomIn', '-': 'zoomOut', _: 'zoomOut', n: 'now', N: 'now' }

// Returns the command of a key pressed with or without Ctrl, Alt, or Meta (`modified`); undefined for any other key or
// any modified key.
export function skyShortcut(key: string, modified: boolean): SkyShortcut | undefined {
	return modified ? undefined : SHORTCUTS[key]
}

// Returns whether a key event's target takes the keys itself (a field, a select, a combobox, an editable element, or
// anything inside an open dialog), so a shortcut must not act.
export function takesKeys(target: EventTarget | null) {
	return target instanceof Element && (target.closest('input, textarea, select, [contenteditable="true"], [role="combobox"], dialog[open]') !== null || document.querySelector('dialog[open]') !== null)
}
