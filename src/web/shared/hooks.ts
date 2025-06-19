import { useMove } from '@react-aria/interactions'
import { useMolecule } from 'bunshi/react'
import { ModalMolecule } from './molecules'

// A hook for managing a modal with draggable functionality.
export function useModal() {
	const modal = useMolecule(ModalMolecule)
	const move = useMove(modal)
	const moveProps = { ...move.moveProps, style: { cursor: 'move' } }

	return { props: modal.props, moveProps }
}
