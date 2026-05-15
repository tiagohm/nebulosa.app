import { useMolecule } from 'bunshi/react'
import type { DeviceType } from 'nebulosa/src/indi.device'
import { memo } from 'react'
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
import { AutoFocusMolecule } from '@/molecules/autofocus'
import { ConnectionMolecule } from '@/molecules/connection'
import { DarvMolecule } from '@/molecules/darv'
import { FlatWizardMolecule } from '@/molecules/flatwizard'
import { FramingMolecule } from '@/molecules/framing'
import { IndiPanelControlMolecule } from '@/molecules/indi/panelcontrol'
import { PHD2Molecule } from '@/molecules/phd2'
import { SkyAtlasMolecule } from '@/molecules/skyatlas'
import { TppaMolecule } from '@/molecules/tppa'
import { about } from '../store/about.store'
import { alpaca } from '../store/alpaca.store'
import { calculator } from '../store/calculator.store'
import { equipment } from '../store/equipment.store'
import { homeMenu } from '../store/home.menu.store'
import { About } from './About'
import { AlpacaServer } from './AlpacaServer'
import { AutoFocus } from './AutoFocus'
import { Calculator } from './Calculator'
import { Button } from './components/Button'
import { Chip, type ChipProps } from './components/Chip'
import { IconButton } from './components/IconButton'
import { Popover } from './components/Popover'
import { Darv } from './Darv'
import { FlatWizard } from './FlatWizard'
import { Framing } from './Framing'
import { Icons } from './Icon'
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

	const { show: showAlpaca } = useSnapshot(alpaca.state)
	const { show: showCalculator } = useSnapshot(calculator.state)
	const { show: showAbout } = useSnapshot(about.state)

	return (
		<>
			<HomeMenuPopover />
			{showSkyAtlas && <SkyAtlas />}
			{showFraming && <Framing />}
			{showTPPA && connected && <Tppa />}
			{showDARV && connected && <Darv />}
			{showAutoFocus && connected && <AutoFocus />}
			{showFlatWizard && connected && <FlatWizard />}
			{showPHD2 && <PHD2 />}
			{showIndiPanelControl && connected && <IndiPanelControl />}
			{showAlpaca && connected && <AlpacaServer />}
			{showAbout && <About />}
			{showCalculator && <Calculator />}
		</>
	)
})

export const HomeMenuPopover = memo(() => (
	<Popover ref={homeMenu.popover} trigger={<IconButton color="secondary" icon={Icons.Menu} tooltipContent="Menu" />}>
		<HomeMenuPopoverContent />
	</Popover>
))

function handleButtonClick(event: React.MouseEvent<HTMLElement>) {
	const key = event.currentTarget.dataset.key

	switch (key) {
		case 'CAMERA':
		case 'MOUNT':
		case 'WHEEL':
		case 'FOCUSER':
		case 'ROTATOR':
		case 'FLAT_PANEL':
		case 'COVER':
		case 'GUIDE_OUTPUT':
		case 'DEW_HEATER':
		case 'THERMOMETER':
			homeMenu.select(key)
			return
		case 'ALPACA':
			alpaca.show()
			break
		case 'CALCULATOR':
			calculator.show()
			break
		case 'ABOUT':
			about.show()
			break
	}

	homeMenu.hide()
}

export const HomeMenuPopoverContent = memo(() => {
	const { length: cameraLength } = useSnapshot(equipment.state.CAMERA)
	const { length: mountLength } = useSnapshot(equipment.state.MOUNT)
	const { length: focuserLength } = useSnapshot(equipment.state.FOCUSER)
	const { length: wheelLength } = useSnapshot(equipment.state.WHEEL)
	const { length: coverLength } = useSnapshot(equipment.state.COVER)
	const { length: flatPanelLength } = useSnapshot(equipment.state.FLAT_PANEL)
	const { length: guideOutputLength } = useSnapshot(equipment.state.GUIDE_OUTPUT)
	const { length: thermometerLength } = useSnapshot(equipment.state.THERMOMETER)
	const { length: dewHeaterLength } = useSnapshot(equipment.state.DEW_HEATER)
	const { length: rotatorLength } = useSnapshot(equipment.state.ROTATOR)

	const skyAtlas = useMolecule(SkyAtlasMolecule)
	const framing = useMolecule(FramingMolecule)
	const tppa = useMolecule(TppaMolecule)
	const darv = useMolecule(DarvMolecule)
	const autoFocus = useMolecule(AutoFocusMolecule)
	const flatWizard = useMolecule(FlatWizardMolecule)
	const phd2 = useMolecule(PHD2Molecule)

	const isIndiDisabled = cameraLength === 0 && mountLength === 0 && focuserLength === 0 && coverLength === 0 && flatPanelLength === 0 && guideOutputLength === 0 && thermometerLength === 0 && dewHeaterLength === 0 && rotatorLength === 0 && wheelLength === 0

	return (
		<div className="home-menu grid grid-cols-6 gap-2 p-4">
			<Button data-key="CAMERA" children={<img className="w-9" src={cameraIcon} />} color="secondary" disabled={cameraLength === 0} onClick={handleButtonClick} size="lg" tooltipContent="Camera" variant="ghost" />
			<Button data-key="MOUNT" children={<img className="w-9" src={mountIcon} />} color="secondary" disabled={mountLength === 0} onClick={handleButtonClick} size="lg" tooltipContent="Mount" variant="ghost" />
			<Button data-key="WHEEL" children={<img className="w-9" src={filterWheelIcon} />} color="secondary" disabled={wheelLength === 0} onClick={handleButtonClick} size="lg" tooltipContent="Filter Wheel" variant="ghost" />
			<Button data-key="FOCUSER" children={<img className="w-9" src={focuserIcon} />} color="secondary" disabled={focuserLength === 0} onClick={handleButtonClick} size="lg" tooltipContent="Focuser" variant="ghost" />
			<Button data-key="ROTATOR" children={<img className="w-9" src={rotatorIcon} />} color="secondary" disabled={rotatorLength === 0} onClick={handleButtonClick} size="lg" tooltipContent="Rotator" variant="ghost" />
			<Button data-key="FLAT_PANEL" children={<img className="w-9" src={flatPanelIcon} />} color="secondary" disabled={flatPanelLength === 0} onClick={handleButtonClick} size="lg" tooltipContent="Flat Panel" variant="ghost" />
			<Button data-key="COVER" children={<img className="w-9" src={coverIcon} />} color="secondary" disabled={coverLength === 0} onClick={handleButtonClick} size="lg" tooltipContent="Cover" variant="ghost" />
			<Button data-key="GUIDE_OUTPUT" children={<img className="w-9" src={guideOutputIcon} />} color="secondary" disabled={guideOutputLength === 0} onClick={handleButtonClick} size="lg" tooltipContent="Guide Output" variant="ghost" />
			<Button data-key="DEW_HEATER" children={<img className="w-9" src={heaterIcon} />} color="secondary" disabled={dewHeaterLength === 0} onClick={handleButtonClick} size="lg" tooltipContent="Dew Heater" variant="ghost" />
			<Button data-key="THERMOMETER" children={<img className="w-9" src={thermometerIcon} />} color="secondary" disabled={thermometerLength === 0} onClick={handleButtonClick} size="lg" tooltipContent="Thermometer" variant="ghost" />
			<Button data-key="PHD2" children={<img className="w-9" src={phd2Icon} />} color="secondary" onClick={phd2.show} size="lg" tooltipContent="PHD2" variant="ghost" />
			<Button data-key="ATLAS" children={<img className="w-9" src={skyAtlasIcon} />} color="secondary" onClick={skyAtlas.show} size="lg" tooltipContent="Sky Atlas" variant="ghost" />
			<Button data-key="FRAMING" children={<img className="w-9" src={framingIcon} />} color="secondary" onClick={framing.show} size="lg" tooltipContent="Framing" variant="ghost" />
			<Button data-key="TPPA" children={<img className="w-9" src={alignmentIcon} />} color="secondary" disabled={cameraLength === 0 || mountLength === 0} onClick={tppa.show} size="lg" tooltipContent="TPPA" variant="ghost" />
			<Button data-key="DARV" children={<img className="w-9" src={alignmentIcon} />} color="secondary" disabled={cameraLength === 0 || mountLength === 0} onClick={darv.show} size="lg" tooltipContent="DARV" variant="ghost" />
			<Button data-key="AUTO_FOCUS" children={<img className="w-9" src={autoFocusIcon} />} color="secondary" disabled={cameraLength === 0 || focuserLength === 0} onClick={autoFocus.show} size="lg" tooltipContent="Auto Focus" variant="ghost" />
			<Button data-key="FLAT_WIZARD" children={<img className="w-9" src={flatWizardIcon} />} color="secondary" disabled={cameraLength === 0} onClick={flatWizard.show} size="lg" tooltipContent="Flat Wizard" variant="ghost" />
			<Button data-key="SEQUENCER" children={<img className="w-9" src={sequencerIcon} />} color="secondary" disabled={cameraLength === 0} size="lg" tooltipContent="Sequencer" variant="ghost" />
			<IndiPanelControlButton disabled={isIndiDisabled} size="lg" />
			<Button data-key="ALPACA" children={<img className="w-9" src={alpacaIcon} />} color="secondary" disabled={isIndiDisabled} onClick={handleButtonClick} size="lg" tooltipContent="ASCOM Alpaca Server" variant="ghost" />
			<Button data-key="CALCULATOR" children={<img className="w-9" src={calculatorIcon} />} color="secondary" onClick={handleButtonClick} size="lg" tooltipContent="Calculator" variant="ghost" />
			<Button data-key="SETTINGS" children={<img className="w-9" src={settingsIcon} />} color="secondary" size="lg" tooltipContent="Settings" variant="ghost" />
			<Button data-key="ABOUT" children={<img className="w-9" src={aboutIcon} />} color="secondary" onClick={handleButtonClick} size="lg" tooltipContent="About" variant="ghost" />
			<Devices />
		</div>
	)
})

interface DeviceChipProps extends Omit<ChipProps, 'children'> {
	readonly type: DeviceType
	readonly index: number
}

function DeviceChip({ type, index, ...props }: DeviceChipProps) {
	const { connected, name } = useSnapshot(equipment.state[type][index])
	return <Chip className="min-w-full cursor-pointer" color={connected ? 'success' : 'danger'} label={name} {...props} />
}

const Devices = memo(() => {
	const { selected } = useSnapshot(homeMenu.state)
	const { length } = useSnapshot(equipment.state[selected])

	function handleClick(id: string) {
		const device = equipment.get(selected, id)
		if (device !== undefined) device.show = true
		homeMenu.hide()
	}

	const devices = new Array<React.ReactNode>(length)

	for (let i = 0; i < length; i++) {
		const { id } = equipment.state[selected][i]
		devices[i] = <DeviceChip key={id} type={selected} index={i} onClick={() => handleClick(id)} />
	}

	return (
		<div className="col-span-full my-2 flex flex-col flex-wrap items-center justify-center gap-2">
			<span className="mt-2 text-sm font-bold uppercase">{deviceName(selected)}</span>
			{length === 0 ? 'No devices' : devices}
		</div>
	)
})

const DEVICE_NAMES: Partial<Record<DeviceType, string>> = {
	GUIDE_OUTPUT: 'Guide Output',
	FLAT_PANEL: 'Flat Panel',
	DEW_HEATER: 'Dew Heater',
	WHEEL: 'Filter Wheel',
}

function deviceName(type: DeviceType) {
	return DEVICE_NAMES[type] ?? type
}
