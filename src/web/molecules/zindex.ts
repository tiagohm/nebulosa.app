import { molecule } from 'bunshi'

const zIndex: [string, number][] = []

const NAME_INVALID_CHAR_REGEX = /[\W]+/g

export const ZIndexMolecule = molecule(() => {
	function max() {
		return zIndex.length === 0 ? 1000000 : zIndex[zIndex.length - 1][1]
	}

	function update(key: string, value: number) {
		document.documentElement.style.setProperty(`--z-index-${key}`, value.toFixed(0))
	}

	function increment(key: string, force: boolean = false) {
		key = key.replace(NAME_INVALID_CHAR_REGEX, '-')

		const index = zIndex.findIndex((e) => e[0] === key)

		if (index < 0) {
			const value = max() + 1
			zIndex.push([key, value])
			update(key, value)
			return value
		} else if (force) {
			const maxIndex = zIndex.length - 1

			// If the key is not at the top, we need to shift the z-index of the other elements
			// and move the key to the top
			if (index !== maxIndex) {
				const max = zIndex[maxIndex][1]

				for (let i = maxIndex; i > index; i--) {
					zIndex[i][1]--
					update(...zIndex[i])
				}

				zIndex.splice(index, 1)
				zIndex.push([key, max])
				update(key, max)
				return max
			}

			return zIndex[index][1]
		} else {
			update(...zIndex[index])
		}
	}

	function apply(element: HTMLElement, key: string) {
		key = key.replace(NAME_INVALID_CHAR_REGEX, '-')
		element.style.zIndex = `var(--z-index-${key}) !important`
	}

	function remove(key: string) {
		key = key.replace(NAME_INVALID_CHAR_REGEX, '-')
		const index = zIndex.findIndex((e) => e[0] === key)
		if (index < 0) return
		zIndex.splice(index, 1)
	}

	return { increment, apply, remove } as const
})
