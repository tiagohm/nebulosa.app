// Stops the invocation of event listeners after the current one completes.
export function stopPropagation(event: Event | React.PointerEvent) {
	event.stopPropagation()
}

// Prevents the default action of the event if it is cancelable.
export function preventDefault(event: Event) {
	event.cancelable && event.preventDefault()
}
