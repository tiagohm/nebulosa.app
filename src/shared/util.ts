// Unsubscribes all provided unsubscribers
export function unsubscribe(unsubscribers?: readonly (VoidFunction | undefined)[]) {
	if (unsubscribers) for (const e of unsubscribers) e?.()
}
