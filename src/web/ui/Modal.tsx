import { Button, Card, CardBody, CardFooter, CardHeader } from '@heroui/react'
import type { CSSProperties, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useModal } from '@/hooks/modal'
import { Icons } from './Icon'

export interface ModalProps {
	readonly id: string
	readonly header?: ReactNode
	readonly footer?: ReactNode
	readonly children?: ReactNode
	readonly maxWidth?: CSSProperties['maxWidth']
	readonly onHide?: VoidFunction
}

export function Modal({ id, onHide, header, footer, children, maxWidth }: ModalProps) {
	const modal = useModal(id, onHide)

	return createPortal(
		<div className='modal max-h-[90vh] w-full fixed left-0 top-0 right-0 bottom-0 m-auto pointer-events-none' ref={modal.ref} style={{ maxWidth }}>
			<Card className='p-2 pointer-events-auto'>
				<CardHeader {...modal.moveProps} className='w-full flex flex-row items-center justify-between gap-2'>
					<div className='w-full text-lg font-semibold text-neutral-900 dark:text-neutral-100'>{header}</div>
					<Button className='rounded-full' color='danger' isIconOnly onPointerUp={modal.hide} variant='flat'>
						<Icons.Close className='w-4 h-4' />
					</Button>
				</CardHeader>
				<CardBody className='overflow-visible p-2'>{children}</CardBody>
				<CardFooter {...modal.moveProps} className='flex flex-row items-center justify-end gap-2'>
					{footer}
				</CardFooter>
			</Card>
		</div>,
		document.body,
	)
}
