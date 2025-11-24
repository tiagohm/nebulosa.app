import { unsubscribe } from 'src/shared/bus'
import { subscribeKey } from 'valtio/utils'
import { storageGet, storageSet } from './storage'

export function populateProxy<T extends object>(proxy: T, key: string, properties: readonly (keyof T & string)[]) {
	for (const property of properties) {
		const stored = storageGet(`${key}.${property}`, undefined)

		if (stored !== undefined && stored !== null) {
			proxy[property] = stored
		}
	}
}

export function subscribeProxy<T extends object>(proxy: T, key: string, properties: readonly (keyof T & string)[]): VoidFunction {
	const unsubscribers = new Array<VoidFunction>(properties.length)

	for (let i = 0; i < properties.length; i++) {
		const property = properties[i]
		unsubscribers[i] = subscribeKey(proxy, property, (value) => storageSet(`${key}.${property}`, value))
	}

	return () => unsubscribe(unsubscribers)
}

export function initProxy<T extends object>(proxy: T, key: string, properties: readonly (keyof T & string)[]) {
	populateProxy(proxy, key, properties)
	return subscribeProxy(proxy, key, properties)
}
