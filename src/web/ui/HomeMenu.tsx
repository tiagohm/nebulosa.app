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
import skyIcon from '@/assets/sky.webp'
import thermometerIcon from '@/assets/thermometer.webp'
import { aboutStore } from '@/stores/about.store'
import { alpacaStore } from '@/stores/alpaca.store'
import { atlasStore } from '@/stores/atlas.store'
import { autoFocusListStore } from '@/stores/autofocus.list.store'
import { calculatorStore } from '@/stores/calculator.store'
import { darvListStore } from '@/stores/darv.list.store'
import { equipmentStore } from '@/stores/equipment.store'
import { flatWizardListStore } from '@/stores/flatwizard.list.store'
import { framingStore } from '@/stores/framing.store'
import { homeMenuStore, isDevice } from '@/stores/home.menu.store'
import { phd2Store } from '@/stores/phd2.store'
import { tppaListStore } from '@/stores/tppa.list.store'
import { CameraDeviceContext, FocuserDeviceContext, MountDeviceContext } from '../shared/context'
import { About } from './About'
import { AlpacaServer } from './AlpacaServer'
import { Atlas } from './Atlas'
import { AutoFocus } from './AutoFocus'
import { Calculator } from './Calculator'
import { Button } from './components/Button'
import { IconButton } from './components/IconButton'
import { List, ListItem, type ListItemProps } from './components/List'
import { Popover } from './components/Popover'
import { ConnectButton } from './ConnectButton'
import { Darv } from './Darv'
import { CameraDropdown, FocuserDropdown, MountDropdown } from './DeviceDropdown'
import { FlatWizard } from './FlatWizard'
import { Framing } from './Framing'
import { Icons } from './Icon'
import { IndiPanelControlButton } from './IndiPanelControlButton'
import { PHD2 } from './PHD2'
import { Tppa } from './Tppa'

export type HomeMenuItem = 'camera' | 'mount' | 'filter-wheel' | 'focuser' | 'rotator' | 'light-box' | 'dust-cap' | 'guide-output' | 'dew-heater' | 'thermometer' | 'guider' | 'sky-atlas' | 'framing' | 'aligment' | 'auto-focus' | 'flat-wizard' | 'sequencer' | 'indi' | 'calculator' | 'settings' | 'about'

export const HomeMenu = memo(() => (
	<>
		<HomeMenuPopover />
		<Atlas />
		<Framing />
		<PHD2 />
		<AlpacaServer />
		<About />
		<Calculator />
		<TppaList />
		<DarvList />
		<AutoFocusList />
		<FlatWizardList />
	</>
))

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
			<Button data-key="phd2" children={<img className="w-9" src={phd2Icon} />} color="secondary" onClick={phd2Store.show} size="lg" tooltipContent="PHD2" variant="ghost" />
			<Button data-key="atlas" children={<img className="w-9" src={skyIcon} />} color="secondary" onClick={atlasStore.show} size="lg" tooltipContent="Sky Atlas" variant="ghost" />
			<Button data-key="framing" children={<img className="w-9" src={framingIcon} />} color="secondary" onClick={framingStore.show} size="lg" tooltipContent="Framing" variant="ghost" />
			<Button data-key="tppa" children={<img className="w-9" src={alignmentIcon} />} color="secondary" disabled={cameraLength === 0 || mountLength === 0} onClick={handleButtonClick} size="lg" tooltipContent="TPPA" variant="ghost" />
			<Button data-key="darv" children={<img className="w-9" src={alignmentIcon} />} color="secondary" disabled={cameraLength === 0 || mountLength === 0} onClick={handleButtonClick} size="lg" tooltipContent="DARV" variant="ghost" />
			<Button data-key="autoFocus" children={<img className="w-9" src={autoFocusIcon} />} color="secondary" disabled={cameraLength === 0 || focuserLength === 0} onClick={handleButtonClick} size="lg" tooltipContent="Auto Focus" variant="ghost" />
			<Button data-key="flatWizard" children={<img className="w-9" src={flatWizardIcon} />} color="secondary" disabled={cameraLength === 0} onClick={handleButtonClick} size="lg" tooltipContent="Flat Wizard" variant="ghost" />
			<Button data-key="sequencer" children={<img className="w-9" src={sequencerIcon} />} color="secondary" disabled={cameraLength === 0} size="lg" tooltipContent="Sequencer" variant="ghost" />
			<Button data-key="alpaca" children={<img className="w-9" src={alpacaIcon} />} color="secondary" disabled={isIndiDisabled} onClick={handleButtonClick} size="lg" tooltipContent="ASCOM Alpaca Server" variant="ghost" />
			<Button data-key="calculator" children={<img className="w-9" src={calculatorIcon} />} color="secondary" onClick={handleButtonClick} size="lg" tooltipContent="Calculator" variant="ghost" />
			<Button data-key="settings" children={<img className="w-9" src={settingsIcon} />} color="secondary" size="lg" tooltipContent="Settings" variant="ghost" />
			<Button data-key="about" children={<img className="w-9" src={aboutIcon} />} color="secondary" onClick={handleButtonClick} size="lg" tooltipContent="About" variant="ghost" />
			<DeviceList />
			<DarvDeviceDropdown />
			<TppaDeviceDropdown />
			<AutoFocusDeviceDropdown />
			<FlatWizardDeviceDropdown />
		</div>
	)
})

interface DeviceItemProps extends Omit<ListItemProps, 'children'> {
	readonly type: DeviceType
	readonly index: number
}

function DeviceItem({ type, index, ...props }: DeviceItemProps) {
	const device = equipmentStore.state[type][index]
	const { connected, name } = useSnapshot(device)

	const EndContent = (
		<div className="flex flex-row items-center justify-center gap-1">
			<ConnectButton connected={connected} onClick={() => equipmentStore.connect(device)} size="sm" />
			<IndiPanelControlButton device={device} size="sm" />
		</div>
	)

	return <ListItem endContent={EndContent} startContent={<Icons.Circle className="size-[0.8em]" color={connected ? 'var(--success)' : 'var(--danger)'} />} className="min-w-full cursor-pointer" label={name} {...props} />
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

	const devices = equipmentStore.state[selected]

	function handleAction(index: number) {
		devices[index].show = true
	}

	return (
		<div className="col-span-full my-2 flex flex-col flex-wrap items-center justify-center gap-2">
			<span className="mt-2 text-sm font-bold uppercase">{DEVICE_TYPE_LABELS[selected] ?? selected}</span>
			<List fullWidth itemCount={length} itemHeight={36} onAction={handleAction}>
				{(i) => <DeviceItem key={devices[i].id} type={selected} index={i} />}
			</List>
		</div>
	)
})

export const TppaDeviceDropdown = memo(() => {
	const { selected } = useSnapshot(homeMenuStore.state)
	const { camera, mount } = useSnapshot(tppaListStore.state)

	if (selected !== 'tppa') return null

	return (
		<div className="col-span-full flex flex-col items-center gap-2">
			<span className="font-bold">TPPA</span>
			<CameraDropdown showLabel fullWidth value={camera} onValueChange={tppaListStore.setCamera} />
			<MountDropdown showLabel fullWidth value={mount} onValueChange={tppaListStore.setMount} />
			<Button fullWidth disabled={!camera || !mount} startContent={<Icons.OpenInNew />} label="Open" onClick={tppaListStore.show} />
		</div>
	)
})

export const TppaList = memo(() => {
	const { length } = useSnapshot(tppaListStore.state.list)
	const list = new Array<React.ReactNode>(length)

	for (let i = 0; i < length; i++) {
		const { show, camera, mount } = tppaListStore.state.list[i]
		const key = `${camera.id}.${mount.id}`

		list[i] = show && (
			<CameraDeviceContext key={key} value={camera}>
				<MountDeviceContext value={mount}>
					<Tppa key={key} />
				</MountDeviceContext>
			</CameraDeviceContext>
		)
	}

	return list
})

export const DarvDeviceDropdown = memo(() => {
	const { selected } = useSnapshot(homeMenuStore.state)
	const { camera, mount } = useSnapshot(darvListStore.state)

	if (selected !== 'darv') return null

	return (
		<div className="col-span-full flex flex-col items-center gap-2">
			<span className="font-bold">DARV</span>
			<CameraDropdown showLabel fullWidth value={camera} onValueChange={darvListStore.setCamera} />
			<MountDropdown showLabel fullWidth value={mount} onValueChange={darvListStore.setMount} />
			<Button fullWidth disabled={!camera || !mount} startContent={<Icons.OpenInNew />} label="Open" onClick={darvListStore.show} />
		</div>
	)
})

export const DarvList = memo(() => {
	const { length } = useSnapshot(darvListStore.state.list)
	const list = new Array<React.ReactNode>(length)

	for (let i = 0; i < length; i++) {
		const { show, camera, mount } = darvListStore.state.list[i]
		const key = `${camera.id}.${mount.id}`

		list[i] = show && (
			<CameraDeviceContext key={key} value={camera}>
				<MountDeviceContext value={mount}>
					<Darv key={key} />
				</MountDeviceContext>
			</CameraDeviceContext>
		)
	}

	return list
})

export const AutoFocusDeviceDropdown = memo(() => {
	const { selected } = useSnapshot(homeMenuStore.state)
	const { camera, focuser } = useSnapshot(autoFocusListStore.state)

	if (selected !== 'autoFocus') return null

	return (
		<div className="col-span-full flex flex-col items-center gap-2">
			<span className="font-bold">Auto Focus</span>
			<CameraDropdown showLabel fullWidth value={camera} onValueChange={autoFocusListStore.setCamera} />
			<FocuserDropdown showLabel fullWidth value={focuser} onValueChange={autoFocusListStore.setFocuser} />
			<Button fullWidth disabled={!camera || !focuser} startContent={<Icons.OpenInNew />} label="Open" onClick={autoFocusListStore.show} />
		</div>
	)
})

export const AutoFocusList = memo(() => {
	const { length } = useSnapshot(autoFocusListStore.state.list)
	const list = new Array<React.ReactNode>(length)

	for (let i = 0; i < length; i++) {
		const { show, camera, focuser } = autoFocusListStore.state.list[i]
		const key = `${camera.id}.${focuser.id}`

		list[i] = show && (
			<CameraDeviceContext key={key} value={camera}>
				<FocuserDeviceContext value={focuser}>
					<AutoFocus key={key} />
				</FocuserDeviceContext>
			</CameraDeviceContext>
		)
	}

	return list
})

export const FlatWizardDeviceDropdown = memo(() => {
	const { selected } = useSnapshot(homeMenuStore.state)
	const { camera } = useSnapshot(flatWizardListStore.state)

	if (selected !== 'flatWizard') return null

	return (
		<div className="col-span-full flex flex-col items-center gap-2">
			<span className="font-bold">Flat Wizard</span>
			<CameraDropdown showLabel fullWidth value={camera} onValueChange={flatWizardListStore.setCamera} />
			<Button fullWidth disabled={!camera} startContent={<Icons.OpenInNew />} label="Open" onClick={flatWizardListStore.show} />
		</div>
	)
})

export const FlatWizardList = memo(() => {
	const { length } = useSnapshot(flatWizardListStore.state.list)
	const list = new Array<React.ReactNode>(length)

	for (let i = 0; i < length; i++) {
		const { show, camera } = flatWizardListStore.state.list[i]
		const key = camera.id

		list[i] = show && (
			<CameraDeviceContext key={key} value={camera}>
				<FlatWizard key={key} />
			</CameraDeviceContext>
		)
	}

	return list
})
