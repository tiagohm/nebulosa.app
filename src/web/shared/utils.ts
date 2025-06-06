// Stops the invocation of event listeners after the current one completes.
export function stopPropagation(event: Event | React.PointerEvent) {
	event.stopPropagation()
}
