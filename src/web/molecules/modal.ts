import { createScope, molecule } from 'bunshi'
import { ZIndexMolecule } from './zindex'

export interface ModalScopeValue {
	readonly name: string
	readonly canOverflow?: boolean
	readonly isAlwaysOnTop?: boolean
}

export const ModalScope = createScope<ModalScopeValue>({ name: '' })

// Molecule that manages modals
// It handles the position, transformation, and z-index of modals
// It allows dragging and moving modals within the workspace
// It also ensures that modals are always on top of other elements
export const ModalMolecule = molecule((m, s) => {
	const scope = s(ModalScope)
	const zIndex = m(ZIndexMolecule)

	const name = scope.name.replace(/[^\w-]/g, '-').toLowerCase()

	// Increment the z-index for the modal
	zIndex.increment(name, scope.isAlwaysOnTop ?? false)

	let targetRef: HTMLElement | undefined

	// Sets the z-index of the modal to ensure it is on top when the move starts
	function onDragStart() {
		if (!targetRef) return

		zIndex.increment(name, true)
	}

	// Handles the pointer up event, which increments the z-index of the modal
	// to ensure it is on top of other elements.
	function onPointerUp(event: React.PointerEvent<HTMLElement> | Event) {
		event.stopPropagation()
		zIndex.increment(name, true)
	}

	// Sets the reference to the target element and sets the z-index of the parent element to ensure it is on top.
	function ref(node: HTMLElement | null) {
		if (node && node !== targetRef) {
			targetRef = node

			if (node.parentElement) {
				node.parentElement.style.zIndex = `var(--z-index-${name}) !important`
			}
		}
	}

	// Handles the open change event of the modal
	// If the modal is closed, it removes the z-index from the modal
	// This ensures that the modal will be on top of other elements when it is opened again
	// by requesting a new z-index.
	function onOpenChange(isOpen: boolean) {
		if (!isOpen) zIndex.remove(name)
	}

	const props = {
		ref,
		onPointerUp,
		onOpenChange,
		backdrop: 'transparent',
		size: 'sm',
		isDismissable: false,
		isOpen: true,
	} as const

	return { scope, props, onDragStart, targetRef }
})
