import { Chip, DropdownItem, Input, Switch, Tooltip } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { Activity, memo } from 'react'
import { useSnapshot } from 'valtio'
import { MountMolecule, type TargetCoordinateAction } from '@/molecules/indi/mount'
import { BodyCoordinateInfo } from './BodyCoordinateInfo'
import { ConnectButton } from './ConnectButton'
import { DropdownButton } from './DropdownButton'
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
	// biome-ignore format: don't break lines!
	const { location: { show: showLocation }, time: { show: showTime }, remoteControl: { show: showRemoteControl } } = useSnapshot(mount.state)
	const { connecting, connected, parking, parked, slewing, tracking, homing, canPark, canHome, canFindHome, canAbort, trackModes, trackMode, slewRates, slewRate, geographicCoordinate, time } = useSnapshot(mount.state.mount)
	const moving = slewing || parking || homing

	const Header = (
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

	return (
		<>
			<Modal header={Header} id={`mount-${mount.scope.mount.name}`} maxWidth='400px' onHide={mount.hide}>
				<div className='mt-0 grid grid-cols-12 gap-2'>
					<div className='col-span-full flex flex-row items-center justify-between'>
						<Chip color='primary' size='sm'>
							{parking ? 'parking' : parked ? 'parked' : homing ? 'homing' : slewing ? 'slewing' : tracking ? 'tracking' : 'idle'}
						</Chip>
						<div className='flex flex-row items-center gap-2'>
							<Tooltip content='Remote Control' showArrow>
								<IconButton color='secondary' icon={Icons.RemoteControl} isDisabled={!connected} onPointerUp={mount.showRemoteControl} />
							</Tooltip>
							<Tooltip content='Location' showArrow>
								<IconButton color='danger' icon={Icons.MapMarker} isDisabled={!connected || moving} onPointerUp={mount.showLocation} />
							</Tooltip>
							<Tooltip content='Time' showArrow>
								<IconButton color='primary' icon={Icons.Clock} isDisabled={!connected || moving || time.utc === 0} onPointerUp={mount.showTime} />
							</Tooltip>
						</div>
					</div>
					<div className='col-span-full'>
						<CurrentPosition />
					</div>
					<hr className='col-span-full text-neutral-800 border-dotted' />
					<div className='col-span-full'>
						<TargetCoordinateAndPosition isDisabled={!connected || moving || parked} />
					</div>
					<Nudge className='col-span-5 row-span-2' isCancelDisabled={!canAbort || parked || !moving} isDisabled={!connected || parked} isNudgeDisabled={moving} onCancel={mount.stop} onNudge={mount.moveTo} />
					<Switch className='col-span-3 flex-col-reverse gap-0.2 justify-center max-w-none' classNames={{ label: 'text-xs ms-0' }} isDisabled={!connected || moving || parked} isSelected={tracking} onValueChange={mount.tracking}>
						Tracking
					</Switch>
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
					<TrackModeSelect className='col-span-4' isDisabled={!connected || moving || parked} modes={trackModes} onValueChange={mount.trackMode} value={trackMode} />
					<SlewRateSelect className='col-span-3' isDisabled={!connected || moving || parked} onValueChange={mount.slewRate} rates={slewRates} value={slewRate ?? ''} />
				</div>
			</Modal>
			{showLocation && <Location {...geographicCoordinate} id={`location-mount-${mount.scope.mount.name}`} onClose={mount.hideLocation} onCoordinateChange={mount.location} />}
			{showTime && <Time id={`time-mount-${mount.scope.mount.name}`} onClose={mount.hideTime} onTimeChange={mount.time} {...time} />}
			<Activity mode={showRemoteControl ? 'visible' : 'hidden'}>
				<MountRemoteControl />
			</Activity>
		</>
	)
})

const CurrentPosition = memo(() => {
	const mount = useMolecule(MountMolecule)
	const position = useSnapshot(mount.state.currentPosition)

	return <BodyCoordinateInfo position={position} />
})

interface TargetCoordinateAndPositionProps {
	readonly isDisabled?: boolean
}

const TargetCoordinateAndPosition = memo(({ isDisabled }: TargetCoordinateAndPositionProps) => {
	const mount = useMolecule(MountMolecule)
	const { type, action } = useSnapshot(mount.state.targetCoordinate.coordinate)
	const coordinate = useSnapshot(mount.state.targetCoordinate.coordinate, { sync: true })
	const { position } = useSnapshot(mount.state.targetCoordinate)
	const { x, y } = coordinate[type]!

	return (
		<div className='w-full grid grid-cols-20 gap-2 items-center'>
			<span className='col-span-4 text-sm font-bold'>TARGET:</span>
			<MountTargetCoordinateTypeRadioGroup className='col-span-16' isDisabled={isDisabled} onValueChange={(value) => mount.updateTargetCoordinate('type', value)} value={type} />
			<div className='col-span-full'>
				<BodyCoordinateInfo hide={['lst', type === 'JNOW' ? 'equatorial' : type === 'J2000' ? 'equatorialJ2000' : type === 'ALTAZ' ? 'horizontal' : type === 'ECLIPTIC' ? 'ecliptic' : 'galactic']} position={position} />
			</div>
			<Input className='col-span-6' isDisabled={isDisabled} label={type === 'JNOW' || type === 'J2000' ? 'RA' : type === 'ALTAZ' ? 'AZ' : 'LON'} onValueChange={(value) => mount.updateTargetCoordinateByType('x', value)} size='sm' value={x} />
			<Input className='col-span-6' isDisabled={isDisabled} label={type === 'JNOW' || type === 'J2000' ? 'DEC' : type === 'ALTAZ' ? 'ALT' : 'LAT'} onValueChange={(value) => mount.updateTargetCoordinateByType('y', value)} size='sm' value={y} />
			<DropdownButton className='col-span-8' color='primary' isDisabled={isDisabled} label={<TargetCoordinateDropdownButtonLabel action={action} />} onAction={mount.updateTargetCoordinateAction} onPointerUp={mount.handleTargetCoordinateAction} size='lg'>
				<DropdownItem key='GOTO' startContent={<Icons.Telescope size={12} />}>
					Go
				</DropdownItem>
				<DropdownItem key='SYNC' startContent={<Icons.Sync size={12} />}>
					Sync
				</DropdownItem>
				<DropdownItem key='FRAME' startContent={<Icons.Image size={12} />}>
					Frame
				</DropdownItem>
			</DropdownButton>
		</div>
	)
})

const TARGET_COORDINATE_DROPDOWN_BUTTON_ITEMS = {
	GOTO: [Icons.Telescope, 'Go'],
	SYNC: [Icons.Sync, 'Sync'],
	FRAME: [Icons.Image, 'Frame'],
} as const

interface TargetCoordinateDropdownButtonLabelProps {
	readonly action: TargetCoordinateAction
}

const TargetCoordinateDropdownButtonLabel = memo(({ action }: TargetCoordinateDropdownButtonLabelProps) => {
	const [Icon, label] = TARGET_COORDINATE_DROPDOWN_BUTTON_ITEMS[action]

	return (
		<div className='flex items-center gap-2 text-medium'>
			<Icon /> {label}
		</div>
	)
})
