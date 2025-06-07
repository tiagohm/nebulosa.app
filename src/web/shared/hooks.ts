import { type UseDisclosureProps, useDisclosure, useDraggable } from '@heroui/react'
import { useLocalStorage } from '@uidotdev/usehooks'
import { useEffect, useRef } from 'react'
import { useMutative } from 'use-mutative'

export interface UseDraggableModalProps extends UseDisclosureProps {
	readonly canOverflow?: boolean
}

export interface UseDraggableModalResult {
	readonly isOpen: boolean
	readonly show: () => void
	readonly close: () => void
	readonly onOpenChange: (isOpen: boolean) => void
	readonly targetRef: React.RefObject<HTMLElement | null>
	readonly moveProps: ReturnType<typeof useDraggable>['moveProps']
}

// A hook for managing a draggable modal
export function useDraggableModal({ canOverflow, ...props }: UseDraggableModalProps = {}): UseDraggableModalResult {
	const { isOpen, onOpen: show, onOpenChange, onClose: close } = useDisclosure(props)
	const targetRef = useRef<HTMLElement>(null)
	const { moveProps } = useDraggable({ targetRef: targetRef as never, canOverflow, isDisabled: !isOpen })
	return { isOpen, show, close, onOpenChange, targetRef, moveProps }
}

export function useMutativeLocalStorage<T>(key: string, initialValue: T) {
	const [storedData, setStoredData] = useLocalStorage<T>(key, initialValue)
	const [data, setData] = useMutative<T>(storedData)

	useEffect(() => {
		console.info('storing', data)
		setStoredData(data as never)
	}, [data])

	return [data, setData] as const
}
