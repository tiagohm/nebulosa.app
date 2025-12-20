import { unsubscribe } from 'src/shared/util'
import { subscribe } from 'valtio'
import { subscribeKey } from 'valtio/utils'
import { storageGet, storageSet } from './storage'

export type ProxyProperties<T extends object> = `${'p' | 'o'}:${keyof T & string}`

export function populateProxy<T extends object>(proxy: T, key: string, properties: readonly ProxyProperties<T>[]) {
	for (const property of properties) {
		const name = property.substring(2) as keyof T & string
		const value = storageGet(`${key}.${name}`, undefined)

		if (value !== undefined && value !== null) {
			if (property[0] === 'p') {
				proxy[name] = value
			} else if (proxy[name]) {
				Object.assign(proxy[name], value)
			}
		}
	}
}

export function subscribeProxy<T extends object>(proxy: T, key: string, properties: readonly ProxyProperties<T>[]): VoidFunction {
	const unsubscribers = new Array<VoidFunction>(properties.length)

	for (let i = 0; i < properties.length; i++) {
		const property = properties[i]
		const name = property.substring(2) as keyof T & string

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

export function initProxy<T extends object>(proxy: T, key: string, properties: readonly ProxyProperties<T>[]) {
	populateProxy(proxy, key, properties)
	return subscribeProxy(proxy, key, properties)
}
