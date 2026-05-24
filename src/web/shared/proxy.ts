import { unsubscribe } from 'src/shared/util'
import { subscribe } from 'valtio'
import { subscribeKey } from 'valtio/utils'
import { storageGet, storageSet } from './storage'
import { deepAssign } from './util'

export type ProxyProperties<T extends {}> = `${'p' | 'o'}:${keyof T & string}`

export function fillProxy<T extends {}>(proxy: T, key: string, properties: readonly ProxyProperties<T>[]) {
	for (const property of properties) {
		const name = property.slice(2) as keyof T & string
		const storedValue = storageGet(`${key}.${name}`, undefined)

		if (storedValue !== undefined && storedValue !== null) {
			const currentValue = proxy[name]

			if (property[0] === 'p' || !Object.hasOwnProperty.call(proxy, name) || currentValue === undefined || currentValue === null) {
				proxy[name] = storedValue
			} else {
				deepAssign(currentValue, storedValue)
			}
		}
	}
}

export function subscribeProxy<T extends {}>(proxy: T, key: string, properties: readonly ProxyProperties<T>[]): VoidFunction {
	const unsubscribers = new Array<VoidFunction>(properties.length)

	for (let i = 0; i < properties.length; i++) {
		const property = properties[i]
		const name = property.slice(2) as keyof T & string

		if (property[0] === 'p') {
			unsubscribers[i] = subscribeKey(proxy, name, (value) => {
				storageSet(`${key}.${name}`, value)
			})
		} else if (proxy[name]) {
			unsubscribers[i] = subscribe(proxy[name], () => {
				storageSet(`${key}.${name}`, proxy[name])
			})
		}
	}

	return () => {
		unsubscribe(unsubscribers)
	}
}

export function initProxy<T extends {}>(proxy: T, key: string, properties: readonly ProxyProperties<T>[]) {
	fillProxy(proxy, key, properties)
	return subscribeProxy(proxy, key, properties)
}
