import { Input, NumberInput, Popover, PopoverContent, PopoverTrigger } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import type { PlateSolverType, PlateSolveStart } from 'src/shared/types'
import { useSnapshot } from 'valtio'
import { SettingsMolecule } from '@/molecules/settings'
import { DECIMAL_NUMBER_FORMAT, DEFAULT_POPOVER_PROPS, INTEGER_NUMBER_FORMAT } from '@/shared/constants'
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
		<Popover className='max-w-110' {...DEFAULT_POPOVER_PROPS}>
			<PopoverTrigger>
				<IconButton icon={Icons.Cog} />
			</PopoverTrigger>
			<PopoverContent>
				<div className='grid grid-cols-12 gap-2 p-4'>
					<p className='col-span-full font-bold'>PLATE SOLVE OPTIONS: {type}</p>
					{type !== 'NOVA_ASTROMETRY_NET' && <Input className='col-span-full' label='Executable' onValueChange={(value) => settings.updateSolver(type, 'executable', value)} size='sm' value={executable} />}
					{type === 'NOVA_ASTROMETRY_NET' && <Input className='col-span-8' label='API Url' onValueChange={(value) => settings.updateSolver(type, 'apiUrl', value)} placeholder='https://nova.astrometry.net' size='sm' value={apiUrl} />}
					{type === 'NOVA_ASTROMETRY_NET' && <Input className='col-span-4' label='API Key' onValueChange={(value) => settings.updateSolver(type, 'apiKey', value)} placeholder='XXXXXXXX' size='sm' value={apiKey} />}
					<NumberInput className='col-span-3' formatOptions={DECIMAL_NUMBER_FORMAT} label='Radius (°)' maxValue={360} minValue={0} onValueChange={(value) => onValueChange('radius', value)} size='sm' step={0.1} value={radius ?? 4} />
					<NumberInput className='col-span-5' formatOptions={INTEGER_NUMBER_FORMAT} label='Focal length (mm)' maxValue={100000} minValue={0} onValueChange={(value) => onValueChange('focalLength', value)} size='sm' value={focalLength} />
					<NumberInput className='col-span-4' formatOptions={DECIMAL_NUMBER_FORMAT} label='Pixel size (µm)' maxValue={1000} minValue={0} onValueChange={(value) => onValueChange('pixelSize', value)} size='sm' step={0.01} value={pixelSize} />
					<NumberInput className='col-span-6' formatOptions={INTEGER_NUMBER_FORMAT} label='Downsample factor' maxValue={4} minValue={0} onValueChange={(value) => settings.updateSolver(type, 'downsample', value)} size='sm' value={downsample} />
					<NumberInput className='col-span-6' formatOptions={INTEGER_NUMBER_FORMAT} label='Timeout (ms)' maxValue={600000} minValue={0} onValueChange={(value) => settings.updateSolver(type, 'timeout', value)} size='sm' value={timeout} />
				</div>
			</PopoverContent>
		</Popover>
	)
}
