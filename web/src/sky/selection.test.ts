import { expect, test } from 'bun:test'
import { createLatestRunner } from './selection'

test('the latest runner keeps one run in flight and runs only the latest instant asked meanwhile', async () => {
	const runs: number[] = []
	const flights: (() => void)[] = []
	const request = createLatestRunner((time) => {
		runs.push(time)
		return new Promise<void>((resolve) => {
			flights.push(resolve)
		})
	})

	request(1)
	request(2)
	request(3)
	expect(runs).toEqual([1])

	flights.shift()!()
	await Bun.sleep(0)
	expect(runs).toEqual([1, 3])

	flights.shift()!()
	await Bun.sleep(0)
	expect(runs).toEqual([1, 3])
})

test('the latest runner drops the waiting instant once it is no longer alive, and survives a failed run', async () => {
	let alive = true
	const runs: number[] = []
	const flights: ((failed: boolean) => void)[] = []
	const request = createLatestRunner(
		(time) => {
			runs.push(time)
			return new Promise<void>((resolve, reject) => {
				flights.push((failed) => (failed ? reject(new Error('down')) : resolve()))
			})
		},
		() => alive,
	)

	request(1)
	request(2)
	flights.shift()!(true)
	await Bun.sleep(0)
	expect(runs).toEqual([1, 2])

	request(3)
	alive = false
	flights.shift()!(false)
	await Bun.sleep(0)
	expect(runs).toEqual([1, 2])
})
