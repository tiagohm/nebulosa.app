import { PlateSolverStoreContext } from '@shared/context'
import { IconButton } from '@ui/components/IconButton'
import { NumberInput } from '@ui/components/NumberInput'
import { Popover } from '@ui/components/Popover'
import { TextInput } from '@ui/components/TextInput'
import { Icons } from '@ui/Icon'
import { useContext } from 'react'
import { DEFAULT_PLATE_SOLVE_START } from 'src/types/platesolver'
import { useSnapshot } from 'valtio'

export interface PlateSolveStartPopoverProps {
	readonly disabled?: boolean
}

export function PlateSolveStartPopover({ disabled }: PlateSolveStartPopoverProps) {
	const solver = useContext(PlateSolverStoreContext)
	const { type, apiKey, apiUrl, downsample, executable, timeout, radius, focalLength, pixelSize } = useSnapshot(solver.state)
	const isNovaAstrometryNet = type === 'novaAstrometryNet'

	return (
		<Popover className="max-w-130" disabled={disabled} trigger={<IconButton disabled={disabled} icon={Icons.Cog} size="sm" tooltipContent="Plate solve options" />}>
			<div className="grid grid-cols-12 gap-2 p-3">
				<p className="col-span-full font-bold">PLATE SOLVE OPTIONS: {type === 'astap' ? 'Astap' : type === 'astrometryNet' ? 'Astrometry.net (offline)' : 'Nova Astrometry.net'}</p>
				{!isNovaAstrometryNet && <TextInput className="col-span-full" disabled={disabled} label="Executable" onValueChange={solver.setExecutable} value={executable} />}
				{isNovaAstrometryNet && <TextInput className="col-span-8" disabled={disabled} label="API URL" onValueChange={solver.setApiKey} placeholder="https://nova.astrometry.net" value={apiUrl} />}
				{isNovaAstrometryNet && <TextInput autoComplete="off" className="col-span-4" disabled={disabled} label="API Key" onValueChange={solver.setApiKey} placeholder="XXXXXXXX" value={apiKey} />}
				<NumberInput className="col-span-3" disabled={disabled} fractionDigits={1} label="Radius (°)" maxValue={360} minValue={0} onValueChange={solver.setRadius} step={0.1} value={radius ?? DEFAULT_PLATE_SOLVE_START.radius} />
				<NumberInput className="col-span-5" disabled={disabled} label="Focal length (mm)" maxValue={100000} minValue={0} onValueChange={solver.setFocalLength} value={focalLength} />
				<NumberInput className="col-span-4" disabled={disabled} fractionDigits={2} label="Pixel size (µm)" maxValue={1000} minValue={0} onValueChange={solver.setPixelSize} step={0.01} value={pixelSize} />
				<NumberInput className="col-span-6" disabled={disabled} label="Downsample factor" maxValue={4} minValue={0} onValueChange={solver.setDownsample} value={downsample} />
				<NumberInput className="col-span-6" disabled={disabled} label="Timeout (ms)" maxValue={600000} minValue={0} onValueChange={solver.setTimeout} value={timeout} />
			</div>
		</Popover>
	)
}
