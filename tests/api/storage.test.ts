import { expect, test } from 'bun:test'
import { StorageHandler } from 'src/api/storage'

const db = new StorageHandler(true)

test('put and get boolean value', () => {
	expect(db.put('boolean', true)).toBeTrue()
	expect(db.get('boolean')).toBeTrue()

	expect(db.put('boolean', false)).toBeTrue()
	expect(db.get('boolean')).toBeFalse()
})

test('put and get number value', () => {
	expect(db.put('number', Math.PI)).toBeTrue()
	expect(db.get('number')).toBe(Math.PI)

	expect(db.put('number', 5)).toBeTrue()
	expect(db.get('number')).toBe(5)
})

test('put and get text value', () => {
	expect(db.put('text', 'Tiago')).toBeTrue()
	expect(db.get('text')).toBe('Tiago')

	expect(db.put('text', 'Giovanna')).toBeTrue()
	expect(db.get('text')).toBe('Giovanna')
})

test('put and get object value', () => {
	expect(db.put('object', { name: 'Tiago' })).toBeTrue()
	expect(db.get('object')).toEqual({ name: 'Tiago' })

	expect(db.put('object', { name: 'Giovanna' })).toBeTrue()
	expect(db.get('object')).toEqual({ name: 'Giovanna' })
})

test('put and get raw object value', () => {
	expect(db.put('object', { name: 'Tiago' })).toBeTrue()
	expect(db.get('object', true)).toBe('{"name":"Tiago"}')
})

test('list all keys', () => {
	for (let i = 0; i < 10; i++) expect(db.put(i.toFixed(0), i)).toBeTrue()
	expect(db.keys()).toContainAnyValues(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'])
})

test('list all', () => {
	expect(db.put('A0', 0)).toBeTrue()
	const res = db.all()
	expect(res).toContainKey('A0')
	expect(res.A0).toBe(0)
})

test('check key exists', () => {
	db.put('a', 'b')
	expect(db.has('a')).toBeTrue()
	expect(db.has('b')).toBeFalse()
})

test('delete existing key', () => {
	db.put('c', 'd')
	expect(db.has('c')).toBeTrue()
	expect(db.delete('c')).toBeTrue()
	expect(db.has('c')).toBeFalse()
	expect(db.delete('c')).toBeFalse()
})

test('clear', () => {
	db.put('r', 5)
	expect(db.get('r')).toBe(5)
	expect(db.keys()).not.toBeEmpty()
	db.clear()
	expect(db.has('r')).toBeFalse()
	expect(db.keys()).toBeEmpty()
})
