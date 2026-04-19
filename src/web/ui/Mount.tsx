import { Chip, Listbox, ListboxItem, Popover, PopoverContent, PopoverTrigger } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { formatALT, formatAZ, formatRA } from 'nebulosa/src/angle'
import { Activity, memo, useState } from 'react'
import type { CoordinateType } from 'src/shared/types'
import { useSnapshot } from 'valtio'
import { MountMolecule } from '@/molecules/indi/mount'
import { DEFAULT_POPOVER_PROPS } from '../shared/constants'
import { BodyCoordinateInfo } from './BodyCoordinateInfo'
import { ConnectButton } from './ConnectButton'
import { Switch } from './components/Switch'
import { TextInput } from './components/TextInput'
import { Icons } from './Icon'
import { IconButton } from './IconButton'
import { IndiPanelControlButton } from './IndiPanelControlButton'
import { Location } from './Location'
import { Modal } from './Modal'
import { MountRemoteControl } from './MountRemoteControl'
import { MountTargetCoordinateTypeRadioGroup } from './MountTargetCoordinateTypeRadioGroup'
import { Nudge } from './Nudge'
import { SlewRateSelect } from './SlewRateSelect'
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
				<ConnectButton disabled={moving} isConnected={connected} loading={connecting} onPointerUp={mount.connect} />
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
			<Nudge className='col-span-5 row-span-2' disabled={!connected || parked} isCancelDisabled={!canAbort || parked || !moving} isNudgeDisabled={moving} onCancel={mount.stop} onNudge={mount.moveTo} />
			<Switch disabled={!connected || moving || parked} label='Tracking' onValueChange={mount.tracking} value={tracking} />
			<ParkAndHome />
			<TrackModeSelect className='col-span-4' isDisabled={!connected || moving || parked} modes={trackModes} onValueChange={mount.trackMode} value={trackMode} />
			<SlewRateSelect className='col-span-3' isDisabled={!connected || moving || parked} onValueChange={mount.slewRate} rates={slewRates} value={slewRate ?? ''} />
		</div>
	)
})

const Status = memo(() => {
	const mount = useMolecule(MountMolecule)
	const { parking, parked, slewing, tracking, homing } = useSnapshot(mount.state.mount)

	return <Chip color='primary'>{parking ? 'parking' : parked ? 'parked' : homing ? 'homing' : slewing ? 'slewing' : tracking ? 'tracking' : 'idle'}</Chip>
})

const LocationButton = memo(() => {
	const mount = useMolecule(MountMolecule)
	const { show } = useSnapshot(mount.state.location)
	const { connected, geographicCoordinate } = useSnapshot(mount.state.mount)

	return (
		<>
			<IconButton color='danger' disabled={!connected} icon={Icons.MapMarker} onPointerUp={mount.showLocation} tooltipContent='Location' />
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
			<IconButton color='primary' disabled={!connected || time.utc === 0} icon={Icons.Clock} onPointerUp={mount.showTime} tooltipContent='Time' />
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
			<IconButton color='secondary' disabled={!connected} icon={Icons.RemoteControl} onPointerUp={mount.showRemoteControl} tooltipContent='Remote Control' />
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
	const { type } = useSnapshot(mount.state.targetCoordinate.coordinate)
	const coordinate = useSnapshot(mount.state.targetCoordinate.coordinate, { sync: true })
	const disabled = !connected || slewing || parking || homing || parked
	const { x, y } = coordinate[type]!

	return (
		<div className='col-span-full'>
			<div className='w-full grid grid-cols-20 gap-2 items-center'>
				<span className='col-span-4 text-sm font-bold'>TARGET:</span>
				<MountTargetCoordinateTypeRadioGroup className='col-span-16' disabled={disabled} onValueChange={mount.updateTargetCoordinateType} value={type} />
				<TargetPosition />
				<TextInput className='col-span-5' disabled={disabled} label={type === 'JNOW' || type === 'J2000' ? 'RA' : type === 'ALTAZ' ? 'AZ' : 'LON'} onValueChange={mount.updateTargetCoordinateX} value={x} />
				<TextInput className='col-span-5' disabled={disabled} label={type === 'JNOW' || type === 'J2000' ? 'DEC' : type === 'ALTAZ' ? 'ALT' : 'LAT'} onValueChange={mount.updateTargetCoordinateY} value={y} />
				<div className='col-span-10 flex flex-row items-center justify-center gap-1'>
					<TargetCoordinatePopupButton />
					<IconButton color='success' disabled={disabled} icon={Icons.Telescope} onPointerUp={mount.goTo} />
					<IconButton color='primary' disabled={disabled} icon={Icons.Sync} onPointerUp={mount.sync} />
					<IconButton color='secondary' disabled={disabled} icon={Icons.Image} onPointerUp={mount.frame} />
				</div>
			</div>
		</div>
	)
})

const TargetCoordinatePopupButton = memo(() => {
	const [open, setOpen] = useState(false)

	return (
		<Popover isOpen={open} onOpenChange={setOpen} {...DEFAULT_POPOVER_PROPS}>
			<PopoverTrigger>
				<IconButton color='secondary' icon={Icons.DotsVertical} variant='ghost' />
			</PopoverTrigger>
			<PopoverContent>
				<TargetCoordinatePopupButtonContent />
			</PopoverContent>
		</Popover>
	)
})

const TargetCoordinatePopupButtonContent = memo(() => {
	const mount = useMolecule(MountMolecule)
	const { latitude } = useSnapshot(mount.state.mount.geographicCoordinate)

	function onAction(action: React.Key) {
		if (typeof action !== 'string') return

		if (action === 'bookmark') {
		} else if (action.startsWith('copy-')) {
			const type = action.substring(5) as CoordinateType
			mount.updateTargetCoordinateType(type === 'ecliptic' ? 'ECLIPTIC' : type === 'galactic' ? 'GALACTIC' : type === 'horizontal' ? 'ALTAZ' : type === 'equatorial' ? 'JNOW' : 'J2000')
			if (type === 'equatorial' || type === 'equatorialJ2000') mount.updateTargetCoordinateX(formatRA(mount.state.currentPosition[type][0]))
			else mount.updateTargetCoordinateX(formatAZ(mount.state.currentPosition[type][0]))
			mount.updateTargetCoordinateY(formatALT(mount.state.currentPosition[type][1]))
		} else if (action.endsWith('-pole')) {
			mount.updateTargetCoordinateType('JNOW')
			mount.updateTargetCoordinateX(formatRA(mount.state.currentPosition.lst))
			mount.updateTargetCoordinateY(action.startsWith('north') ? '+90 00 00' : '-90 00 00')
		} else if (action === 'zenith') {
			mount.updateTargetCoordinateType('JNOW')
			mount.updateTargetCoordinateX(formatRA(mount.state.currentPosition.lst))
			mount.updateTargetCoordinateY(formatAZ(latitude))
		}
	}

	const disabledKeys: string[] = []
	if (latitude > 0) disabledKeys.push('south-pole')
	else if (latitude < 0) disabledKeys.push('north-pole')

	return (
		<Listbox disabledKeys={disabledKeys} onAction={onAction}>
			<ListboxItem key='bookmark' startContent={<Icons.Bookmark />}>
				Bookmark
			</ListboxItem>
			<ListboxItem key='copy-equatorialJ2000' startContent={<Icons.Paste />}>
				Paste current J2000 position
			</ListboxItem>
			<ListboxItem key='copy-equatorial' startContent={<Icons.Paste />}>
				Paste current JNOW position
			</ListboxItem>
			<ListboxItem key='copy-horizontal' startContent={<Icons.Paste />}>
				Paste current Horizontal position
			</ListboxItem>
			<ListboxItem key='copy-ecliptic' startContent={<Icons.Paste />}>
				Paste current Eclíptic position
			</ListboxItem>
			<ListboxItem key='copy-galactic' startContent={<Icons.Paste />}>
				Paste current Galactic position
			</ListboxItem>
			<ListboxItem key='zenith' startContent={<Icons.Telescope />}>
				Zenith
			</ListboxItem>
			<ListboxItem key='south-pole' startContent={<Icons.Telescope />}>
				South Pole
			</ListboxItem>
			<ListboxItem key='north-pole' startContent={<Icons.Telescope />}>
				North Pole
			</ListboxItem>
		</Listbox>
	)
})

const ParkAndHome = memo(() => {
	const mount = useMolecule(MountMolecule)
	const { connected, parking, parked, slewing, homing, canPark, canHome, canFindHome } = useSnapshot(mount.state.mount)
	const moving = slewing || parking || homing

	return (
		<div className='col-span-4 flex flex-row items-center justify-center gap-2'>
			<IconButton color={parked ? 'success' : 'danger'} disabled={!connected || !canPark || moving} icon={parked ? Icons.Play : Icons.Stop} onPointerUp={mount.togglePark} tooltipContent={parked ? 'Unpark' : 'Park'} />
			<IconButton color='primary' disabled={!connected || !canHome || moving || parked} icon={Icons.Home} onPointerUp={mount.home} tooltipContent='Home' />
			<IconButton color='secondary' disabled={!connected || !canFindHome || moving || parked} icon={Icons.HomeSearch} onPointerUp={mount.findHome} tooltipContent='Find Home' />
		</div>
	)
})
