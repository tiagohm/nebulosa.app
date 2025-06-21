// Stops the invocation of event listeners after the current one completes.
export function stopPropagation(event: Event | React.PointerEvent) {
	event.stopPropagation()
}

// Prevents the default action of the event if it is cancelable.
export function preventDefault(event: Event) {
	event.cancelable && event.preventDefault()
}

// This is necessary to prevent the page from scrolling while dragging the modal or image on touch devices.
export function registerPreventDefaultOnTouchMove() {
	document.body.addEventListener('touchmove', preventDefault, { passive: false })
}

export function unregisterPreventDefaultOnTouchMove() {
	document.body.removeEventListener('touchmove', preventDefault)
}
