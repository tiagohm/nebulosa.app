import { useMolecule } from 'bunshi/react'
import type { PlateSolverType, PlateSolveStart } from 'src/shared/types'
import { useSnapshot } from 'valtio'
import { SettingsMolecule } from '@/molecules/settings'
import { NumberInput } from './components/NumberInput'
import { Popover } from './components/Popover'
import { TextInput } from './components/TextInput'
import { Icons } from './Icon'
import { IconButton } from './IconButton'

export interface PlateSolveStartPopoverProps extends Pick<PlateSolveStart, 'radius' | 'focalLength' | 'pixelSize'> {
	readonly type: PlateSolverType
	readonly onValueChange: <K extends 'radius' | 'focalLength' | 'pixelSize'>(key: K, value: PlateSolveStart[K]) => void
}

export function PlateSolveStartPopover({ type, radius, focalLength, pixelSize, onValueChange }: PlateSolveStartPopoverProps) {
	const settings = useMolecule(SettingsMolecule)
	const { downsample, timeout } = useSnapshot(settings.state.solver[type])
	const { executable, apiUrl, apiKey } = useSnapshot(settings.state.solver[type], { sync: true })

	return (
		<Popover trigger={<IconButton icon={Icons.Cog} />}>
			<div className='grid grid-cols-12 gap-2 p-4'>
				<p className='col-span-full font-bold'>PLATE SOLVE OPTIONS: {type}</p>
				{type !== 'NOVA_ASTROMETRY_NET' && <TextInput className='col-span-full' label='Executable' onValueChange={(value) => settings.updateSolver(type, 'executable', value)} value={executable} />}
				{type === 'NOVA_ASTROMETRY_NET' && <TextInput className='col-span-8' label='API Url' onValueChange={(value) => settings.updateSolver(type, 'apiUrl', value)} placeholder='https://nova.astrometry.net' value={apiUrl} />}
				{type === 'NOVA_ASTROMETRY_NET' && <TextInput className='col-span-4' label='API Key' onValueChange={(value) => settings.updateSolver(type, 'apiKey', value)} placeholder='XXXXXXXX' value={apiKey} />}
				<NumberInput className='col-span-3' fractionDigits={1} label='Radius (°)' maxValue={360} minValue={0} onValueChange={(value) => onValueChange('radius', value)} step={0.1} value={radius ?? 4} />
				<NumberInput className='col-span-5' label='Focal length (mm)' maxValue={100000} minValue={0} onValueChange={(value) => onValueChange('focalLength', value)} value={focalLength} />
				<NumberInput className='col-span-4' fractionDigits={2} label='Pixel size (µm)' maxValue={1000} minValue={0} onValueChange={(value) => onValueChange('pixelSize', value)} step={0.01} value={pixelSize} />
				<NumberInput className='col-span-6' label='Downsample factor' maxValue={4} minValue={0} onValueChange={(value) => settings.updateSolver(type, 'downsample', value)} value={downsample} />
				<NumberInput className='col-span-6' label='Timeout (ms)' maxValue={600000} minValue={0} onValueChange={(value) => settings.updateSolver(type, 'timeout', value)} value={timeout} />
			</div>
		</Popover>
	)
}
