import { Chip, Popover, PopoverContent, PopoverTrigger, Tooltip } from '@heroui/react'
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
import { Button } from './components/Button'
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
			<Button children={<img className='w-9' src={cameraIcon} />} color='secondary' disabled={CAMERA.length === 0} onPointerUp={() => equipment.select('CAMERA')} size='md' tooltipContent='Camera' variant='ghost' />
			<Button children={<img className='w-9' src={mountIcon} />} color='secondary' disabled={MOUNT.length === 0} onPointerUp={() => equipment.select('MOUNT')} size='md' tooltipContent='Mount' variant='ghost' />
			<Button children={<img className='w-9' src={filterWheelIcon} />} color='secondary' disabled={WHEEL.length === 0} onPointerUp={() => equipment.select('WHEEL')} size='md' tooltipContent='Filter Wheel' variant='ghost' />
			<Button children={<img className='w-9' src={focuserIcon} />} color='secondary' disabled={FOCUSER.length === 0} onPointerUp={() => equipment.select('FOCUSER')} size='md' tooltipContent='Focuser' variant='ghost' />
			<Button children={<img className='w-9' src={rotatorIcon} />} color='secondary' disabled={ROTATOR.length === 0} onPointerUp={() => equipment.select('ROTATOR')} size='md' tooltipContent='Rotator' variant='ghost' />
			<Button children={<img className='w-9' src={flatPanelIcon} />} color='secondary' disabled={FLAT_PANEL.length === 0} onPointerUp={() => equipment.select('FLAT_PANEL')} size='md' tooltipContent='Flat Panel' variant='ghost' />
			<Button children={<img className='w-9' src={coverIcon} />} color='secondary' disabled={COVER.length === 0} onPointerUp={() => equipment.select('COVER')} size='md' tooltipContent='Cover' variant='ghost' />
			<Button children={<img className='w-9' src={guideOutputIcon} />} color='secondary' disabled={GUIDE_OUTPUT.length === 0} onPointerUp={() => equipment.select('GUIDE_OUTPUT')} size='md' tooltipContent='Guide Output' variant='ghost' />
			<Button children={<img className='w-9' src={heaterIcon} />} color='secondary' disabled={DEW_HEATER.length === 0} onPointerUp={() => equipment.select('DEW_HEATER')} size='md' tooltipContent='Dew Heater' variant='ghost' />
			<Button children={<img className='w-9' src={thermometerIcon} />} color='secondary' disabled={THERMOMETER.length === 0} onPointerUp={() => equipment.select('THERMOMETER')} size='md' tooltipContent='Thermometer' variant='ghost' />
			<Button children={<img className='w-9' src={phd2Icon} />} color='secondary' onPointerUp={phd2.show} size='md' tooltipContent='PHD2' variant='ghost' />
			<Button children={<img className='w-9' src={skyAtlasIcon} />} color='secondary' onPointerUp={skyAtlas.show} size='md' tooltipContent='Sky Atlas' variant='ghost' />
			<Button children={<img className='w-9' src={framingIcon} />} color='secondary' onPointerUp={framing.show} size='md' tooltipContent='Framing' variant='ghost' />
			<Button children={<img className='w-9' src={alignmentIcon} />} color='secondary' disabled={CAMERA.length === 0 || MOUNT.length === 0} onPointerUp={tppa.show} size='md' tooltipContent='TPPA' variant='ghost' />
			<Button children={<img className='w-9' src={alignmentIcon} />} color='secondary' disabled={CAMERA.length === 0 || MOUNT.length === 0} onPointerUp={darv.show} size='md' tooltipContent='DARV' variant='ghost' />
			<Button children={<img className='w-9' src={autoFocusIcon} />} color='secondary' disabled={CAMERA.length === 0 || FOCUSER.length === 0} onPointerUp={autoFocus.show} size='md' tooltipContent='Auto Focus' variant='ghost' />
			<Button children={<img className='w-9' src={flatWizardIcon} />} color='secondary' disabled={CAMERA.length === 0} onPointerUp={flatWizard.show} size='md' tooltipContent='Flat Wizard' variant='ghost' />
			<Button children={<img className='w-9' src={sequencerIcon} />} color='secondary' disabled={CAMERA.length === 0} size='md' tooltipContent='Sequencer' variant='ghost' />
			<IndiPanelControlButton disabled={isIndiDisabled} size='md' />
			<Button children={<img className='w-9' src={alpacaIcon} />} color='secondary' disabled={isIndiDisabled} onPointerUp={alpaca.show} size='md' tooltipContent='ASCOM Alpaca Server' variant='ghost' />
			<Button children={<img className='w-9' src={calculatorIcon} />} color='secondary' onPointerUp={calculator.show} size='md' tooltipContent='Calculator' variant='ghost' />
			<Button children={<img className='w-9' src={settingsIcon} />} color='secondary' size='md' tooltipContent='Settings' variant='ghost' />
			<Button children={<img className='w-9' src={aboutIcon} />} color='secondary' onPointerUp={about.show} size='md' tooltipContent='About' variant='ghost' />
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
