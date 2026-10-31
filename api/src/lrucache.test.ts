import { expect, test } from 'bun:test'
import { LruCache } from './lrucache'

test('evicts the entry used least recently', () => {
	const cache = new LruCache<number>(2)
	cache.set('a', 1)
	cache.set('b', 2)
	expect(cache.get('a')).toBe(1)

	cache.set('c', 3)
	expect(cache.get('b')).toBeUndefined()
	expect(cache.get('a')).toBe(1)
	expect(cache.get('c')).toBe(3)
})

test('storing an entry again replaces it and marks it used', () => {
	const cache = new LruCache<number>(2)
	cache.set('a', 1)
	cache.set('b', 2)
	cache.set('a', 3)
	cache.set('c', 4)
	expect(cache.get('a')).toBe(3)
	expect(cache.get('b')).toBeUndefined()
})

test('removes an entry', () => {
	const cache = new LruCache<number>(2)
	cache.set('a', 1)
	cache.delete('a')
	expect(cache.get('a')).toBeUndefined()
})
