import { Button, Chip, Popover, PopoverContent, PopoverTrigger, Tooltip } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import aboutIcon from '@/assets/about.webp'
import alignmentIcon from '@/assets/alignment.webp'
import autoFocusIcon from '@/assets/auto-focus.webp'
import calculatorIcon from '@/assets/calculator.webp'
import cameraIcon from '@/assets/camera.webp'
import coverIcon from '@/assets/cover.webp'
import filterWheelIcon from '@/assets/filter-wheel.webp'
import flatPanelIcon from '@/assets/flat-panel.webp'
import flatWizardIcon from '@/assets/flat-wizard.webp'
import focuserIcon from '@/assets/focuser.webp'
import framingIcon from '@/assets/framing.webp'
import guideOutputIcon from '@/assets/guide-output.webp'
import guiderIcon from '@/assets/guider.webp'
import heaterIcon from '@/assets/heater.webp'
import indiIcon from '@/assets/indi.webp'
import mountIcon from '@/assets/mount.webp'
import rotatorIcon from '@/assets/rotator.webp'
import sequencerIcon from '@/assets/sequencer.webp'
import settingsIcon from '@/assets/settings.webp'
import skyAtlasIcon from '@/assets/sky-atlas.webp'
import thermometerIcon from '@/assets/thermometer.webp'
import { AboutMolecule } from '@/molecules/about'
import { CalculatorMolecule } from '@/molecules/calculator'
import { FramingMolecule } from '@/molecules/framing'
import { HomeMolecule } from '@/molecules/home'
import { type EquipmentDeviceType, EquipmentMolecule } from '@/molecules/indi/equipment'
import { SkyAtlasMolecule } from '@/molecules/skyatlas'
import { About } from './About'
import { Calculator } from './Calculator'
import { Framing } from './Framing'
import { Icons } from './Icon'
import { SkyAtlas } from './SkyAtlas'

export type HomeMenuItem = 'camera' | 'mount' | 'filter-wheel' | 'focuser' | 'rotator' | 'light-box' | 'dust-cap' | 'guide-output' | 'dew-heater' | 'thermometer' | 'guider' | 'sky-atlas' | 'framing' | 'aligment' | 'auto-focus' | 'flat-wizard' | 'sequencer' | 'indi' | 'calculator' | 'settings' | 'about'

export const HomeMenu = memo(() => {
	const skyAtlas = useMolecule(SkyAtlasMolecule)
	const { show: showSkyAtlas } = useSnapshot(skyAtlas.state)

	const framing = useMolecule(FramingMolecule)
	const { show: showFraming } = useSnapshot(framing.state)

	const calculator = useMolecule(CalculatorMolecule)
	const { show: showCalculator } = useSnapshot(calculator.state)

	const about = useMolecule(AboutMolecule)
	const { show: showAbout } = useSnapshot(about.state)

	return (
		<>
			<HomeMenuPopover />
			{showSkyAtlas && <SkyAtlas />}
			{showFraming && <Framing />}
			{showAbout && <About />}
			{showCalculator && <Calculator />}
		</>
	)
})

export const HomeMenuPopover = memo(() => {
	const home = useMolecule(HomeMolecule)
	const { show } = useSnapshot(home.state.menu)

	const equipment = useMolecule(EquipmentMolecule)
	const { selected, camera, mount, focuser, cover, flatPanel, guideOutput, thermometer, dewHeater } = useSnapshot(equipment.state)

	const skyAtlas = useMolecule(SkyAtlasMolecule)
	const framing = useMolecule(FramingMolecule)
	const calculator = useMolecule(CalculatorMolecule)
	const about = useMolecule(AboutMolecule)

	return (
		<Popover isOpen={show} onOpenChange={home.toggleMenu} placement='bottom' showArrow>
			<PopoverTrigger>
				<Button color='secondary' isIconOnly variant='light'>
					<Icons.Menu />
				</Button>
			</PopoverTrigger>
			<PopoverContent>
				<div className='grid grid-cols-6 gap-2 p-4'>
					<Tooltip content='Camera' placement='bottom' showArrow>
						<Button color='secondary' isDisabled={camera.length === 0} isIconOnly onPointerUp={() => equipment.select('camera')} size='lg' variant='light'>
							<img className='w-9' src={cameraIcon} />
						</Button>
					</Tooltip>
					<Tooltip content='Mount' placement='bottom' showArrow>
						<Button color='secondary' isDisabled={mount.length === 0} isIconOnly onPointerUp={() => equipment.select('mount')} size='lg' variant='light'>
							<img className='w-9' src={mountIcon} />
						</Button>
					</Tooltip>
					<Tooltip content='Filter Wheel' placement='bottom' showArrow>
						<Button color='secondary' isDisabled isIconOnly onPointerUp={() => equipment.select('wheel')} size='lg' variant='light'>
							<img className='w-9' src={filterWheelIcon} />
						</Button>
					</Tooltip>
					<Tooltip content='Focuser' placement='bottom' showArrow>
						<Button color='secondary' isDisabled={focuser.length === 0} isIconOnly onPointerUp={() => equipment.select('focuser')} size='lg' variant='light'>
							<img className='w-9' src={focuserIcon} />
						</Button>
					</Tooltip>
					<Tooltip content='Rotator' placement='bottom' showArrow>
						<Button color='secondary' isDisabled isIconOnly onPointerUp={() => equipment.select('rotator')} size='lg' variant='light'>
							<img className='w-9' src={rotatorIcon} />
						</Button>
					</Tooltip>
					<Tooltip content='Flat Panel' placement='bottom' showArrow>
						<Button color='secondary' isDisabled={flatPanel.length === 0} isIconOnly onPointerUp={() => equipment.select('flatPanel')} size='lg' variant='light'>
							<img className='w-9' src={flatPanelIcon} />
						</Button>
					</Tooltip>
					<Tooltip content='Cover' placement='bottom' showArrow>
						<Button color='secondary' isDisabled={cover.length === 0} isIconOnly onPointerUp={() => equipment.select('cover')} size='lg' variant='light'>
							<img className='w-9' src={coverIcon} />
						</Button>
					</Tooltip>
					<Tooltip content='Guide Output' placement='bottom' showArrow>
						<Button color='secondary' isDisabled={guideOutput.length === 0} isIconOnly onPointerUp={() => equipment.select('guideOutput')} size='lg' variant='light'>
							<img className='w-9' src={guideOutputIcon} />
						</Button>
					</Tooltip>
					<Tooltip content='Dew Heater' placement='bottom' showArrow>
						<Button color='secondary' isDisabled={dewHeater.length === 0} isIconOnly onPointerUp={() => equipment.select('dewHeater')} size='lg' variant='light'>
							<img className='w-9' src={heaterIcon} />
						</Button>
					</Tooltip>
					<Tooltip content='Thermometer' placement='bottom' showArrow>
						<Button color='secondary' isDisabled={thermometer.length === 0} isIconOnly onPointerUp={() => equipment.select('thermometer')} size='lg' variant='light'>
							<img className='w-9' src={thermometerIcon} />
						</Button>
					</Tooltip>
					<Tooltip content='Guider' placement='bottom' showArrow>
						<Button color='secondary' isDisabled isIconOnly size='lg' variant='light'>
							<img className='w-9' src={guiderIcon} />
						</Button>
					</Tooltip>
					<Tooltip content='Sky Atlas' placement='bottom' showArrow>
						<Button color='secondary' isIconOnly onPointerUp={skyAtlas.show} size='lg' variant='light'>
							<img className='w-9' src={skyAtlasIcon} />
						</Button>
					</Tooltip>
					<Tooltip content='Framing' placement='bottom' showArrow>
						<Button color='secondary' isIconOnly onPointerUp={framing.show} size='lg' variant='light'>
							<img className='w-9' src={framingIcon} />
						</Button>
					</Tooltip>
					<Tooltip content='Aligment' placement='bottom' showArrow>
						<Button color='secondary' isDisabled={camera.length === 0} isIconOnly size='lg' variant='light'>
							<img className='w-9' src={alignmentIcon} />
						</Button>
					</Tooltip>
					<Tooltip content='Auto Focus' placement='bottom' showArrow>
						<Button color='secondary' isDisabled={camera.length === 0} isIconOnly size='lg' variant='light'>
							<img className='w-9' src={autoFocusIcon} />
						</Button>
					</Tooltip>
					<Tooltip content='Flat Wizard' placement='bottom' showArrow>
						<Button color='secondary' isDisabled={camera.length === 0} isIconOnly size='lg' variant='light'>
							<img className='w-9' src={flatWizardIcon} />
						</Button>
					</Tooltip>
					<Tooltip content='Sequencer' placement='bottom' showArrow>
						<Button color='secondary' isDisabled={camera.length === 0} isIconOnly size='lg' variant='light'>
							<img className='w-9' src={sequencerIcon} />
						</Button>
					</Tooltip>
					<Tooltip content='INDI' placement='bottom' showArrow>
						<Button color='secondary' isDisabled={camera.length === 0} isIconOnly size='lg' variant='light'>
							<img className='w-9' src={indiIcon} />
						</Button>
					</Tooltip>
					<Tooltip content='Calculator' placement='bottom' showArrow>
						<Button color='secondary' isIconOnly onPointerUp={calculator.show} size='lg' variant='light'>
							<img className='w-9' src={calculatorIcon} />
						</Button>
					</Tooltip>
					<Tooltip content='Settings' placement='bottom' showArrow>
						<Button color='secondary' isIconOnly size='lg' variant='light'>
							<img className='w-9' src={settingsIcon} />
						</Button>
					</Tooltip>
					<Tooltip content='About' placement='bottom' showArrow>
						<Button color='secondary' isIconOnly onPointerUp={about.show} size='lg' variant='light'>
							<img className='w-9' src={aboutIcon} />
						</Button>
					</Tooltip>
					{selected !== undefined && (
						<div className='col-span-full my-2 flex flex-col items-center justify-center gap-2 flex-wrap'>
							<span className='font-bold text-sm mt-2 uppercase'>{deviceName(selected)}</span>
							{equipment.state[selected].map((device) => (
								<Chip className='min-w-full cursor-pointer' color={device.connected ? 'success' : 'danger'} endContent={<Icons.Cog />} key={device.name} onClose={() => equipment.show(selected, device)} onPointerUp={() => equipment.show(selected, device)} variant='flat'>
									{device.name}
								</Chip>
							))}
						</div>
					)}
				</div>
			</PopoverContent>
		</Popover>
	)
})

function deviceName(type: EquipmentDeviceType) {
	if (type === 'guideOutput') return 'Guide Output'
	else if (type === 'flatPanel') return 'Flat Panel'
	else if (type === 'dewHeater') return 'Dew Heater'
	else if (type === 'wheel') return 'Filter Wheel'
	else return type
}
