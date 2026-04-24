import type { CSSProperties, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useModal } from '@/hooks/modal'
import { Button } from './components/Button'
import { Icons } from './Icon'

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
		<div {...modal.moveProps} className="modal fixed top-0 left-0 m-auto max-h-[90vh] w-full rounded-xl bg-neutral-950 p-6 text-white shadow-none outline-8 outline-black/25 outline-solid" ref={modal.ref} style={{ maxWidth }}>
			<div className="flex w-full flex-row items-center justify-between gap-2">
				<div className="flex w-full flex-col items-center justify-center">
					{typeof header === 'string' ? <div className="ms-10 text-lg leading-3 font-semibold text-neutral-100">{header}</div> : header}
					{subHeader && <div className="ms-10 text-sm font-normal text-neutral-400">{subHeader}</div>}
				</div>
				<Button className="rounded-full" color="danger" label={<Icons.Close />} onPointerUp={modal.hide} variant="flat" />
			</div>
			<div className="overflow-visible py-4">{children}</div>
			<div className="flex flex-row items-center justify-end gap-2">{footer}</div>
		</div>,
		document.body,
	)
}
