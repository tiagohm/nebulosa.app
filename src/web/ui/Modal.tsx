import { useModal } from '@hooks/modal.hook'
import { IconButton } from '@ui/components/IconButton'
import { Icons } from '@ui/Icon'
import type { CSSProperties, ReactNode } from 'react'
import { createPortal } from 'react-dom'

export interface ModalProps {
	readonly id: string
	readonly header: ReactNode
	readonly subHeader?: ReactNode
	readonly footer?: ReactNode
	readonly children?: ReactNode
	readonly initialWidth: CSSProperties['width']
	readonly onHide?: VoidFunction
}

export function Modal({ id, onHide, header, subHeader, footer, children, initialWidth }: ModalProps) {
	const modal = useModal(id, onHide, { initialWidth })

	return createPortal(
		<div className="modal fixed top-0 left-0 m-auto min-h-0 min-w-0 rounded-xl bg-neutral-950 p-6 shadow-none outline-8 outline-black/25 outline-solid" ref={modal.ref} style={modal.style}>
			<div {...modal.moveProps} className="flex w-full touch-none flex-row items-center justify-between gap-2 select-none">
				<div className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center">
					{typeof header === 'string' ? <div className="ms-10 max-w-full truncate text-lg font-semibold text-neutral-100">{header}</div> : header}
					{subHeader && <div className="ms-10 max-w-full truncate text-sm font-normal text-neutral-400">{subHeader}</div>}
				</div>
				<IconButton color="danger" icon={Icons.Close} onClick={modal.hide} variant="flat" />
			</div>
			<div className="overflow-visible py-4">{children}</div>
			<div {...modal.moveProps} className="flex touch-none flex-row items-center justify-end gap-2 select-none">
				{footer}
			</div>
		</div>,
		document.body,
	)
}
