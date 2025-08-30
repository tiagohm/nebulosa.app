import { Button, Chip, DropdownItem, Input, Switch, Tooltip } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { formatALT, formatAZ, formatDEC, formatRA } from 'nebulosa/src/angle'
import { memo, useMemo } from 'react'
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
	const { connecting, currentPosition, location: { show: showLocation }, time: { show: showTime }, remoteControl: { show: showRemoteControl }, targetCoordinate: { position: targetPosition } } = useSnapshot(mount.state)
	const { connected, parking, parked, slewing, tracking, canPark, canHome, canAbort, trackModes, trackMode, slewRates, slewRate, equatorialCoordinate, geographicCoordinate, time } = useSnapshot(mount.state.mount)
	const targetCoordinate = useSnapshot(mount.state.targetCoordinate.coordinate, { sync: true })
	const moving = useMemo(() => slewing || parking, [slewing, parking])

	return (
		<>
			<Modal
				header={
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
				}
				maxWidth='400px'
				name={`mount-${mount.scope.mount.name}`}
				onClose={mount.close}>
				<div className='mt-0 grid grid-cols-12 gap-2'>
					<div className='col-span-full flex flex-row items-center justify-between'>
						<Chip color='primary' size='sm'>
							{parking ? 'parking' : parked ? 'parked' : slewing ? 'slewing' : tracking ? 'tracking' : 'idle'}
						</Chip>
						<div className='flex flex-row items-center gap-2'>
							<Tooltip content='Remote Control'>
								<Button color='secondary' isDisabled={!connected} isIconOnly onPointerUp={mount.showRemoteControl} size='sm' variant='light'>
									<Icons.RemoteControl />
								</Button>
							</Tooltip>
							<Tooltip content='Location'>
								<Button color='danger' isDisabled={!connected || moving} isIconOnly onPointerUp={mount.showLocation} size='sm' variant='light'>
									<Icons.MapMarker />
								</Button>
							</Tooltip>
							<Tooltip content='Time'>
								<Button color='primary' isDisabled={!connected || moving} isIconOnly onPointerUp={mount.showTime} size='sm' variant='light'>
									<Icons.Clock />
								</Button>
							</Tooltip>
						</div>
					</div>
					<Input className='col-span-3' isReadOnly label='RA (J2000)' size='sm' value={formatRA(currentPosition.rightAscensionJ2000)} />
					<Input className='col-span-3' isReadOnly label='DEC (J2000)' size='sm' value={formatDEC(currentPosition.declinationJ2000)} />
					<Input className='col-span-3' isReadOnly label='RA' size='sm' value={formatRA(equatorialCoordinate.rightAscension)} />
					<Input className='col-span-3' isReadOnly label='DEC' size='sm' value={formatDEC(equatorialCoordinate.declination)} />
					<Input className='col-span-3' isReadOnly label='Azimuth' size='sm' value={formatAZ(currentPosition.azimuth)} />
					<Input className='col-span-3' isReadOnly label='Altitude' size='sm' value={formatALT(currentPosition.altitude)} />
					<Input className='col-span-3' isReadOnly label='Constellation' size='sm' value={currentPosition.constellation} />
					<Input className='col-span-3' isReadOnly label='LST' size='sm' value={currentPosition.lst.substring(0, 5)} />
					<Input className='col-span-3' isReadOnly label='Meridian at' size='sm' value={currentPosition.meridianAt} />
					<Input className='col-span-3' isReadOnly label='Pier' size='sm' value={currentPosition.pierSide} />
					<div className='col-span-5'></div>
					<div className='col-span-8 flex flex-col gap-1 justify-between'>
						<TargetCoordinateTypeButtonGroup buttonProps={{ className: 'flex-1' }} className='w-full' isDisabled={!connected || moving} onValueChange={(value) => mount.updateTargetCoordinate('type', value)} value={targetCoordinate.type} />
						<div className='flex flex-row gap-2 items-center justify-between text-sm'>
							<div className='w-full flex flex-row items-center justify-between'>
								<span className='font-bold'>AZ:</span>
								<span>{formatAZ(targetPosition.azimuth)}</span>
							</div>
							<div className='w-full flex flex-row items-center justify-between'>
								<span className='font-bold'>ALT:</span>
								<span>{formatALT(targetPosition.altitude)}</span>
							</div>
						</div>
					</div>
					<div className='col-span-4 text-sm'>
						<div className='flex flex-row items-center justify-between'>
							<span className='font-bold'>CONST:</span>
							<span>{targetPosition.constellation}</span>
						</div>
						<div className='flex flex-row items-center justify-between'>
							<span className='font-bold'>MERIDIAN AT:</span>
							<span>{targetPosition.meridianAt}</span>
						</div>
						<div className='flex flex-row items-center justify-between'>
							<span className='font-bold'>PIER:</span>
							<span>{targetPosition.pierSide}</span>
						</div>
					</div>
					<Input className='col-span-4' isDisabled={!connected || moving} label='RA' onValueChange={(value) => mount.updateTargetCoordinate('rightAscension', value)} size='sm' value={targetCoordinate.rightAscension} />
					<Input className='col-span-4' isDisabled={!connected || moving} label='DEC' onValueChange={(value) => mount.updateTargetCoordinate('declination', value)} size='sm' value={targetCoordinate.declination} />
					<DropdownButton
						buttonProps={{ className: 'w-full h-full', color: 'primary', isDisabled: !connected || moving || parked, onPointerUp: mount.handleTargetCoordinateAction }}
						className='col-span-4'
						dropdownButtonProps={{ className: 'h-full', isDisabled: !connected || moving }}
						label={<TargetCoordinateDropdownButtonLabel action={targetCoordinate.action} />}
						onValueChange={(value) => mount.updateTargetCoordinate('action', value)}
						size='sm'
						value={targetCoordinate.action}>
						<DropdownItem key='GOTO' startContent={<Icons.Telescope />}>
							Go To
						</DropdownItem>
						<DropdownItem key='SLEW' startContent={<Icons.Telescope />}>
							Slew
						</DropdownItem>
						<DropdownItem key='SYNC' startContent={<Icons.Sync />}>
							Sync
						</DropdownItem>
						<DropdownItem key='FRAME' startContent={<Icons.Image />}>
							Frame
						</DropdownItem>
					</DropdownButton>
					<Nudge className='col-span-5 row-span-2' isCancelDisabled={!canAbort || parked || !moving} isDisabled={!connected || parked} isNudgeDisabled={moving} onCancel={mount.stop} onNudge={mount.moveTo} />
					<Switch className='col-span-4 flex-col-reverse gap-0.2 justify-center max-w-none' classNames={{ label: 'text-xs ms-0' }} isDisabled={!connected || moving || parked} isSelected={tracking} onValueChange={(value) => mount.tracking(value)}>
						Tracking
					</Switch>
					<div className='col-span-3 flex flex-row items-center justify-center gap-2'>
						<Tooltip content={parked ? 'Unpark' : 'Park'}>
							<Button color={parked ? 'success' : 'danger'} isDisabled={!connected || !canPark || moving} isIconOnly onPointerUp={mount.togglePark} variant='flat'>
								{parked ? <Icons.Play /> : <Icons.Stop />}
							</Button>
						</Tooltip>
						<Tooltip content='Home'>
							<Button color='primary' isDisabled={!connected || !canHome || moving || parked} isIconOnly onPointerUp={mount.home} variant='flat'>
								<Icons.Home />
							</Button>
						</Tooltip>
					</div>
					<TrackModeSelect className='col-span-4' isDisabled={!connected || moving || parked} modes={trackModes} onValueChange={(value) => mount.trackMode(value)} value={trackMode} />
					<SlewRateSelect className='col-span-3' isDisabled={!connected || moving || parked} onValueChange={(value) => mount.slewRate(value)} rates={slewRates} value={slewRate ?? ''} />
				</div>
			</Modal>
			{showLocation && <Location coordinate={geographicCoordinate} name={`location-mount-${mount.scope.mount.name}`} onClose={mount.closeLocation} onCoordinateChange={mount.location} />}
			{showTime && <Time name={`time-mount-${mount.scope.mount.name}`} onClose={mount.closeTime} onTimeChange={mount.time} time={time} />}
			{showRemoteControl && <MountRemoteControl />}
		</>
	)
})

export interface TargetCoordinateDropdownButtonLabelProps {
	readonly action: TargetCoordinateAction
}

export function TargetCoordinateDropdownButtonLabel({ action }: TargetCoordinateDropdownButtonLabelProps) {
	return (
		<div className='flex items-center gap-1 text-medium'>
			{action === 'SYNC' ? <Icons.Sync /> : action === 'FRAME' ? <Icons.Image /> : <Icons.Telescope />}
			{action === 'SYNC' ? 'Sync' : action === 'FRAME' ? 'Frame' : action === 'SLEW' ? 'Slew' : 'Go To'}
		</div>
	)
}
