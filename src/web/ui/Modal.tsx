import { Button, Card, CardBody, CardFooter, CardHeader } from '@heroui/react'
import * as Lucide from 'lucide-react'
import type { ReactNode } from 'react'
import { useModal } from '@/shared/hooks'

export interface ModalProps {
	readonly name: string
	readonly header?: ReactNode
	readonly footer?: ReactNode
	readonly children?: ReactNode
	readonly onClose?: VoidFunction
}

export function Modal({ name, onClose, header, footer, children }: ModalProps) {
	const modal = useModal(name, onClose)

	return (
		<div className='modal fixed min-w-max top-[50%] left-[50%] translate-x-[-50%] translate-y-[-50%]' ref={modal.ref}>
			<Card className='p-2'>
				<CardHeader {...modal.moveProps} className='w-full flex flex-row items-center justify-between gap-2'>
					<div className='w-full text-lg font-semibold text-neutral-900 dark:text-neutral-100'>{header}</div>
					<Button className='rounded-full' color='danger' isIconOnly onPointerUp={modal.close} variant='flat'>
						<Lucide.X className='w-4 h-4' />
					</Button>
				</CardHeader>
				<CardBody className='overflow-visible'>{children}</CardBody>
				<CardFooter {...modal.moveProps} className='flex flex-row items-center justify-end gap-2'>
					{footer}
				</CardFooter>
			</Card>
		</div>
	)
}
