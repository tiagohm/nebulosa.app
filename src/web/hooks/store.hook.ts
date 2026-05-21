import { useEffect, useMemo, useRef, type DependencyList, type RefObject } from 'react'

interface Store {
	readonly mount?: VoidFunction
	readonly unmount?: VoidFunction
}

function dispose(ref: RefObject<VoidFunction | undefined>) {
	if (ref.current !== undefined) {
		ref.current()
		ref.current = undefined
	}
}

const registry = new FinalizationRegistry<RefObject<VoidFunction | undefined>>(dispose)

export function useStore<T extends Store>(factory: T | (() => T), deps: DependencyList) {
	const cleanupRef = useRef<VoidFunction | undefined>(undefined)
	const unmountRef = useRef(false)

	if (!unmountRef.current) {
		unmountRef.current = true
		// This works since refs are preserved for the component's lifetime
		registry.register(unmountRef, cleanupRef)
	}

	const store = useMemo(() => {
		dispose(cleanupRef)
		const store = factory instanceof Function ? factory() : factory
		cleanupRef.current = store.unmount
		return store
	}, deps)

	useEffect(() => {
		store.mount?.()
		return cleanupRef.current
	}, [store])

	return store
}
