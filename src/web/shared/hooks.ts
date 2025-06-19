import { useMove } from '@react-aria/interactions'
import { useMolecule } from 'bunshi/react'
import { useCallback } from 'react'
import { ModalMolecule } from './molecules'

// A hook for managing a modal with draggable functionality.
export function useModal(onClose?: () => void) {
	const modal = useMolecule(ModalMolecule)
	const move = useMove(modal)
	const moveProps = { ...move.moveProps, style: { cursor: 'move' } }
	const onOpenChange = useCallback(
		(isOpen: boolean) => {
			modal.props.onOpenChange(isOpen)
			if (!isOpen && onClose) onClose()
		},
		[onClose],
	)

	return { props: { ...modal.props, onOpenChange }, moveProps }
}
