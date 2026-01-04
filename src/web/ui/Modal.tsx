import { Card, CardBody, CardFooter, CardHeader } from '@heroui/react'
import type { CSSProperties, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useModal } from '@/hooks/modal'
import { Icons } from './Icon'
import { IconButton } from './IconButton'

export interface ModalProps {
	readonly id: string
	readonly header: ReactNode
	readonly subHeader?: ReactNode
	readonly footer?: ReactNode
	readonly children?: ReactNode
	readonly maxWidth?: CSSProperties['maxWidth']
	readonly onHide?: VoidFunction
}

export function Modal({ id, onHide, header, subHeader, footer, children, maxWidth }: ModalProps) {
	const modal = useModal(id, onHide)

	return createPortal(
		<div className='modal max-h-[90vh] w-full fixed left-0 top-0 right-0 bottom-0 m-auto pointer-events-none' ref={modal.ref} style={{ maxWidth }}>
			<Card className='p-2 pointer-events-auto'>
				<CardHeader {...modal.moveProps} className='w-full flex flex-row items-center justify-between gap-2'>
					<div className='w-full flex flex-col items-center justify-center'>
						{typeof header === 'string' ? <div className='ms-10 text-lg leading-3 font-semibold text-neutral-100'>{header}</div> : header}
						{subHeader && <div className='ms-10 text-sm font-normal text-neutral-400'>{subHeader}</div>}
					</div>
					<IconButton className='rounded-full' color='danger' icon={Icons.Close} onPointerUp={modal.hide} variant='flat' />
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
