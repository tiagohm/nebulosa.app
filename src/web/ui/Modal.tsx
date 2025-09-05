import { Button, Card, CardBody, CardFooter, CardHeader } from '@heroui/react'
import type { CSSProperties, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useModal } from '@/shared/hooks'
import { Icons } from './Icon'

export interface ModalProps {
	readonly name: string
	readonly header?: ReactNode
	readonly footer?: ReactNode
	readonly children?: ReactNode
	readonly maxWidth?: CSSProperties['maxWidth']
	readonly onHide?: VoidFunction
}

export function Modal({ name, onHide, header, footer, children, maxWidth }: ModalProps) {
	const modal = useModal(name, onHide)

	return createPortal(
		<div className='modal max-h-[90vh] w-full fixed top-[50%] left-[50%] translate-x-[-50%] translate-y-[-50%]' ref={modal.ref} style={{ maxWidth }}>
			<Card className='p-2'>
				<CardHeader {...modal.moveProps} className='w-full flex flex-row items-center justify-between gap-2'>
					<div className='w-full text-lg font-semibold text-neutral-900 dark:text-neutral-100'>{header}</div>
					<Button className='rounded-full' color='danger' isIconOnly onPointerUp={modal.hide} variant='flat'>
						<Icons.Close className='w-4 h-4' />
					</Button>
				</CardHeader>
				<CardBody className='overflow-visible px-3 py-1'>{children}</CardBody>
				<CardFooter {...modal.moveProps} className='flex flex-row items-center justify-end gap-2'>
					{footer}
				</CardFooter>
			</Card>
		</div>,
		document.body,
	)
}
