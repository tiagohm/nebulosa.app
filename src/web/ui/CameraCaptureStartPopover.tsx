import { CameraCaptureStartInput } from '@ui/CameraCaptureStartInput'
import { IconButton } from '@ui/components/IconButton'
import type { IconButtonProps } from '@ui/components/IconButton'
import { Popover } from '@ui/components/Popover'
import { Icons } from '@ui/Icon'
import type { DeepReadonly } from 'nebulosa/src/core/types'
import type { Camera } from 'nebulosa/src/devices/indi/device'

export type CameraCaptureStartPopoverMode = 'capture' | 'autoFocus' | 'flatWizard' | 'darv' | 'tppa' | 'guider'

export interface CameraCaptureStartPopoverProps extends Omit<IconButtonProps, 'icon' | 'value' | 'onValueChange'> {
	readonly mode: CameraCaptureStartPopoverMode
	readonly camera: DeepReadonly<Camera>
}

export function CameraCaptureStartPopover({ mode, camera, color, disabled, ...props }: CameraCaptureStartPopoverProps) {
	return (
		<Popover className="max-w-90vw w-120" trigger={<IconButton {...props} color={color ?? (camera.connected ? 'success' : 'danger')} disabled={disabled || !camera.connected} icon={Icons.Cog} size="sm" />}>
			<div className="flex flex-col gap-2">
				<p className="col-span-full font-bold">CAMERA CAPTURE OPTIONS: {camera.name}</p>
				<CameraCaptureStartInput disabled={disabled} mode={mode} camera={camera} />
			</div>
		</Popover>
	)
}
