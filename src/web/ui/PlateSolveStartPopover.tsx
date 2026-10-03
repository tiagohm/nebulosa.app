import { PlateSolverStoreContext } from '@shared/context'
import { Button } from '@ui/components/Button'
import type { ButtonProps } from '@ui/components/Button'
import { NumberInput } from '@ui/components/NumberInput'
import { Popover } from '@ui/components/Popover'
import { Icons } from '@ui/Icon'
import { useContext } from 'react'
import { useSnapshot } from 'valtio'
import { DEFAULT_PLATE_SOLVE_START } from '#/platesolver'

export interface PlateSolveStartPopoverProps extends Omit<ButtonProps, 'children'> {}

export function PlateSolveStartPopover({ disabled, ...props }: PlateSolveStartPopoverProps) {
	const solver = useContext(PlateSolverStoreContext)
	const { downsample, timeout, radius, focalLength, pixelSize } = useSnapshot(solver.state)

	return (
		<Popover className="max-w-130" disabled={disabled} trigger={<Button disabled={disabled} startContent={<Icons.Cog />} tooltipContent="Options" rounded variant="ghost" {...props} />}>
			<div className="grid grid-cols-12 gap-2 p-3">
				<NumberInput className="col-span-3" disabled={disabled} fractionDigits={1} label="Radius (°)" maxValue={360} minValue={0} onValueChange={solver.setRadius} step={0.1} value={radius ?? DEFAULT_PLATE_SOLVE_START.radius} />
				<NumberInput className="col-span-5" disabled={disabled} label="Focal length (mm)" maxValue={100000} minValue={0} onValueChange={solver.setFocalLength} value={focalLength} />
				<NumberInput className="col-span-4" disabled={disabled} fractionDigits={2} label="Pixel size (µm)" maxValue={1000} minValue={0} onValueChange={solver.setPixelSize} step={0.01} value={pixelSize} />
				<NumberInput className="col-span-6" disabled={disabled} label="Downsample factor" maxValue={4} minValue={0} onValueChange={solver.setDownsample} value={downsample} />
				<NumberInput className="col-span-6" disabled={disabled} label="Timeout (ms)" maxValue={600000} minValue={0} onValueChange={solver.setTimeout} value={timeout} />
			</div>
		</Popover>
	)
}
