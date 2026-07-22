import { settingsStore } from '@stores/settings.store'
import { IconButton } from '@ui/components/IconButton'
import { NumberInput } from '@ui/components/NumberInput'
import { Popover } from '@ui/components/Popover'
import { TextInput } from '@ui/components/TextInput'
import { Icons } from '@ui/Icon'
import { DEFAULT_PLATE_SOLVE_START, type PlateSolverType, type PlateSolveStart } from 'src/shared/types'
import { useSnapshot } from 'valtio'

export interface PlateSolveStartPopoverProps extends Pick<PlateSolveStart, 'radius' | 'focalLength' | 'pixelSize'> {
	readonly type: PlateSolverType
	readonly disabled?: boolean
	readonly onRadiusChange: (value: number) => void
	readonly onFocalLengthChange: (value: number) => void
	readonly onPixelSizeChange: (value: number) => void
}

export function PlateSolveStartPopover({ type, radius, focalLength, pixelSize, disabled = false, onRadiusChange, onFocalLengthChange, onPixelSizeChange }: PlateSolveStartPopoverProps) {
	const { apiKey, apiUrl, downsample, executable, timeout } = useSnapshot(settingsStore.state.solver[type])
	const isNovaAstrometryNet = type === 'novaAstrometryNet'

	return (
		<Popover className="max-w-130" disabled={disabled} trigger={<IconButton disabled={disabled} icon={Icons.Cog} size="sm" tooltipContent="Plate solve options" />}>
			<div className="grid grid-cols-12 gap-2 p-3">
				<p className="col-span-full font-bold">PLATE SOLVE OPTIONS: {type}</p>
				{!isNovaAstrometryNet && <TextInput className="col-span-full" disabled={disabled} label="Executable" onValueChange={(value) => settingsStore.updateSolver(type, 'executable', value)} value={executable} />}
				{isNovaAstrometryNet && <TextInput className="col-span-8" disabled={disabled} label="API URL" onValueChange={(value) => settingsStore.updateSolver(type, 'apiUrl', value)} placeholder="https://nova.astrometry.net" value={apiUrl} />}
				{isNovaAstrometryNet && <TextInput autoComplete="off" className="col-span-4" disabled={disabled} label="API Key" onValueChange={(value) => settingsStore.updateSolver(type, 'apiKey', value)} placeholder="XXXXXXXX" value={apiKey} />}
				<NumberInput className="col-span-3" disabled={disabled} fractionDigits={1} label="Radius (°)" maxValue={360} minValue={0} onValueChange={onRadiusChange} step={0.1} value={radius ?? DEFAULT_PLATE_SOLVE_START.radius} />
				<NumberInput className="col-span-5" disabled={disabled} label="Focal length (mm)" maxValue={100000} minValue={0} onValueChange={onFocalLengthChange} value={focalLength} />
				<NumberInput className="col-span-4" disabled={disabled} fractionDigits={2} label="Pixel size (µm)" maxValue={1000} minValue={0} onValueChange={onPixelSizeChange} step={0.01} value={pixelSize} />
				<NumberInput className="col-span-6" disabled={disabled} label="Downsample factor" maxValue={4} minValue={0} onValueChange={(value) => settingsStore.updateSolver(type, 'downsample', value)} value={downsample} />
				<NumberInput className="col-span-6" disabled={disabled} label="Timeout (ms)" maxValue={600000} minValue={0} onValueChange={(value) => settingsStore.updateSolver(type, 'timeout', value)} value={timeout} />
			</div>
		</Popover>
	)
}
