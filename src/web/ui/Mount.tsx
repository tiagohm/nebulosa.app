import { Button, Chip, DropdownItem, Input, Switch, Tooltip } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { formatALT, formatAZ, formatDEC, formatHMS, formatRA } from 'nebulosa/src/angle'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { MountMolecule, type TargetCoordinateAction } from '@/molecules/indi/mount'
import { ConnectButton } from './ConnectButton'
import { DropdownButton } from './DropdownButton'
import { Icons } from './Icon'
import { IndiPanelControlButton } from './IndiPanelControlButton'
import { Location } from './Location'
import { Modal } from './Modal'
import { MountRemoteControl } from './MountRemoteControl'
import { Nudge } from './Nudge'
import { SlewRateSelect } from './SlewRateSelect'
import { TargetCoordinateTypeButtonGroup } from './TargetCoordinateTypeButtonGroup'
import { Time } from './Time'
import { TrackModeSelect } from './TrackModeSelect'

export const Mount = memo(() => {
	const mount = useMolecule(MountMolecule)
	// biome-ignore format: don't break lines!
	const { location: { show: showLocation }, time: { show: showTime }, remoteControl: { show: showRemoteControl } } = useSnapshot(mount.state)
	const { connecting, connected, parking, parked, slewing, tracking, canPark, canHome, canAbort, trackModes, trackMode, slewRates, slewRate, geographicCoordinate, time } = useSnapshot(mount.state.mount)
	const moving = slewing || parking

	const Header = (
		<div className='flex flex-row items-center justify-between'>
			<div className='flex flex-row items-center gap-1'>
				<ConnectButton isConnected={connected} isDisabled={moving} isLoading={connecting} onPointerUp={mount.connect} />
				<IndiPanelControlButton device={mount.scope.mount.name} />
			</div>
			<div className='flex flex-col flex-1 gap-0 justify-center items-center'>
				<span className='leading-5'>Mount</span>
				<span className='text-xs font-normal text-gray-400 max-w-full'>{mount.scope.mount.name}</span>
			</div>
		</div>
	)

	return (
		<>
			<Modal header={Header} id={`mount-${mount.scope.mount.name}`} maxWidth='410px' onHide={mount.hide}>
				<div className='mt-0 grid grid-cols-12 gap-2'>
					<div className='col-span-full flex flex-row items-center justify-between'>
						<Chip color='primary' size='sm'>
							{parking ? 'parking' : parked ? 'parked' : slewing ? 'slewing' : tracking ? 'tracking' : 'idle'}
						</Chip>
						<div className='flex flex-row items-center gap-2'>
							<Tooltip content='Remote Control' showArrow>
								<Button color='secondary' isDisabled={!connected} isIconOnly onPointerUp={mount.showRemoteControl} size='sm' variant='light'>
									<Icons.RemoteControl />
								</Button>
							</Tooltip>
							<Tooltip content='Location' showArrow>
								<Button color='danger' isDisabled={!connected || moving} isIconOnly onPointerUp={mount.showLocation} size='sm' variant='light'>
									<Icons.MapMarker />
								</Button>
							</Tooltip>
							<Tooltip content='Time' showArrow>
								<Button color='primary' isDisabled={!connected || moving} isIconOnly onPointerUp={mount.showTime} size='sm' variant='light'>
									<Icons.Clock />
								</Button>
							</Tooltip>
						</div>
					</div>
					<div className='col-span-full'>
						<CurrentPosition />
					</div>
					<div className='col-span-full'>
						<TargetCoordinateAndPosition isDisabled={!connected || moving} />
					</div>
					<Nudge className='col-span-5 row-span-2' isCancelDisabled={!canAbort || parked || !moving} isDisabled={!connected || parked} isNudgeDisabled={moving} onCancel={mount.stop} onNudge={mount.moveTo} />
					<Switch className='col-span-4 flex-col-reverse gap-0.2 justify-center max-w-none' classNames={{ label: 'text-xs ms-0' }} isDisabled={!connected || moving || parked} isSelected={tracking} onValueChange={mount.tracking}>
						Tracking
					</Switch>
					<div className='col-span-3 flex flex-row items-center justify-center gap-2'>
						<Tooltip content={parked ? 'Unpark' : 'Park'} showArrow>
							<Button color={parked ? 'success' : 'danger'} isDisabled={!connected || !canPark || moving} isIconOnly onPointerUp={mount.togglePark} variant='flat'>
								{parked ? <Icons.Play /> : <Icons.Stop />}
							</Button>
						</Tooltip>
						<Tooltip content='Home' showArrow>
							<Button color='primary' isDisabled={!connected || !canHome || moving || parked} isIconOnly onPointerUp={mount.home} variant='flat'>
								<Icons.Home />
							</Button>
						</Tooltip>
					</div>
					<TrackModeSelect className='col-span-4' isDisabled={!connected || moving || parked} modes={trackModes} onValueChange={mount.trackMode} value={trackMode} />
					<SlewRateSelect className='col-span-3' isDisabled={!connected || moving || parked} onValueChange={mount.slewRate} rates={slewRates} value={slewRate ?? ''} />
				</div>
			</Modal>
			{showLocation && <Location coordinate={geographicCoordinate} id={`location-mount-${mount.scope.mount.name}`} onClose={mount.hideLocation} onCoordinateChange={mount.location} />}
			{showTime && <Time id={`time-mount-${mount.scope.mount.name}`} onClose={mount.hideTime} onTimeChange={mount.time} time={time} />}
			{showRemoteControl && <MountRemoteControl />}
		</>
	)
})

const CurrentPosition = memo(() => {
	const mount = useMolecule(MountMolecule)
	const { rightAscension, declination, rightAscensionJ2000, declinationJ2000, azimuth, altitude, constellation, lst, meridianIn, pierSide } = useSnapshot(mount.state.currentPosition)

	return (
		<div className='w-full grid grid-cols-12 gap-2'>
			<Input className='col-span-3' isReadOnly label='RA (J2000)' size='sm' value={formatRA(rightAscensionJ2000)} />
			<Input className='col-span-3' isReadOnly label='DEC (J2000)' size='sm' value={formatDEC(declinationJ2000)} />
			<Input className='col-span-3' isReadOnly label='RA' size='sm' value={formatRA(rightAscension)} />
			<Input className='col-span-3' isReadOnly label='DEC' size='sm' value={formatDEC(declination)} />
			<Input className='col-span-3' isReadOnly label='Azimuth' size='sm' value={formatAZ(azimuth)} />
			<Input className='col-span-3' isReadOnly label='Altitude' size='sm' value={formatALT(altitude)} />
			<Input className='col-span-3' isReadOnly label='Constellation' size='sm' value={constellation} />
			<Input className='col-span-3' isReadOnly label='LST' size='sm' value={formatHMS(lst, true)} />
			<Input className='col-span-3' isReadOnly label='Meridian in' size='sm' value={formatHMS(meridianIn, true)} />
			<Input className='col-span-3' isReadOnly label='Pier' size='sm' value={pierSide} />
			<div className='col-span-5'></div>
		</div>
	)
})

interface TargetCoordinateAndPositionProps {
	readonly isDisabled?: boolean
}

const TargetCoordinateAndPosition = memo(({ isDisabled }: TargetCoordinateAndPositionProps) => {
	const mount = useMolecule(MountMolecule)
	const coordinate = useSnapshot(mount.state.targetCoordinate.coordinate, { sync: true })
	const position = useSnapshot(mount.state.targetCoordinate.position)

	return (
		<div className='w-full grid grid-cols-12 gap-2'>
			<div className='col-span-7 flex flex-col gap-0 justify-center'>
				<TargetCoordinateTypeButtonGroup buttonProps={{ className: 'flex-1' }} className='w-full' isDisabled={isDisabled} onValueChange={(value) => mount.updateTargetCoordinate('type', value)} value={coordinate.type} />
				{coordinate.type !== 'J2000' && (
					<div className='flex flex-row gap-2 items-center justify-between text-sm'>
						<div className='w-full flex flex-row items-center justify-between'>
							<span className='font-bold'>RA:</span>
							<span>{formatRA(position.rightAscensionJ2000)}</span>
						</div>
						<div className='w-full flex flex-row items-center justify-between'>
							<span className='font-bold'>DEC:</span>
							<span>{formatDEC(position.declinationJ2000)}</span>
						</div>
					</div>
				)}
				{coordinate.type !== 'JNOW' && (
					<div className='flex flex-row gap-2 items-center justify-between text-sm'>
						<div className='w-full flex flex-row items-center justify-between'>
							<span className='font-bold'>RA:</span>
							<span>{formatRA(position.rightAscension)}</span>
						</div>
						<div className='w-full flex flex-row items-center justify-between'>
							<span className='font-bold'>DEC:</span>
							<span>{formatDEC(position.declination)}</span>
						</div>
					</div>
				)}
				{coordinate.type !== 'ALTAZ' && (
					<div className='flex flex-row gap-2 items-center justify-between text-sm'>
						<div className='w-full flex flex-row items-center justify-between'>
							<span className='font-bold'>AZ:</span>
							<span>{formatAZ(position.azimuth)}</span>
						</div>
						<div className='w-full flex flex-row items-center justify-between'>
							<span className='font-bold'>ALT:</span>
							<span>{formatALT(position.altitude)}</span>
						</div>
					</div>
				)}
			</div>
			<div className='col-span-5 text-sm flex flex-col justify-end gap-0'>
				<div className='flex flex-row items-center justify-between'>
					<span className='font-bold'>CONST:</span>
					<span>{position.constellation}</span>
				</div>
				<div className='flex flex-row items-center justify-between'>
					<span className='font-bold'>MERIDIAN IN:</span>
					<span>{formatHMS(position.meridianIn, true)}</span>
				</div>
				<div className='flex flex-row items-center justify-between'>
					<span className='font-bold'>PIER:</span>
					<span>{position.pierSide}</span>
				</div>
			</div>
			{coordinate.type !== 'ALTAZ' && <Input className='col-span-4' isDisabled={isDisabled} label='RA' onValueChange={(value) => mount.updateTargetCoordinate('rightAscension', value)} size='sm' value={coordinate.rightAscension} />}
			{coordinate.type !== 'ALTAZ' && <Input className='col-span-4' isDisabled={isDisabled} label='DEC' onValueChange={(value) => mount.updateTargetCoordinate('declination', value)} size='sm' value={coordinate.declination} />}
			{coordinate.type === 'ALTAZ' && <Input className='col-span-4' isDisabled={isDisabled} label='AZ' onValueChange={(value) => mount.updateTargetCoordinate('azimuth', value)} size='sm' value={coordinate.azimuth} />}
			{coordinate.type === 'ALTAZ' && <Input className='col-span-4' isDisabled={isDisabled} label='ALT' onValueChange={(value) => mount.updateTargetCoordinate('altitude', value)} size='sm' value={coordinate.altitude} />}
			<DropdownButton
				buttonProps={{ className: 'w-full h-full', color: 'primary', isDisabled: isDisabled, onPointerUp: mount.handleTargetCoordinateAction }}
				className='col-span-4'
				dropdownButtonProps={{ className: 'h-full', isDisabled: isDisabled }}
				label={<TargetCoordinateDropdownButtonLabel action={coordinate.action} />}
				onValueChange={(value) => mount.updateTargetCoordinate('action', value)}
				size='sm'
				value={coordinate.action}>
				<DropdownItem key='GOTO' startContent={<Icons.Telescope />}>
					Go To
				</DropdownItem>
				<DropdownItem key='SYNC' startContent={<Icons.Sync />}>
					Sync
				</DropdownItem>
				<DropdownItem key='FRAME' startContent={<Icons.Image />}>
					Frame
				</DropdownItem>
			</DropdownButton>
		</div>
	)
})

interface TargetCoordinateDropdownButtonLabelProps {
	readonly action: TargetCoordinateAction
}

function TargetCoordinateDropdownButtonLabel({ action }: TargetCoordinateDropdownButtonLabelProps) {
	return (
		<div className='flex items-center gap-1 text-medium'>
			{action === 'SYNC' ? <Icons.Sync /> : action === 'FRAME' ? <Icons.Image /> : <Icons.Telescope />}
			{action === 'SYNC' ? 'Sync' : action === 'FRAME' ? 'Frame' : 'Go To'}
		</div>
	)
}
