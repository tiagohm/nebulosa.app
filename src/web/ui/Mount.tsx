import { formatALT, formatAZ, formatDEC, formatRA } from 'nebulosa/src/angle'
import type { MountTargetCoordinateType } from 'nebulosa/src/indi.device'
import { memo, useContext } from 'react'
import type { CoordinateInfo, CoordinateType } from 'src/shared/types'
import { useSnapshot } from 'valtio'
import { useStore } from '../hooks/store.hook'
import { MountDeviceContext, MountStoreContext } from '../shared/context'
import { mountStore } from '../store/mount.store'
import { BodyCoordinateInfo } from './BodyCoordinateInfo'
import { Chip } from './components/Chip'
import { IconButton } from './components/IconButton'
import { List, ListItem } from './components/List'
import { Popover } from './components/Popover'
import { Switch } from './components/Switch'
import { TextInput } from './components/TextInput'
import { ConnectButton } from './ConnectButton'
import { Icons } from './Icon'
import { IndiPanelControlButton } from './IndiPanelControlButton'
import { Location } from './Location'
import { Modal } from './Modal'
import { MountRemoteControl } from './MountRemoteControl'
import { MountTargetCoordinateTypeRadioGroup } from './MountTargetCoordinateTypeRadioGroup'
import { Nudge } from './Nudge'
import { SlewRateSelect } from './SlewRateSelect'
import { Time } from './Time'
import { TrackModeSelect } from './TrackModeSelect'

const TARGET_TYPE_BY_COORDINATE_TYPE = {
	equatorial: 'JNOW',
	equatorialJ2000: 'J2000',
	horizontal: 'ALTAZ',
	ecliptic: 'ECLIPTIC',
	galactic: 'GALACTIC',
} as const satisfies Record<CoordinateType, MountTargetCoordinateType>

function isCopyCoordinateAction(action: string) {
	return action.startsWith('copy-')
}

function formatTargetCoordinateX(type: CoordinateType, position: CoordinateInfo) {
	return type === 'equatorial' || type === 'equatorialJ2000' ? formatRA(position[type][0]) : formatAZ(position[type][0])
}

function formatTargetCoordinateY(type: CoordinateType, position: CoordinateInfo) {
	return type === 'horizontal' ? formatALT(position[type][1]) : formatDEC(position[type][1])
}

export const Mount = memo(() => {
	const device = useContext(MountDeviceContext)
	const mount = useStore(() => mountStore(device), [device])

	return (
		<MountStoreContext value={mount}>
			<Modal header={<Header />} id={`mount-${device.id}`} maxWidth="392px" onHide={mount.hide}>
				<Body />
			</Modal>
		</MountStoreContext>
	)
})

const Header = memo(() => {
	const mount = useContext(MountStoreContext)
	const { connecting, connected, parking, slewing, homing, name } = useSnapshot(mount.state.mount)
	const moving = slewing || parking || homing

	return (
		<div className="flex w-full flex-row items-center justify-between">
			<div className="flex flex-row items-center gap-1">
				<ConnectButton disabled={moving} connected={connected} loading={connecting} onClick={mount.connect} />
				<IndiPanelControlButton device={mount.state.mount} />
			</div>
			<div className="flex flex-1 flex-col items-center justify-center gap-0">
				<span className="leading-5 font-semibold">Mount</span>
				<span className="max-w-full text-xs font-normal text-gray-400">{name}</span>
			</div>
		</div>
	)
})

const Body = memo(() => (
	<div className="mt-0 grid grid-cols-12 gap-2">
		<div className="col-span-full flex flex-row items-center justify-between">
			<Status />
			<div className="flex flex-row items-center gap-2">
				<LocationButton />
				<TimeButton />
				<RemoteControlButton />
			</div>
		</div>
		<CurrentPosition />
		<hr className="col-span-full border-dotted text-neutral-800" />
		<TargetCoordinateAndPosition />
		<HandControl />
		<Tracking />
		<ParkAndHome />
		<TrackModeAndRate />
	</div>
))

const Status = memo(() => {
	const mount = useContext(MountStoreContext)
	const { parking, parked, slewing, tracking, homing } = useSnapshot(mount.state.mount)

	return (
		<Chip color="primary" size="sm">
			{parking ? 'parking' : parked ? 'parked' : homing ? 'homing' : slewing ? 'slewing' : tracking ? 'tracking' : 'idle'}
		</Chip>
	)
})

const LocationButton = memo(() => {
	const mount = useContext(MountStoreContext)
	const { show } = useSnapshot(mount.state.location)
	const { connected, geographicCoordinate } = useSnapshot(mount.state.mount)

	return (
		<>
			<IconButton color="danger" disabled={!connected} icon={Icons.MapMarker} onClick={mount.showLocation} tooltipContent="Location" />
			{show && <Location {...geographicCoordinate} id={`location-mount-${mount.state.mount.id}`} onClose={mount.hideLocation} onCoordinateChange={mount.location} />}
		</>
	)
})

const TimeButton = memo(() => {
	const mount = useContext(MountStoreContext)
	const { show } = useSnapshot(mount.state.time)
	const { connected, time } = useSnapshot(mount.state.mount)

	return (
		<>
			<IconButton color="primary" disabled={!connected || time.utc === 0} icon={Icons.Clock} onClick={mount.showTime} tooltipContent="Time" />
			{show && <Time id={`time-mount-${mount.state.mount.id}`} onClose={mount.hideTime} onTimeChange={mount.time} {...time} />}
		</>
	)
})

const RemoteControlButton = memo(() => {
	const mount = useContext(MountStoreContext)
	const { show } = useSnapshot(mount.state.remoteControl)
	const { connected } = useSnapshot(mount.state.mount)

	return (
		<>
			<IconButton color="secondary" disabled={!connected} icon={Icons.RemoteControl} onClick={mount.showRemoteControl} tooltipContent="Remote Control" />
			{show && <MountRemoteControl />}
		</>
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
			<BodyCoordinateInfo hide={['lst', type === 'JNOW' ? 'equatorial' : type === 'J2000' ? 'equatorialJ2000' : type === 'ALTAZ' ? 'horizontal' : type === 'ECLIPTIC' ? 'ecliptic' : 'galactic']} position={position} />
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
		}

		void mount.updateTargetCoordinatePosition()
	}

	return (
		<List fullWidth className="min-w-80">
			<ListItem label="Bookmark" data-action="bookmark" startContent={<Icons.Bookmark />} onClick={handleClick} />
			<ListItem label="Paste current J2000 position" data-action="copy-equatorialJ2000" startContent={<Icons.Paste />} onClick={handleClick} />
			<ListItem label="Paste current JNOW position" data-action="copy-equatorial" startContent={<Icons.Paste />} onClick={handleClick} />
			<ListItem label="Paste current Horizontal position" data-action="copy-horizontal" startContent={<Icons.Paste />} onClick={handleClick} />
			<ListItem label="Paste current Ecliptic position" data-action="copy-ecliptic" startContent={<Icons.Paste />} onClick={handleClick} />
			<ListItem label="Paste current Galactic position" data-action="copy-galactic" startContent={<Icons.Paste />} onClick={handleClick} />
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
