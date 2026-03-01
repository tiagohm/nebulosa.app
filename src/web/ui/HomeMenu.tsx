import { Button, Chip, Popover, PopoverContent, PopoverTrigger, Tooltip } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import type { DeviceType } from 'nebulosa/src/indi.device'
import { Activity, memo } from 'react'
import { useSnapshot } from 'valtio'
import aboutIcon from '@/assets/about.webp'
import alignmentIcon from '@/assets/alignment.webp'
import alpacaIcon from '@/assets/alpaca.webp'
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
import heaterIcon from '@/assets/heater.webp'
import mountIcon from '@/assets/mount.webp'
import phd2Icon from '@/assets/phd2.webp'
import rotatorIcon from '@/assets/rotator.webp'
import sequencerIcon from '@/assets/sequencer.webp'
import settingsIcon from '@/assets/settings.webp'
import skyAtlasIcon from '@/assets/sky-atlas.webp'
import thermometerIcon from '@/assets/thermometer.webp'
import { AboutMolecule } from '@/molecules/about'
import { AlpacaMolecule } from '@/molecules/alpaca'
import { AutoFocusMolecule } from '@/molecules/autofocus'
import { CalculatorMolecule } from '@/molecules/calculator'
import { ConnectionMolecule } from '@/molecules/connection'
import { DarvMolecule } from '@/molecules/darv'
import { FlatWizardMolecule } from '@/molecules/flatwizard'
import { FramingMolecule } from '@/molecules/framing'
import { HomeMolecule } from '@/molecules/home'
import { EquipmentMolecule } from '@/molecules/indi/equipment'
import { IndiPanelControlMolecule } from '@/molecules/indi/panelcontrol'
import { PHD2Molecule } from '@/molecules/phd2'
import { SkyAtlasMolecule } from '@/molecules/skyatlas'
import { TppaMolecule } from '@/molecules/tppa'
import { DEFAULT_POPOVER_PROPS } from '@/shared/constants'
import { About } from './About'
import { AlpacaServer } from './AlpacaServer'
import { AutoFocus } from './AutoFocus'
import { Calculator } from './Calculator'
import { Darv } from './Darv'
import { FlatWizard } from './FlatWizard'
import { Framing } from './Framing'
import { Icons } from './Icon'
import { IconButton } from './IconButton'
import { IndiPanelControl } from './IndiPanelControl'
import { IndiPanelControlButton } from './IndiPanelControlButton'
import { PHD2 } from './PHD2'
import { SkyAtlas } from './SkyAtlas'
import { Tppa } from './Tppa'

export type HomeMenuItem = 'camera' | 'mount' | 'filter-wheel' | 'focuser' | 'rotator' | 'light-box' | 'dust-cap' | 'guide-output' | 'dew-heater' | 'thermometer' | 'guider' | 'sky-atlas' | 'framing' | 'aligment' | 'auto-focus' | 'flat-wizard' | 'sequencer' | 'indi' | 'calculator' | 'settings' | 'about'

export const HomeMenu = memo(() => {
	const connection = useMolecule(ConnectionMolecule)
	const { connected } = useSnapshot(connection.state)

	const atlas = useMolecule(SkyAtlasMolecule)
	const { show: showSkyAtlas } = useSnapshot(atlas.state)

	const framing = useMolecule(FramingMolecule)
	const { show: showFraming } = useSnapshot(framing.state)

	const tppa = useMolecule(TppaMolecule)
	const { show: showTPPA } = useSnapshot(tppa.state)

	const darv = useMolecule(DarvMolecule)
	const { show: showDARV } = useSnapshot(darv.state)

	const autoFocus = useMolecule(AutoFocusMolecule)
	const { show: showAutoFocus } = useSnapshot(autoFocus.state)

	const flatWizard = useMolecule(FlatWizardMolecule)
	const { show: showFlatWizard } = useSnapshot(flatWizard.state)

	const phd2 = useMolecule(PHD2Molecule)
	const { show: showPHD2 } = useSnapshot(phd2.state)

	const indi = useMolecule(IndiPanelControlMolecule)
	const { show: showIndiPanelControl } = useSnapshot(indi.state)

	const alpaca = useMolecule(AlpacaMolecule)
	const { show: showAlpaca } = useSnapshot(alpaca.state)

	const calculator = useMolecule(CalculatorMolecule)
	const { show: showCalculator } = useSnapshot(calculator.state)

	const about = useMolecule(AboutMolecule)
	const { show: showAbout } = useSnapshot(about.state)

	return (
		<>
			<HomeMenuPopover />
			<Activity mode={showSkyAtlas ? 'visible' : 'hidden'}>
				<SkyAtlas />
			</Activity>
			<Activity mode={showFraming ? 'visible' : 'hidden'}>
				<Framing />
			</Activity>
			<Activity mode={showTPPA && connected ? 'visible' : 'hidden'}>
				<Tppa />
			</Activity>
			<Activity mode={showDARV && connected ? 'visible' : 'hidden'}>
				<Darv />
			</Activity>
			<Activity mode={showAutoFocus && connected ? 'visible' : 'hidden'}>
				<AutoFocus />
			</Activity>
			<Activity mode={showFlatWizard && connected ? 'visible' : 'hidden'}>
				<FlatWizard />
			</Activity>
			<Activity mode={showPHD2 ? 'visible' : 'hidden'}>
				<PHD2 />
			</Activity>
			<Activity mode={showIndiPanelControl && connected ? 'visible' : 'hidden'}>
				<IndiPanelControl />
			</Activity>
			<Activity mode={showAlpaca && connected ? 'visible' : 'hidden'}>
				<AlpacaServer />
			</Activity>
			<Activity mode={showAbout ? 'visible' : 'hidden'}>
				<About />
			</Activity>
			<Activity mode={showCalculator ? 'visible' : 'hidden'}>
				<Calculator />
			</Activity>
		</>
	)
})

export const HomeMenuPopover = memo(() => {
	const home = useMolecule(HomeMolecule)
	const { show } = useSnapshot(home.state.menu)

	return (
		<Popover isOpen={show} onOpenChange={home.toggleMenu} {...DEFAULT_POPOVER_PROPS}>
			<Tooltip content='Menu' placement='bottom' showArrow>
				<div className='max-w-fit'>
					<PopoverTrigger>
						<IconButton color='secondary' icon={Icons.Menu} />
					</PopoverTrigger>
				</div>
			</Tooltip>
			<PopoverContent>
				<HomeMenuPopoverContent />
			</PopoverContent>
		</Popover>
	)
})

export const HomeMenuPopoverContent = memo(() => {
	const equipment = useMolecule(EquipmentMolecule)
	const { CAMERA, MOUNT, FOCUSER, WHEEL, COVER, FLAT_PANEL, GUIDE_OUTPUT, THERMOMETER, DEW_HEATER, ROTATOR } = useSnapshot(equipment.state)

	const skyAtlas = useMolecule(SkyAtlasMolecule)
	const framing = useMolecule(FramingMolecule)
	const tppa = useMolecule(TppaMolecule)
	const darv = useMolecule(DarvMolecule)
	const autoFocus = useMolecule(AutoFocusMolecule)
	const flatWizard = useMolecule(FlatWizardMolecule)
	const phd2 = useMolecule(PHD2Molecule)
	const alpaca = useMolecule(AlpacaMolecule)
	const calculator = useMolecule(CalculatorMolecule)
	const about = useMolecule(AboutMolecule)

	const isIndiDisabled = !CAMERA.length && !MOUNT.length && !FOCUSER.length && !COVER.length && !FLAT_PANEL.length && !GUIDE_OUTPUT.length && !THERMOMETER.length && !DEW_HEATER.length && !ROTATOR.length

	return (
		<div className='home-menu grid grid-cols-6 gap-2 p-4'>
			<Tooltip content='Camera' placement='bottom' showArrow>
				<Button color='secondary' isDisabled={CAMERA.length === 0} isIconOnly onPointerUp={() => equipment.select('CAMERA')} size='lg' variant='light'>
					<img className='w-9' src={cameraIcon} />
				</Button>
			</Tooltip>
			<Tooltip content='Mount' placement='bottom' showArrow>
				<Button color='secondary' isDisabled={MOUNT.length === 0} isIconOnly onPointerUp={() => equipment.select('MOUNT')} size='lg' variant='light'>
					<img className='w-9' src={mountIcon} />
				</Button>
			</Tooltip>
			<Tooltip content='Filter Wheel' placement='bottom' showArrow>
				<Button color='secondary' isDisabled={WHEEL.length === 0} isIconOnly onPointerUp={() => equipment.select('WHEEL')} size='lg' variant='light'>
					<img className='w-9' src={filterWheelIcon} />
				</Button>
			</Tooltip>
			<Tooltip content='Focuser' placement='bottom' showArrow>
				<Button color='secondary' isDisabled={FOCUSER.length === 0} isIconOnly onPointerUp={() => equipment.select('FOCUSER')} size='lg' variant='light'>
					<img className='w-9' src={focuserIcon} />
				</Button>
			</Tooltip>
			<Tooltip content='Rotator' placement='bottom' showArrow>
				<Button color='secondary' isDisabled={ROTATOR.length === 0} isIconOnly onPointerUp={() => equipment.select('ROTATOR')} size='lg' variant='light'>
					<img className='w-9' src={rotatorIcon} />
				</Button>
			</Tooltip>
			<Tooltip content='Flat Panel' placement='bottom' showArrow>
				<Button color='secondary' isDisabled={FLAT_PANEL.length === 0} isIconOnly onPointerUp={() => equipment.select('FLAT_PANEL')} size='lg' variant='light'>
					<img className='w-9' src={flatPanelIcon} />
				</Button>
			</Tooltip>
			<Tooltip content='Cover' placement='bottom' showArrow>
				<Button color='secondary' isDisabled={COVER.length === 0} isIconOnly onPointerUp={() => equipment.select('COVER')} size='lg' variant='light'>
					<img className='w-9' src={coverIcon} />
				</Button>
			</Tooltip>
			<Tooltip content='Guide Output' placement='bottom' showArrow>
				<Button color='secondary' isDisabled={GUIDE_OUTPUT.length === 0} isIconOnly onPointerUp={() => equipment.select('GUIDE_OUTPUT')} size='lg' variant='light'>
					<img className='w-9' src={guideOutputIcon} />
				</Button>
			</Tooltip>
			<Tooltip content='Dew Heater' placement='bottom' showArrow>
				<Button color='secondary' isDisabled={DEW_HEATER.length === 0} isIconOnly onPointerUp={() => equipment.select('DEW_HEATER')} size='lg' variant='light'>
					<img className='w-9' src={heaterIcon} />
				</Button>
			</Tooltip>
			<Tooltip content='Thermometer' placement='bottom' showArrow>
				<Button color='secondary' isDisabled={THERMOMETER.length === 0} isIconOnly onPointerUp={() => equipment.select('THERMOMETER')} size='lg' variant='light'>
					<img className='w-9' src={thermometerIcon} />
				</Button>
			</Tooltip>
			<Tooltip content='PHD2' placement='bottom' showArrow>
				<Button color='secondary' isIconOnly onPointerUp={phd2.show} size='lg' variant='light'>
					<img className='w-9' src={phd2Icon} />
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
			<Tooltip content='TPPA' placement='bottom' showArrow>
				<Button color='secondary' isDisabled={CAMERA.length === 0 || MOUNT.length === 0} isIconOnly onPointerUp={tppa.show} size='lg' variant='light'>
					<img className='w-9' src={alignmentIcon} />
				</Button>
			</Tooltip>
			<Tooltip content='DARV' placement='bottom' showArrow>
				<Button color='secondary' isDisabled={CAMERA.length === 0 || MOUNT.length === 0} isIconOnly onPointerUp={darv.show} size='lg' variant='light'>
					<img className='w-9' src={alignmentIcon} />
				</Button>
			</Tooltip>
			<Tooltip content='Auto Focus' placement='bottom' showArrow>
				<Button color='secondary' isDisabled={CAMERA.length === 0 || FOCUSER.length === 0} isIconOnly onPointerUp={autoFocus.show} size='lg' variant='light'>
					<img className='w-9' src={autoFocusIcon} />
				</Button>
			</Tooltip>
			<Tooltip content='Flat Wizard' placement='bottom' showArrow>
				<Button color='secondary' isDisabled={CAMERA.length === 0} isIconOnly onPointerUp={flatWizard.show} size='lg' variant='light'>
					<img className='w-9' src={flatWizardIcon} />
				</Button>
			</Tooltip>
			<Tooltip content='Sequencer' placement='bottom' showArrow>
				<Button color='secondary' isDisabled={CAMERA.length === 0} isIconOnly size='lg' variant='light'>
					<img className='w-9' src={sequencerIcon} />
				</Button>
			</Tooltip>
			<IndiPanelControlButton isDisabled={isIndiDisabled} size='lg' />
			<Tooltip content='ASCOM Alpaca Server' placement='bottom' showArrow>
				<Button color='secondary' isDisabled={isIndiDisabled} isIconOnly onPointerUp={alpaca.show} size='lg' variant='light'>
					<img className='w-9' src={alpacaIcon} />
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
			<Devices />
		</div>
	)
})

const Devices = memo(() => {
	const equipment = useMolecule(EquipmentMolecule)
	const { selected } = useSnapshot(equipment.state)

	if (!selected) return null

	return (
		<div className='col-span-full my-2 flex flex-col items-center justify-center gap-2 flex-wrap'>
			<span className='font-bold text-sm mt-2 uppercase'>{deviceName(selected)}</span>
			{equipment.state[selected].map((device) => (
				<Chip className='min-w-full cursor-pointer' color={device.connected ? 'success' : 'danger'} key={device.name} onPointerUp={() => equipment.show(device, selected)} variant='flat'>
					{device.name}
				</Chip>
			))}
		</div>
	)
})

function deviceName(type: DeviceType) {
	if (type === 'GUIDE_OUTPUT') return 'Guide Output'
	else if (type === 'FLAT_PANEL') return 'Flat Panel'
	else if (type === 'DEW_HEATER') return 'Dew Heater'
	else if (type === 'WHEEL') return 'Filter Wheel'
	else return type
}
