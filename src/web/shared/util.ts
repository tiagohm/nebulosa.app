export function stopPropagation(event: Event | React.PointerEvent) {
	event.stopPropagation()
}

export function preventDefault(event: Event) {
	event.cancelable && event.preventDefault()
}
