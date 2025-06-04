import { useDisclosure, useDraggable } from '@heroui/react'
import { useRef } from 'react'

export function useDraggableModal(canOverflow: boolean = false) {
	const { isOpen, onOpen: show, onOpenChange, onClose: close } = useDisclosure()
	const targetRef = useRef<HTMLElement>(null)
	const { moveProps } = useDraggable({ targetRef: targetRef as never, canOverflow, isDisabled: !isOpen })
	return { isOpen, show, close, onOpenChange, targetRef, moveProps }
}
