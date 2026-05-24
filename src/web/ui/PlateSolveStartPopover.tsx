import { DEFAULT_PLATE_SOLVE_START, type PlateSolverType, type PlateSolveStart } from 'src/shared/types'
import { useSnapshot } from 'valtio'
import { settingsStore } from '../store/settings.store'
import { IconButton } from './components/IconButton'
import { NumberInput } from './components/NumberInput'
import { Popover } from './components/Popover'
import { TextInput } from './components/TextInput'
import { Icons } from './Icon'

export interface PlateSolveStartPopoverProps extends Pick<PlateSolveStart, 'radius' | 'focalLength' | 'pixelSize'> {
	readonly type: PlateSolverType
	readonly disabled?: boolean
	readonly onValueChange: <K extends 'radius' | 'focalLength' | 'pixelSize'>(key: K, value: PlateSolveStart[K]) => void
}

export function PlateSolveStartPopover({ type, radius, focalLength, pixelSize, disabled = false, onValueChange }: PlateSolveStartPopoverProps) {
	const { apiKey, apiUrl, downsample, executable, timeout } = useSnapshot(settingsStore.state.solver[type])
	const isNovaAstrometryNet = type === 'novaAstrometryNet'

	return (
		<Popover className="max-w-130" disabled={disabled} trigger={<IconButton disabled={disabled} icon={Icons.Cog} size="sm" tooltipContent="Plate solve options" />}>
			<div className="grid grid-cols-12 gap-2 p-4">
				<p className="col-span-full font-bold">PLATE SOLVE OPTIONS: {type}</p>
				{!isNovaAstrometryNet && <TextInput className="col-span-full" disabled={disabled} label="Executable" onValueChange={(value) => settingsStore.updateSolver(type, 'executable', value)} value={executable} />}
				{isNovaAstrometryNet && <TextInput className="col-span-8" disabled={disabled} label="API URL" onValueChange={(value) => settingsStore.updateSolver(type, 'apiUrl', value)} placeholder="https://nova.astrometry.net" value={apiUrl} />}
				{isNovaAstrometryNet && <TextInput autoComplete="off" className="col-span-4" disabled={disabled} label="API Key" onValueChange={(value) => settingsStore.updateSolver(type, 'apiKey', value)} placeholder="XXXXXXXX" value={apiKey} />}
				<NumberInput className="col-span-3" disabled={disabled} fractionDigits={1} label="Radius (°)" maxValue={360} minValue={0} onValueChange={(value) => onValueChange('radius', value)} step={0.1} value={radius ?? DEFAULT_PLATE_SOLVE_START.radius} />
				<NumberInput className="col-span-5" disabled={disabled} label="Focal length (mm)" maxValue={100000} minValue={0} onValueChange={(value) => onValueChange('focalLength', value)} value={focalLength} />
				<NumberInput className="col-span-4" disabled={disabled} fractionDigits={2} label="Pixel size (µm)" maxValue={1000} minValue={0} onValueChange={(value) => onValueChange('pixelSize', value)} step={0.01} value={pixelSize} />
				<NumberInput className="col-span-6" disabled={disabled} label="Downsample factor" maxValue={4} minValue={0} onValueChange={(value) => settingsStore.updateSolver(type, 'downsample', value)} value={downsample} />
				<NumberInput className="col-span-6" disabled={disabled} label="Timeout (ms)" maxValue={600000} minValue={0} onValueChange={(value) => settingsStore.updateSolver(type, 'timeout', value)} value={timeout} />
			</div>
		</Popover>
	)
}
