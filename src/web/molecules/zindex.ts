import { molecule } from 'bunshi'

// Keys and values for z-index management
const zIndex: [string, number][] = []

const NAME_INVALID_CHAR_REGEX = /[\W]+/g

// Molecule that manages z-index for modals and other elements
// It allows to increment the z-index for a specific key and manage the order of elements
// It is used to ensure that the elements are always on top of each other in the correct order
export const ZIndexMolecule = molecule(() => {
	// Returns the maximum z-index value
	function max() {
		return zIndex.length === 0 ? 1000000 : zIndex[zIndex.length - 1][1]
	}

	// Updates the z-index for a specific key
	function update(key: string, value: number) {
		document.documentElement.style.setProperty(`--z-index-${key}`, value.toFixed(0))
	}

	// Computes the new z-index for a specific key for ensuring that it is always on top
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
