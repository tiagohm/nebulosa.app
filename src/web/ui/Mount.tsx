import { Chip, Input, Switch, Tooltip } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { Activity, memo } from 'react'
import { useSnapshot } from 'valtio'
import { MountMolecule } from '@/molecules/indi/mount'
import { BodyCoordinateInfo } from './BodyCoordinateInfo'
import { ConnectButton } from './ConnectButton'
import { Icons } from './Icon'
import { IconButton } from './IconButton'
import { IndiPanelControlButton } from './IndiPanelControlButton'
import { Location } from './Location'
import { Modal } from './Modal'
import { MountRemoteControl } from './MountRemoteControl'
import { MountTargetCoordinateTypeRadioGroup } from './MountTargetCoordinateTypeRadioGroup'
import { Nudge } from './Nudge'
import { SlewRateSelect } from './SlewRateSelect'
import { TargetCoordinateActionDropdownButton } from './TargetCoordinateActionDropdownButton'
import { Time } from './Time'
import { TrackModeSelect } from './TrackModeSelect'

export const Mount = memo(() => {
	const mount = useMolecule(MountMolecule)

	return (
		<Modal header={<Header />} id={`mount-${mount.scope.mount.name}`} maxWidth='400px' onHide={mount.hide}>
			<Body />
		</Modal>
	)
})

const Header = memo(() => {
	const mount = useMolecule(MountMolecule)
	const { connecting, connected, parking, slewing, homing } = useSnapshot(mount.state.mount)
	const moving = slewing || parking || homing

	return (
		<div className='w-full flex flex-row items-center justify-between'>
			<div className='flex flex-row items-center gap-1'>
				<ConnectButton isConnected={connected} isDisabled={moving} isLoading={connecting} onPointerUp={mount.connect} />
				<IndiPanelControlButton device={mount.scope.mount.name} />
			</div>
			<div className='flex flex-col flex-1 gap-0 justify-center items-center'>
				<span className='font-semibold leading-5'>Mount</span>
				<span className='text-xs font-normal text-gray-400 max-w-full'>{mount.scope.mount.name}</span>
			</div>
		</div>
	)
})

const Body = memo(() => {
	const mount = useMolecule(MountMolecule)
	const { connected, parking, parked, slewing, tracking, homing, canAbort, trackModes, trackMode, slewRates, slewRate, time } = useSnapshot(mount.state.mount)
	const moving = slewing || parking || homing

	return (
		<div className='mt-0 grid grid-cols-12 gap-2'>
			<div className='col-span-full flex flex-row items-center justify-between'>
				<Status />
				<div className='flex flex-row items-center gap-2'>
					<LocationButton />
					<TimeButton />
					<RemoteControlButton />
				</div>
			</div>
			<CurrentPosition />
			<hr className='col-span-full text-neutral-800 border-dotted' />
			<TargetCoordinateAndPosition />
			<Nudge className='col-span-5 row-span-2' isCancelDisabled={!canAbort || parked || !moving} isDisabled={!connected || parked} isNudgeDisabled={moving} onCancel={mount.stop} onNudge={mount.moveTo} />
			<Switch className='col-span-3 flex-col-reverse gap-0.2 justify-center max-w-none' classNames={{ label: 'text-xs ms-0' }} isDisabled={!connected || moving || parked} isSelected={tracking} onValueChange={mount.tracking}>
				Tracking
			</Switch>
			<ParkAndHome />
			<TrackModeSelect className='col-span-4' isDisabled={!connected || moving || parked} modes={trackModes} onValueChange={mount.trackMode} value={trackMode} />
			<SlewRateSelect className='col-span-3' isDisabled={!connected || moving || parked} onValueChange={mount.slewRate} rates={slewRates} value={slewRate ?? ''} />
		</div>
	)
})

const Status = memo(() => {
	const mount = useMolecule(MountMolecule)
	const { parking, parked, slewing, tracking, homing } = useSnapshot(mount.state.mount)

	return (
		<Chip color='primary' size='sm'>
			{parking ? 'parking' : parked ? 'parked' : homing ? 'homing' : slewing ? 'slewing' : tracking ? 'tracking' : 'idle'}
		</Chip>
	)
})

const LocationButton = memo(() => {
	const mount = useMolecule(MountMolecule)
	const { show } = useSnapshot(mount.state.location)
	const { connected, geographicCoordinate } = useSnapshot(mount.state.mount)

	return (
		<>
			<Tooltip content='Location' showArrow>
				<IconButton color='danger' icon={Icons.MapMarker} isDisabled={!connected} onPointerUp={mount.showLocation} />
			</Tooltip>
			{show && <Location {...geographicCoordinate} id={`location-mount-${mount.scope.mount.name}`} onClose={mount.hideLocation} onCoordinateChange={mount.location} />}
		</>
	)
})

const TimeButton = memo(() => {
	const mount = useMolecule(MountMolecule)
	const { show } = useSnapshot(mount.state.time)
	const { connected, time } = useSnapshot(mount.state.mount)

	return (
		<>
			<Tooltip content='Time' showArrow>
				<IconButton color='primary' icon={Icons.Clock} isDisabled={!connected || time.utc === 0} onPointerUp={mount.showTime} />
			</Tooltip>
			<Activity mode={show ? 'visible' : 'hidden'}>
				<Time id={`time-mount-${mount.scope.mount.name}`} onClose={mount.hideTime} onTimeChange={mount.time} {...time} />
			</Activity>
		</>
	)
})

const RemoteControlButton = memo(() => {
	const mount = useMolecule(MountMolecule)
	const { show } = useSnapshot(mount.state.remoteControl)
	const { connected } = useSnapshot(mount.state.mount)

	return (
		<>
			<Tooltip content='Remote Control' showArrow>
				<IconButton color='secondary' icon={Icons.RemoteControl} isDisabled={!connected} onPointerUp={mount.showRemoteControl} />
			</Tooltip>
			<Activity mode={show ? 'visible' : 'hidden'}>
				<MountRemoteControl />
			</Activity>
		</>
	)
})

const CurrentPosition = memo(() => {
	const mount = useMolecule(MountMolecule)
	const position = useSnapshot(mount.state.currentPosition)

	return (
		<div className='col-span-full'>
			<BodyCoordinateInfo position={position} />
		</div>
	)
})

const TargetPosition = memo(() => {
	const mount = useMolecule(MountMolecule)
	const { type } = useSnapshot(mount.state.targetCoordinate.coordinate)
	const { position } = useSnapshot(mount.state.targetCoordinate)

	return (
		<div className='col-span-full'>
			<BodyCoordinateInfo hide={['lst', type === 'JNOW' ? 'equatorial' : type === 'J2000' ? 'equatorialJ2000' : type === 'ALTAZ' ? 'horizontal' : type === 'ECLIPTIC' ? 'ecliptic' : 'galactic']} position={position} />
		</div>
	)
})

const TargetCoordinateAndPosition = memo(() => {
	const mount = useMolecule(MountMolecule)
	const { connected, slewing, parking, homing, parked } = useSnapshot(mount.state.mount)
	const { type, action } = useSnapshot(mount.state.targetCoordinate.coordinate)
	const coordinate = useSnapshot(mount.state.targetCoordinate.coordinate, { sync: true })
	const disabled = !connected || slewing || parking || homing || parked
	const { x, y } = coordinate[type]!

	return (
		<div className='col-span-full'>
			<div className='w-full grid grid-cols-20 gap-2 items-center'>
				<span className='col-span-4 text-sm font-bold'>TARGET:</span>
				<MountTargetCoordinateTypeRadioGroup className='col-span-16' isDisabled={disabled} onValueChange={(value) => mount.updateTargetCoordinate('type', value)} value={type} />
				<TargetPosition />
				<Input className='col-span-6' isDisabled={disabled} label={type === 'JNOW' || type === 'J2000' ? 'RA' : type === 'ALTAZ' ? 'AZ' : 'LON'} onValueChange={(value) => mount.updateTargetCoordinateByType('x', value)} size='sm' value={x} />
				<Input className='col-span-6' isDisabled={disabled} label={type === 'JNOW' || type === 'J2000' ? 'DEC' : type === 'ALTAZ' ? 'ALT' : 'LAT'} onValueChange={(value) => mount.updateTargetCoordinateByType('y', value)} size='sm' value={y} />
				<TargetCoordinateActionDropdownButton action={action} className='col-span-8' color='primary' isDisabled={disabled} onAction={mount.updateTargetCoordinateAction} onPointerUp={mount.handleTargetCoordinateAction} size='lg' />
			</div>
		</div>
	)
})

const ParkAndHome = memo(() => {
	const mount = useMolecule(MountMolecule)
	const { connected, parking, parked, slewing, homing, canPark, canHome, canFindHome } = useSnapshot(mount.state.mount)
	const moving = slewing || parking || homing

	return (
		<div className='col-span-4 flex flex-row items-center justify-center gap-2'>
			<Tooltip content={parked ? 'Unpark' : 'Park'} showArrow>
				<IconButton color={parked ? 'success' : 'danger'} icon={parked ? Icons.Play : Icons.Stop} isDisabled={!connected || !canPark || moving} onPointerUp={mount.togglePark} />
			</Tooltip>
			<Tooltip content='Home' showArrow>
				<IconButton color='primary' icon={Icons.Home} isDisabled={!connected || !canHome || moving || parked} onPointerUp={mount.home} />
			</Tooltip>
			<Tooltip content='Find Home' showArrow>
				<IconButton color='secondary' icon={Icons.HomeSearch} isDisabled={!connected || !canFindHome || moving || parked} onPointerUp={mount.findHome} />
			</Tooltip>
		</div>
	)
})
