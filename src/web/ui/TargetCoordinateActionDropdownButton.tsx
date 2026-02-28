import { DropdownItem } from '@heroui/react'
import { memo } from 'react'
import type { TargetCoordinateAction } from '../shared/types'
import { DropdownButton, type DropdownButtonProps } from './DropdownButton'
import { type Icon, Icons } from './Icon'

export interface TargetCoordinateActionDropdownButtonProps extends Omit<DropdownButtonProps, 'label' | 'onAction' | 'children'> {
	readonly action: TargetCoordinateAction
	readonly onAction: (action: TargetCoordinateAction) => void
}

export function TargetCoordinateActionDropdownButton({ action, onAction, ...props }: TargetCoordinateActionDropdownButtonProps) {
	return (
		<DropdownButton {...props} label={action === 'GOTO' ? GoTo : action === 'SYNC' ? Sync : Frame} onAction={onAction as never}>
			<DropdownItem key='GOTO' startContent={<Icons.Telescope size={12} />}>
				Go
			</DropdownItem>
			<DropdownItem key='SYNC' startContent={<Icons.Sync size={12} />}>
				Sync
			</DropdownItem>
			<DropdownItem key='FRAME' startContent={<Icons.Image size={12} />}>
				Frame
			</DropdownItem>
		</DropdownButton>
	)
}

interface TargetCoordinateDropdownButtonLabelProps {
	readonly icon: Icon
	readonly label: string
}

const TargetCoordinateDropdownButtonLabel = memo(({ icon: Icon, label }: TargetCoordinateDropdownButtonLabelProps) => {
	return (
		<div className='flex items-center gap-2 text-medium'>
			<Icon /> {label}
		</div>
	)
})

const GoTo = <TargetCoordinateDropdownButtonLabel icon={Icons.Telescope} label='Go' />
const Sync = <TargetCoordinateDropdownButtonLabel icon={Icons.Sync} label='Sync' />
const Frame = <TargetCoordinateDropdownButtonLabel icon={Icons.Image} label='Frame' />
