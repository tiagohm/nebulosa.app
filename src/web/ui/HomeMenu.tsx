import { useMolecule } from 'bunshi/react'
import type { Camera, DeviceType, Mount } from 'nebulosa/src/indi.device'
import { memo, useState } from 'react'
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
import skyIcon from '@/assets/sky.webp'
import thermometerIcon from '@/assets/thermometer.webp'
import { AutoFocusMolecule } from '@/molecules/autofocus'
import { FlatWizardMolecule } from '@/molecules/flatwizard'
import { IndiPanelControlMolecule } from '@/molecules/indi/panelcontrol'
import { PHD2Molecule } from '@/molecules/phd2'
import { CameraDeviceContext, MountDeviceContext } from '../shared/context'
import { aboutStore } from '../store/about.store'
import { alpacaStore } from '../store/alpaca.store'
import { atlasStore } from '../store/atlas.store'
import { calculatorStore } from '../store/calculator.store'
import { connectionStore } from '../store/connection.store'
import { equipmentStore } from '../store/equipment.store'
import { framingStore } from '../store/framing.store'
import { homeMenuStore, isDevice } from '../store/home.menu.store'
import { About } from './About'
import { AlpacaServer } from './AlpacaServer'
import { Atlas } from './Atlas'
import { AutoFocus } from './AutoFocus'
import { Calculator } from './Calculator'
import { Button } from './components/Button'
import { Chip, type ChipProps } from './components/Chip'
import { IconButton } from './components/IconButton'
import { Popover } from './components/Popover'
import { Darv } from './Darv'
import { CameraDropdown, MountDropdown } from './DeviceDropdown'
import { FlatWizard } from './FlatWizard'
import { Framing } from './Framing'
import { Icons } from './Icon'
import { IndiPanelControl } from './IndiPanelControl'
import { IndiPanelControlButton } from './IndiPanelControlButton'
import { PHD2 } from './PHD2'
import { Tppa } from './Tppa'

export type HomeMenuItem = 'camera' | 'mount' | 'filter-wheel' | 'focuser' | 'rotator' | 'light-box' | 'dust-cap' | 'guide-output' | 'dew-heater' | 'thermometer' | 'guider' | 'sky-atlas' | 'framing' | 'aligment' | 'auto-focus' | 'flat-wizard' | 'sequencer' | 'indi' | 'calculator' | 'settings' | 'about'

export const HomeMenu = memo(() => {
	const { connected } = useSnapshot(connectionStore.state)

	const { show: showAtlas } = useSnapshot(atlasStore.state)
	const { show: showFraming } = useSnapshot(framingStore.state)

	const autoFocus = useMolecule(AutoFocusMolecule)
	const { show: showAutoFocus } = useSnapshot(autoFocus.state)

	const flatWizard = useMolecule(FlatWizardMolecule)
	const { show: showFlatWizard } = useSnapshot(flatWizard.state)

	const phd2 = useMolecule(PHD2Molecule)
	const { show: showPHD2 } = useSnapshot(phd2.state)

	const indi = useMolecule(IndiPanelControlMolecule)
	const { show: showIndiPanelControl } = useSnapshot(indi.state)

	const { show: showAlpaca } = useSnapshot(alpacaStore.state)
	const { show: showCalculator } = useSnapshot(calculatorStore.state)
	const { show: showAbout } = useSnapshot(aboutStore.state)

	return (
		<>
			<HomeMenuPopover />
			{showAtlas && <Atlas />}
			{showFraming && <Framing />}
			{showAutoFocus && connected && <AutoFocus />}
			{showFlatWizard && connected && <FlatWizard />}
			{showPHD2 && <PHD2 />}
			{showIndiPanelControl && connected && <IndiPanelControl />}
			{showAlpaca && connected && <AlpacaServer />}
			{showAbout && <About />}
			{showCalculator && <Calculator />}
			<TppaList />
			<DarvList />
		</>
	)
})

export const HomeMenuPopover = memo(() => (
	<Popover ref={homeMenuStore.popover} trigger={<IconButton color="secondary" icon={Icons.Menu} tooltipContent="Menu" />}>
		<HomeMenuPopoverContent />
	</Popover>
))

function handleButtonClick(event: React.MouseEvent<HTMLElement>) {
	const key = event.currentTarget.dataset.key

	switch (key) {
		case 'camera':
		case 'mount':
		case 'wheel':
		case 'focuser':
		case 'rotator':
		case 'flatPanel':
		case 'cover':
		case 'guideOutput':
		case 'dewHeater':
		case 'thermometer':
		case 'tppa':
		case 'darv':
		case 'autoFocus':
		case 'flatWizard':
			homeMenuStore.select(key)
			return
		case 'alpaca':
			alpacaStore.show()
			break
		case 'calculator':
			calculatorStore.show()
			break
		case 'about':
			aboutStore.show()
			break
	}

	homeMenuStore.hide()
}

export const HomeMenuPopoverContent = memo(() => {
	const { length: cameraLength } = useSnapshot(equipmentStore.state.camera)
	const { length: mountLength } = useSnapshot(equipmentStore.state.mount)
	const { length: focuserLength } = useSnapshot(equipmentStore.state.focuser)
	const { length: wheelLength } = useSnapshot(equipmentStore.state.wheel)
	const { length: coverLength } = useSnapshot(equipmentStore.state.cover)
	const { length: flatPanelLength } = useSnapshot(equipmentStore.state.flatPanel)
	const { length: guideOutputLength } = useSnapshot(equipmentStore.state.guideOutput)
	const { length: thermometerLength } = useSnapshot(equipmentStore.state.thermometer)
	const { length: dewHeaterLength } = useSnapshot(equipmentStore.state.dewHeater)
	const { length: rotatorLength } = useSnapshot(equipmentStore.state.rotator)

	const phd2 = useMolecule(PHD2Molecule)

	const isIndiDisabled = cameraLength === 0 && mountLength === 0 && focuserLength === 0 && coverLength === 0 && flatPanelLength === 0 && guideOutputLength === 0 && thermometerLength === 0 && dewHeaterLength === 0 && rotatorLength === 0 && wheelLength === 0

	return (
		<div className="home-menu grid grid-cols-6 gap-2 p-4">
			<Button data-key="camera" children={<img className="w-9" src={cameraIcon} />} color="secondary" disabled={cameraLength === 0} onClick={handleButtonClick} size="lg" tooltipContent="Camera" variant="ghost" />
			<Button data-key="mount" children={<img className="w-9" src={mountIcon} />} color="secondary" disabled={mountLength === 0} onClick={handleButtonClick} size="lg" tooltipContent="Mount" variant="ghost" />
			<Button data-key="wheel" children={<img className="w-9" src={filterWheelIcon} />} color="secondary" disabled={wheelLength === 0} onClick={handleButtonClick} size="lg" tooltipContent="Filter Wheel" variant="ghost" />
			<Button data-key="focuser" children={<img className="w-9" src={focuserIcon} />} color="secondary" disabled={focuserLength === 0} onClick={handleButtonClick} size="lg" tooltipContent="Focuser" variant="ghost" />
			<Button data-key="rotator" children={<img className="w-9" src={rotatorIcon} />} color="secondary" disabled={rotatorLength === 0} onClick={handleButtonClick} size="lg" tooltipContent="Rotator" variant="ghost" />
			<Button data-key="flatPanel" children={<img className="w-9" src={flatPanelIcon} />} color="secondary" disabled={flatPanelLength === 0} onClick={handleButtonClick} size="lg" tooltipContent="Flat Panel" variant="ghost" />
			<Button data-key="cover" children={<img className="w-9" src={coverIcon} />} color="secondary" disabled={coverLength === 0} onClick={handleButtonClick} size="lg" tooltipContent="Cover" variant="ghost" />
			<Button data-key="guideOutput" children={<img className="w-9" src={guideOutputIcon} />} color="secondary" disabled={guideOutputLength === 0} onClick={handleButtonClick} size="lg" tooltipContent="Guide Output" variant="ghost" />
			<Button data-key="dewHeater" children={<img className="w-9" src={heaterIcon} />} color="secondary" disabled={dewHeaterLength === 0} onClick={handleButtonClick} size="lg" tooltipContent="Dew Heater" variant="ghost" />
			<Button data-key="thermometer" children={<img className="w-9" src={thermometerIcon} />} color="secondary" disabled={thermometerLength === 0} onClick={handleButtonClick} size="lg" tooltipContent="Thermometer" variant="ghost" />
			<Button data-key="phd2" children={<img className="w-9" src={phd2Icon} />} color="secondary" onClick={phd2.show} size="lg" tooltipContent="PHD2" variant="ghost" />
			<Button data-key="atlas" children={<img className="w-9" src={skyIcon} />} color="secondary" onClick={atlasStore.show} size="lg" tooltipContent="Sky Atlas" variant="ghost" />
			<Button data-key="framing" children={<img className="w-9" src={framingIcon} />} color="secondary" onClick={framingStore.show} size="lg" tooltipContent="Framing" variant="ghost" />
			<Button data-key="tppa" children={<img className="w-9" src={alignmentIcon} />} color="secondary" disabled={cameraLength === 0 || mountLength === 0} onClick={handleButtonClick} size="lg" tooltipContent="TPPA" variant="ghost" />
			<Button data-key="darv" children={<img className="w-9" src={alignmentIcon} />} color="secondary" disabled={cameraLength === 0 || mountLength === 0} onClick={handleButtonClick} size="lg" tooltipContent="DARV" variant="ghost" />
			<Button data-key="autoFocus" children={<img className="w-9" src={autoFocusIcon} />} color="secondary" disabled={cameraLength === 0 || focuserLength === 0} onClick={handleButtonClick} size="lg" tooltipContent="Auto Focus" variant="ghost" />
			<Button data-key="flatWizard" children={<img className="w-9" src={flatWizardIcon} />} color="secondary" disabled={cameraLength === 0} onClick={handleButtonClick} size="lg" tooltipContent="Flat Wizard" variant="ghost" />
			<Button data-key="sequencer" children={<img className="w-9" src={sequencerIcon} />} color="secondary" disabled={cameraLength === 0} size="lg" tooltipContent="Sequencer" variant="ghost" />
			<IndiPanelControlButton disabled={isIndiDisabled} size="lg" />
			<Button data-key="alpaca" children={<img className="w-9" src={alpacaIcon} />} color="secondary" disabled={isIndiDisabled} onClick={handleButtonClick} size="lg" tooltipContent="ASCOM Alpaca Server" variant="ghost" />
			<Button data-key="calculator" children={<img className="w-9" src={calculatorIcon} />} color="secondary" onClick={handleButtonClick} size="lg" tooltipContent="Calculator" variant="ghost" />
			<Button data-key="settings" children={<img className="w-9" src={settingsIcon} />} color="secondary" size="lg" tooltipContent="Settings" variant="ghost" />
			<Button data-key="about" children={<img className="w-9" src={aboutIcon} />} color="secondary" onClick={handleButtonClick} size="lg" tooltipContent="About" variant="ghost" />
			<DeviceList />
			<DarvDeviceChooser />
			<TppaDeviceChooser />
		</div>
	)
})

interface DeviceItemProps extends Omit<ChipProps, 'children'> {
	readonly type: DeviceType
	readonly index: number
}

function DeviceItem({ type, index, ...props }: DeviceItemProps) {
	const { connected, name } = useSnapshot(equipmentStore.state[type][index])
	return <Chip className="min-w-full cursor-pointer" color={connected ? 'success' : 'danger'} label={name} {...props} />
}

const DEVICE_TYPE_LABELS: Partial<Record<DeviceType, string>> = {
	guideOutput: 'Guide Output',
	flatPanel: 'Flat Panel',
	dewHeater: 'Dew Heater',
	wheel: 'Filter Wheel',
}

const DeviceList = memo(() => {
	const { selected } = useSnapshot(homeMenuStore.state)
	const isDeviceSelected = isDevice(selected)
	const { length } = useSnapshot(equipmentStore.state[isDeviceSelected ? selected : 'camera'])

	if (!isDeviceSelected) return null

	function handleClick(id: string) {
		const device = equipmentStore.get(selected as DeviceType, id)
		if (device !== undefined) device.show = true
		homeMenuStore.hide()
	}

	const devices = new Array<React.ReactNode>(length)

	for (let i = 0; i < length; i++) {
		const { id } = equipmentStore.state[selected][i]
		devices[i] = <DeviceItem key={id} type={selected} index={i} onClick={() => handleClick(id)} />
	}

	return (
		<div className="col-span-full my-2 flex flex-col flex-wrap items-center justify-center gap-2">
			<span className="mt-2 text-sm font-bold uppercase">{DEVICE_TYPE_LABELS[selected] ?? selected}</span>
			{length === 0 ? 'No devices' : devices}
		</div>
	)
})

export const TppaDeviceChooser = memo(() => {
	const { selected } = useSnapshot(homeMenuStore.state)
	const [camera, setCamera] = useState<Camera>()
	const [mount, setMount] = useState<Mount>()

	if (selected !== 'tppa') return null

	return (
		<div className="col-span-full flex flex-col items-center gap-2">
			<span className="font-bold">TPPA</span>
			<CameraDropdown showLabel fullWidth value={camera} onValueChange={setCamera} />
			<MountDropdown showLabel fullWidth value={mount} onValueChange={setMount} />
			<Button disabled={!camera || !mount} startContent={<Icons.OpenInNew />} label="Open" onClick={() => equipmentStore.showTppa(camera!, mount!)} />
		</div>
	)
})

export const TppaList = memo(() => {
	const { length } = useSnapshot(equipmentStore.state.tppa)
	const equipment = new Array<React.ReactNode>(length)

	for (let i = 0; i < length; i++) {
		const { show, camera, mount } = equipmentStore.state.tppa[i]
		const key = `${camera.id}.${mount.id}`

		equipment[i] = show && (
			<CameraDeviceContext key={key} value={camera}>
				<MountDeviceContext value={mount}>
					<Tppa />
				</MountDeviceContext>
			</CameraDeviceContext>
		)
	}

	return equipment
})

export const DarvDeviceChooser = memo(() => {
	const { selected } = useSnapshot(homeMenuStore.state)
	const [camera, setCamera] = useState<Camera>()
	const [mount, setMount] = useState<Mount>()

	if (selected !== 'darv') return null

	return (
		<div className="col-span-full flex flex-col items-center gap-2">
			<span className="font-bold">DARV</span>
			<CameraDropdown showLabel fullWidth value={camera} onValueChange={setCamera} />
			<MountDropdown showLabel fullWidth value={mount} onValueChange={setMount} />
			<Button disabled={!camera || !mount} startContent={<Icons.OpenInNew />} label="Open" onClick={() => equipmentStore.showDarv(camera!, mount!)} />
		</div>
	)
})

export const DarvList = memo(() => {
	const { length } = useSnapshot(equipmentStore.state.darv)
	const equipment = new Array<React.ReactNode>(length)

	for (let i = 0; i < length; i++) {
		const { show, camera, mount } = equipmentStore.state.darv[i]
		const key = `${camera.id}.${mount.id}`

		equipment[i] = show && (
			<CameraDeviceContext key={key} value={camera}>
				<MountDeviceContext value={mount}>
					<Darv />
				</MountDeviceContext>
			</CameraDeviceContext>
		)
	}

	return equipment
})
