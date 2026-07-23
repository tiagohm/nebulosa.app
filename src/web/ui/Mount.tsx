import { useDevice } from '@hooks/device.hook'
import { planetariumBus } from '@shared/bus'
import { MountStoreContext } from '@shared/context'
import { mountStore } from '@stores/mount.store'
import { BodyCoordinateInfo } from '@ui/BodyCoordinateInfo'
import { Chip } from '@ui/components/Chip'
import { IconButton } from '@ui/components/IconButton'
import { List, ListItem } from '@ui/components/List'
import { Popover } from '@ui/components/Popover'
import { Switch } from '@ui/components/Switch'
import { Tabs, Tab, TabPanel } from '@ui/components/Tabs'
import { TextInput } from '@ui/components/TextInput'
import { ConnectButton } from '@ui/ConnectButton'
import { Icons } from '@ui/Icon'
import { IndiPanelControl } from '@ui/IndiPanelControl'
import { LocationMap } from '@ui/LocationMap'
import { MountRemoteControl } from '@ui/MountRemoteControl'
import { MountTargetCoordinateTypeRadioGroup } from '@ui/MountTargetCoordinateTypeRadioGroup'
import { Nudge } from '@ui/Nudge'
import { SlewRateSelect } from '@ui/SlewRateSelect'
import { TrackModeSelect } from '@ui/TrackModeSelect'
import { UTCTimeInput } from '@ui/UTCTimeInput'
import type { IDockviewPanelProps } from 'dockview-react'
import type { EquatorialCoordinate } from 'nebulosa/src/astronomy/coordinates/coordinate'
import type { Device, MountTargetCoordinateType } from 'nebulosa/src/devices/indi/device'
import { formatALT, formatAZ, formatDEC, formatRA } from 'nebulosa/src/math/units/angle'
import { memo, useContext } from 'react'
import type { CoordinateInfo, CoordinateType } from 'src/shared/types'
import { useSnapshot } from 'valtio'

const TARGET_TYPE_BY_COORDINATE_TYPE = {
	equatorial: 'JNOW',
	equatorialJ2000: 'J2000',
	horizontal: 'ALTAZ',
	ecliptic: 'ECLIPTIC',
	galactic: 'GALACTIC',
} as const satisfies Record<CoordinateType, MountTargetCoordinateType>

export const Mount = memo(({ params }: IDockviewPanelProps<Device>) => {
	const mount = useDevice('mount', params.id, mountStore)

	if (!mount) return <div className="flex h-full w-full items-center justify-center">Not available</div>

	return (
		<MountStoreContext value={mount.store}>
			<Tabs className="h-full p-3" startContent={<TabStartContent />}>
				<Tab id="main">Mount</Tab>
				<Tab id="location">Location</Tab>
				<Tab id="time">Time</Tab>
				<Tab id="remoteControl">Remote Control</Tab>
				<Tab id="indi">INDI</Tab>

				<TabPanel id="main">
					<Main />
				</TabPanel>
				<TabPanel id="location">
					<Location />
				</TabPanel>
				<TabPanel id="time">
					<Time />
				</TabPanel>
				<TabPanel id="remoteControl">
					<MountRemoteControl />
				</TabPanel>
				<TabPanel id="indi">
					<IndiPanelControl device={mount.device} />
				</TabPanel>
			</Tabs>
		</MountStoreContext>
	)
})

const Main = memo(() => (
	<div className="grid grid-cols-12 gap-2">
		<Status />
		<CurrentPosition />
		<hr className="col-span-full border-dotted text-neutral-800" />
		<TargetCoordinateAndPosition />
		<HandControl />
		<Tracking />
		<ParkAndHome />
		<TrackModeAndRate />
	</div>
))

const TabStartContent = memo(() => {
	const mount = useContext(MountStoreContext)
	const { connected, connecting } = useSnapshot(mount.state.mount)

	return <ConnectButton connected={connected} loading={connecting} onClick={mount.connect} />
})

const Status = memo(() => {
	const mount = useContext(MountStoreContext)
	const { parking, parked, slewing, tracking, homing } = useSnapshot(mount.state.mount)

	return (
		<div className="col-span-full flex flex-row items-center justify-between gap-2">
			<Chip color="primary" size="sm">
				{parking ? 'parking' : parked ? 'parked' : homing ? 'homing' : slewing ? 'slewing' : tracking ? 'tracking' : 'idle'}
			</Chip>
		</div>
	)
})

const CurrentPosition = memo(() => {
	const mount = useContext(MountStoreContext)
	const position = useSnapshot(mount.state.current.position)

	return (
		<div className="col-span-full">
			<BodyCoordinateInfo position={position} />
		</div>
	)
})

const TargetPosition = memo(() => {
	const mount = useContext(MountStoreContext)
	const { type } = useSnapshot(mount.state.target.coordinate)
	const { position } = useSnapshot(mount.state.target)

	return (
		<div className="col-span-full">
			<BodyCoordinateInfo hideLst hideEquatorial={type === 'JNOW'} hideEquatorialJ2000={type === 'J2000'} hideHorizontal={type === 'ALTAZ'} hideEcliptic={type === 'ECLIPTIC'} hideGalactic={type === 'GALACTIC'} position={position} />
		</div>
	)
})

const TargetCoordinateAndPosition = memo(() => {
	const mount = useContext(MountStoreContext)
	const { connected, slewing, parking, homing, parked } = useSnapshot(mount.state.mount)
	const { type } = useSnapshot(mount.state.target.coordinate)
	const coordinate = useSnapshot(mount.state.target.coordinate)
	const disabled = !connected || slewing || parking || homing || parked
	const { x, y } = coordinate[type]!

	return (
		<div className="col-span-full">
			<div className="grid w-full grid-cols-20 items-center gap-2">
				<span className="col-span-4 text-sm font-bold">TARGET:</span>
				<MountTargetCoordinateTypeRadioGroup className="col-span-16" disabled={disabled} onValueChange={mount.updateTargetCoordinateType} value={type} />
				<TargetPosition />
				<TextInput className="col-span-5" disabled={disabled} label={type === 'JNOW' || type === 'J2000' ? 'RA' : type === 'ALTAZ' ? 'AZ' : 'LON'} onValueChange={mount.updateTargetCoordinateX} value={x} />
				<TextInput className="col-span-5" disabled={disabled} label={type === 'JNOW' || type === 'J2000' ? 'DEC' : type === 'ALTAZ' ? 'ALT' : 'LAT'} onValueChange={mount.updateTargetCoordinateY} value={y} />
				<div className="col-span-10 flex flex-row items-center justify-center gap-1">
					<TargetCoordinatePopupButton />
					<IconButton color="success" disabled={disabled} icon={Icons.Telescope} onClick={mount.goTo} tooltipContent="Go" />
					<IconButton color="primary" disabled={disabled} icon={Icons.Sync} onClick={mount.sync} tooltipContent="Sync" />
					<IconButton color="secondary" disabled={disabled} icon={Icons.Image} onClick={mount.frame} tooltipContent="Frame" />
				</div>
			</div>
		</div>
	)
})

const TargetCoordinatePopupButton = memo(() => {
	const mount = useContext(MountStoreContext)
	const { connected } = useSnapshot(mount.state.mount)

	return (
		<Popover classNames={{ content: 'p-0' }} trigger={<IconButton disabled={!connected} color="secondary" icon={Icons.DotsVertical} tooltipContent="Target presets" variant="ghost" />}>
			<TargetCoordinatePopupButtonContent />
		</Popover>
	)
})

const TargetCoordinatePopupButtonContent = memo(() => {
	const mount = useContext(MountStoreContext)
	const { latitude } = useSnapshot(mount.state.mount.geographicCoordinate)

	function handleClick(event: React.UIEvent<HTMLElement>) {
		const action = event.currentTarget.dataset.action
		const position = mount.state.current.position

		if (action === undefined || action === 'bookmark') {
			return
		} else if (isCopyCoordinateAction(action)) {
			const type = action.slice(5) as CoordinateType
			mount.updateTargetCoordinateType(TARGET_TYPE_BY_COORDINATE_TYPE[type])
			mount.updateTargetCoordinateX(formatTargetCoordinateX(type, position))
			mount.updateTargetCoordinateY(formatTargetCoordinateY(type, position))
		} else if (action.endsWith('-pole')) {
			mount.updateTargetCoordinateType('JNOW')
			mount.updateTargetCoordinateX(formatRA(position.lst))
			mount.updateTargetCoordinateY(action.startsWith('north') ? '+90 00 00' : '-90 00 00')
		} else if (action === 'zenith') {
			mount.updateTargetCoordinateType('JNOW')
			mount.updateTargetCoordinateX(formatRA(position.lst))
			mount.updateTargetCoordinateY(formatDEC(latitude))
		} else if (action === 'planetarium') {
			const position = planetariumBus.call('selectedObjectCoordinate', null) as EquatorialCoordinate | undefined

			if (position) {
				mount.updateTargetCoordinateType('JNOW')
				mount.updateTargetCoordinateX(formatRA(position.rightAscension))
				mount.updateTargetCoordinateY(formatDEC(position.declination))
			}
		}

		void mount.updateTargetCoordinatePosition()
	}

	return (
		<List fullWidth className="min-w-80">
			<ListItem label="Bookmark" data-action="bookmark" startContent={<Icons.Bookmark />} onClick={handleClick} />
			<ListItem label="Current J2000 position" data-action="copy-equatorialJ2000" startContent={<Icons.Paste />} onClick={handleClick} />
			<ListItem label="Current JNOW position" data-action="copy-equatorial" startContent={<Icons.Paste />} onClick={handleClick} />
			<ListItem label="Current horizontal position" data-action="copy-horizontal" startContent={<Icons.Paste />} onClick={handleClick} />
			<ListItem label="Current ecliptic position" data-action="copy-ecliptic" startContent={<Icons.Paste />} onClick={handleClick} />
			<ListItem label="Current galactic position" data-action="copy-galactic" startContent={<Icons.Paste />} onClick={handleClick} />
			<ListItem label="Planetarium selected object" data-action="planetarium" startContent={<Icons.Paste />} onClick={handleClick} />
			<ListItem label="Zenith" data-action="zenith" startContent={<Icons.Telescope />} onClick={handleClick} />
			<ListItem disabled={latitude > 0} label="South Pole" data-action="south-pole" startContent={<Icons.Telescope />} onClick={handleClick} />
			<ListItem disabled={latitude < 0} label="North Pole" data-action="north-pole" startContent={<Icons.Telescope />} onClick={handleClick} />
		</List>
	)
})

const HandControl = memo(() => {
	const mount = useContext(MountStoreContext)
	const { connected, parking, parked, slewing, homing, canAbort } = useSnapshot(mount.state.mount)
	const moving = slewing || parking || homing

	return <Nudge className="col-span-4 row-span-2" disabled={!connected || parked} isCancelDisabled={!canAbort || parked || !moving} isNudgeDisabled={moving} onCancel={mount.stop} onNudge={mount.moveTo} />
})

const Tracking = memo(() => {
	const mount = useContext(MountStoreContext)
	const { connected, parking, parked, slewing, homing, tracking } = useSnapshot(mount.state.mount)
	const moving = slewing || parking || homing

	return <Switch className="col-span-3" disabled={!connected || moving || parked} label="Tracking" onValueChange={mount.tracking} value={tracking} />
})

const ParkAndHome = memo(() => {
	const mount = useContext(MountStoreContext)
	const { connected, parking, parked, slewing, homing, canPark, canHome, canFindHome } = useSnapshot(mount.state.mount)
	const moving = slewing || parking || homing

	return (
		<div className="col-span-5 flex flex-row items-center justify-center gap-2">
			<IconButton color={parked ? 'success' : 'danger'} disabled={!connected || !canPark || moving} icon={parked ? Icons.Play : Icons.Stop} onClick={mount.togglePark} tooltipContent={parked ? 'Unpark' : 'Park'} />
			<IconButton color="primary" disabled={!connected || !canHome || moving || parked} icon={Icons.Home} onClick={mount.home} tooltipContent="Home" />
			<IconButton color="secondary" disabled={!connected || !canFindHome || moving || parked} icon={Icons.HomeSearch} onClick={mount.findHome} tooltipContent="Find Home" />
		</div>
	)
})

const TrackModeAndRate = memo(() => {
	const mount = useContext(MountStoreContext)
	const { connected, parking, parked, slewing, homing, trackModes, trackMode, slewRates, slewRate, guideRate } = useSnapshot(mount.state.mount)
	const moving = slewing || parking || homing
	const disabled = !connected || moving || parked

	return (
		<div className="col-span-8 flex flex-row items-center gap-2">
			<TrackModeSelect className="w-13/24" disabled={disabled} modes={trackModes} onValueChange={mount.trackMode} value={trackMode} />
			<SlewRateSelect className="w-11/24" disabled={disabled} onValueChange={mount.slewRate} rates={slewRates} value={slewRate ?? ''} />
		</div>
	)
})

export const Location = memo(() => {
	const mount = useContext(MountStoreContext)
	const { geographicCoordinate } = useSnapshot(mount.state.mount)

	return <LocationMap mode="mount" {...geographicCoordinate} onCoordinateChange={mount.location} />
})

export const Time = memo(() => {
	const mount = useContext(MountStoreContext)
	const { time } = useSnapshot(mount.state.mount)

	return <UTCTimeInput {...time} onTimeChange={mount.time} />
})

function isCopyCoordinateAction(action: string) {
	return action.startsWith('copy-')
}

function formatTargetCoordinateX(type: CoordinateType, position: CoordinateInfo) {
	return type === 'equatorial' || type === 'equatorialJ2000' ? formatRA(position[type][0]) : formatAZ(position[type][0])
}

function formatTargetCoordinateY(type: CoordinateType, position: CoordinateInfo) {
	return type === 'horizontal' ? formatALT(position[type][1]) : formatDEC(position[type][1])
}
