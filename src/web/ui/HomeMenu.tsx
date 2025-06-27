import { Button, Chip, Popover, PopoverContent, PopoverTrigger, Tooltip } from '@heroui/react'
import { ScopeProvider, useMolecule } from 'bunshi/react'
import * as Lucide from 'lucide-react'
import { useSnapshot } from 'valtio'
import aboutIcon from '@/assets/about.webp'
import alignmentIcon from '@/assets/alignment.webp'
import autoFocusIcon from '@/assets/auto-focus.webp'
import calculatorIcon from '@/assets/calculator.webp'
import cameraIcon from '@/assets/camera.webp'
import dustCapIcon from '@/assets/dust-cap.webp'
import filterWheelIcon from '@/assets/filter-wheel.webp'
import flatWizardIcon from '@/assets/flat-wizard.webp'
import focuserIcon from '@/assets/focuser.webp'
import framingIcon from '@/assets/framing.webp'
import guideOutputIcon from '@/assets/guide-output.webp'
import guiderIcon from '@/assets/guider.webp'
import heaterIcon from '@/assets/heater.webp'
import indiIcon from '@/assets/indi.webp'
import lightBoxIcon from '@/assets/light-box.webp'
import mountIcon from '@/assets/mount.webp'
import rotatorIcon from '@/assets/rotator.webp'
import sequencerIcon from '@/assets/sequencer.webp'
import settingsIcon from '@/assets/settings.webp'
import skyAtlasIcon from '@/assets/sky-atlas.webp'
import thermometerIcon from '@/assets/thermometer.webp'
import { AboutMolecule } from '@/molecules/about'
import { FramingMolecule } from '@/molecules/framing'
import { HomeMolecule } from '@/molecules/home'
import { CameraScope } from '@/molecules/indi/camera'
import { EquipmentMolecule } from '@/molecules/indi/equipment'
import { ModalScope } from '@/molecules/modal'
import { About } from './About'
import { Camera } from './Camera'
import { Framing } from './Framing'

export type HomeMenuItem = 'camera' | 'mount' | 'filter-wheel' | 'focuser' | 'rotator' | 'light-box' | 'dust-cap' | 'guide-output' | 'dew-heater' | 'thermometer' | 'guider' | 'sky-atlas' | 'framing' | 'aligment' | 'auto-focus' | 'flat-wizard' | 'sequencer' | 'indi' | 'calculator' | 'settings' | 'about'

export function HomeMenu() {
	const home = useMolecule(HomeMolecule)
	const { show, deviceType, devices } = useSnapshot(home.state.menu)

	const equipment = useMolecule(EquipmentMolecule)
	const { CAMERA: cameras, GUIDE_OUTPUT: guideOutputs, THERMOMETER: thermometers } = useSnapshot(equipment.state)

	const framing = useMolecule(FramingMolecule)
	const { showModal: showFramingModal } = useSnapshot(framing.state)

	const about = useMolecule(AboutMolecule)
	const { showModal: showAboutModal } = useSnapshot(about.state)

	return (
		<>
			<Popover isOpen={show} onOpenChange={home.toggleMenu} placement='bottom' showArrow>
				<PopoverTrigger>
					<Button color='secondary' isIconOnly variant='light'>
						<Lucide.Menu />
					</Button>
				</PopoverTrigger>
				<PopoverContent>
					<div className='grid grid-cols-6 gap-2 p-4'>
						<Tooltip content='Camera' placement='bottom' showArrow>
							<Button color='secondary' isDisabled={cameras.length === 0} isIconOnly onPointerUp={() => home.showMenuDevices('CAMERA')} size='lg' variant='light'>
								<img className='w-9' src={cameraIcon} />
							</Button>
						</Tooltip>
						<Tooltip content='Mount' placement='bottom' showArrow>
							<Button color='secondary' isDisabled isIconOnly onPointerUp={() => home.showMenuDevices('MOUNT')} size='lg' variant='light'>
								<img className='w-9' src={mountIcon} />
							</Button>
						</Tooltip>
						<Tooltip content='Filter Wheel' placement='bottom' showArrow>
							<Button color='secondary' isDisabled isIconOnly onPointerUp={() => home.showMenuDevices('WHEEL')} size='lg' variant='light'>
								<img className='w-9' src={filterWheelIcon} />
							</Button>
						</Tooltip>
						<Tooltip content='Focuser' placement='bottom' showArrow>
							<Button color='secondary' isDisabled isIconOnly onPointerUp={() => home.showMenuDevices('FOCUSER')} size='lg' variant='light'>
								<img className='w-9' src={focuserIcon} />
							</Button>
						</Tooltip>
						<Tooltip content='Rotator' placement='bottom' showArrow>
							<Button color='secondary' isDisabled isIconOnly onPointerUp={() => home.showMenuDevices('ROTATOR')} size='lg' variant='light'>
								<img className='w-9' src={rotatorIcon} />
							</Button>
						</Tooltip>
						<Tooltip content='Light Box' placement='bottom' showArrow>
							<Button color='secondary' isDisabled isIconOnly onPointerUp={() => home.showMenuDevices('LIGHT_BOX')} size='lg' variant='light'>
								<img className='w-9' src={lightBoxIcon} />
							</Button>
						</Tooltip>
						<Tooltip content='Dust Cap' placement='bottom' showArrow>
							<Button color='secondary' isDisabled isIconOnly onPointerUp={() => home.showMenuDevices('DUST_CAP')} size='lg' variant='light'>
								<img className='w-9' src={dustCapIcon} />
							</Button>
						</Tooltip>
						<Tooltip content='Guide Output' placement='bottom' showArrow>
							<Button color='secondary' isDisabled={guideOutputs.length === 0} isIconOnly onPointerUp={() => home.showMenuDevices('GUIDE_OUTPUT')} size='lg' variant='light'>
								<img className='w-9' src={guideOutputIcon} />
							</Button>
						</Tooltip>
						<Tooltip content='Dew Heater' placement='bottom' showArrow>
							<Button color='secondary' isDisabled isIconOnly onPointerUp={() => home.showMenuDevices('DEW_HEATER')} size='lg' variant='light'>
								<img className='w-9' src={heaterIcon} />
							</Button>
						</Tooltip>
						<Tooltip content='Thermometer' placement='bottom' showArrow>
							<Button color='secondary' isDisabled={thermometers.length === 0} isIconOnly onPointerUp={() => home.showMenuDevices('THERMOMETER')} size='lg' variant='light'>
								<img className='w-9' src={thermometerIcon} />
							</Button>
						</Tooltip>
						<Tooltip content='Guider' placement='bottom' showArrow>
							<Button color='secondary' isDisabled isIconOnly size='lg' variant='light'>
								<img className='w-9' src={guiderIcon} />
							</Button>
						</Tooltip>
						<Tooltip content='Sky Atlas' placement='bottom' showArrow>
							<Button color='secondary' isIconOnly size='lg' variant='light'>
								<img className='w-9' src={skyAtlasIcon} />
							</Button>
						</Tooltip>
						<Tooltip content='Framing' placement='bottom' showArrow>
							<Button color='secondary' isIconOnly onPointerUp={framing.show} size='lg' variant='light'>
								<img className='w-9' src={framingIcon} />
							</Button>
						</Tooltip>
						<Tooltip content='Aligment' placement='bottom' showArrow>
							<Button color='secondary' isDisabled={cameras.length === 0} isIconOnly size='lg' variant='light'>
								<img className='w-9' src={alignmentIcon} />
							</Button>
						</Tooltip>
						<Tooltip content='Auto Focus' placement='bottom' showArrow>
							<Button color='secondary' isDisabled={cameras.length === 0} isIconOnly size='lg' variant='light'>
								<img className='w-9' src={autoFocusIcon} />
							</Button>
						</Tooltip>
						<Tooltip content='Flat Wizard' placement='bottom' showArrow>
							<Button color='secondary' isDisabled={cameras.length === 0} isIconOnly size='lg' variant='light'>
								<img className='w-9' src={flatWizardIcon} />
							</Button>
						</Tooltip>
						<Tooltip content='Sequencer' placement='bottom' showArrow>
							<Button color='secondary' isDisabled={cameras.length === 0} isIconOnly size='lg' variant='light'>
								<img className='w-9' src={sequencerIcon} />
							</Button>
						</Tooltip>
						<Tooltip content='INDI' placement='bottom' showArrow>
							<Button color='secondary' isDisabled={cameras.length === 0} isIconOnly size='lg' variant='light'>
								<img className='w-9' src={indiIcon} />
							</Button>
						</Tooltip>
						<Tooltip content='Calculator' placement='bottom' showArrow>
							<Button color='secondary' isIconOnly size='lg' variant='light'>
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
						{deviceType !== undefined && (
							<div className='col-span-full my-2 flex flex-col items-center justify-center gap-2 flex-wrap'>
								<span className='font-bold text-sm mt-2'>{deviceType}</span>
								{devices.map((device) => (
									<Chip className='min-w-full cursor-pointer' color={device.connected ? 'success' : 'danger'} endContent={<Lucide.Settings size={20} />} key={device.name} onClose={() => equipment.showModal(deviceType, device)} onPointerUp={() => equipment.showModal(deviceType, device)} variant='flat'>
										{device.name}
									</Chip>
								))}
							</div>
						)}
					</div>
				</PopoverContent>
			</Popover>
			{cameras.map(
				(camera) =>
					camera.show && (
						<ScopeProvider key={camera.name} scope={ModalScope} value={{ name: `camera-${camera.name}` }}>
							<ScopeProvider scope={CameraScope} value={{ camera: camera as never }}>
								<Camera />
							</ScopeProvider>
						</ScopeProvider>
					),
			)}
			{showFramingModal && (
				<ScopeProvider scope={ModalScope} value={{ name: 'framing' }}>
					<Framing />
				</ScopeProvider>
			)}
			{showAboutModal && (
				<ScopeProvider scope={ModalScope} value={{ name: 'about' }}>
					<About />
				</ScopeProvider>
			)}
		</>
	)
}
