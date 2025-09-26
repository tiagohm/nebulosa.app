// Stop the propagation of an event to parent elements
export function stopPropagation(event: Event | React.BaseSyntheticEvent) {
	event.stopPropagation()
}

// Prevent the default action of an event if it is cancelable
export function preventDefault(event: Event | React.BaseSyntheticEvent) {
	event.cancelable && event.preventDefault()
}

// Check if the Wake Lock API is supported
export function isWakeLockSupported() {
	return 'wakeLock' in navigator
}
