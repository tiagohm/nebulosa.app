const store: [string, number][] = []

function max() {
	return store.length === 0 ? 1000000 : store.at(-1)![1]
}

function update(key: string, value: number) {
	document.documentElement.style.setProperty(`--z-index-${key}`, value.toFixed(0))
}

function increment(key: string, force: boolean = false) {
	const index = store.findIndex((e) => e[0] === key)

	if (index < 0) {
		const value = max() + 1
		store.push([key, value])
		update(key, value)
		return value
	} else if (force) {
		const maxIndex = store.length - 1

		// If the key is not at the top, we need to shift the z-index of the other elements
		// and move the key to the top
		if (index !== maxIndex) {
			const max = store[maxIndex][1]

			for (let i = maxIndex; i > index; i--) {
				store[i][1]--
				update(...store[i])
			}

			store.splice(index, 1)
			store.push([key, max])
			update(key, max)
			return max
		}

		return store[index][1]
	} else {
		update(...store[index])
	}
}

function apply(element: HTMLElement, key: string) {
	element.style.zIndex = `var(--z-index-${key})`
}

function remove(key: string) {
	const index = store.findIndex((e) => e[0] === key)
	if (index < 0) return
	store.splice(index, 1)
}

export const zIndex = {
	increment,
	apply,
	remove,
} as const
