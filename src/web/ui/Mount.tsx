import { Button, Chip, DropdownItem, Input, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, Switch, Tooltip } from '@heroui/react'
import * as Tabler from '@tabler/icons-react'
import { useMolecule } from 'bunshi/react'
import * as Lucide from 'lucide-react'
import { formatALT, formatAZ, formatDEC, formatRA } from 'nebulosa/src/angle'
import { memo, useMemo } from 'react'
import { useSnapshot } from 'valtio'
import { EquipmentMolecule } from '@/molecules/indi/equipment'
import { MountMolecule, type MountState } from '@/molecules/indi/mount'
import { useModal } from '@/shared/hooks'
import { ConnectButton } from './ConnectButton'
import { DropdownButton } from './DropdownButton'
import { Location } from './Location'
import { Nudge } from './Nudge'
import { SlewRateSelect } from './SlewRateSelect'
import { TargetCoordinateTypeButtonGroup } from './TargetCoordinateTypeButtonGroup'
import { TrackModeSelect } from './TrackModeSelect'

export const Mount = memo(() => {
	const equipment = useMolecule(EquipmentMolecule)
	const mount = useMolecule(MountMolecule)
	// biome-ignore format: don't break lines!
	const { mount: { connected, tracking, slewing, parking, parked, trackModes, trackMode, slewRates, slewRate, canAbort, canPark, canHome, equatorialCoordinate, geographicCoordinate }, connecting, targetCoordinate, currentCoordinate, location } = useSnapshot(mount.state)
	const modal = useModal(() => equipment.closeModal('mount', mount.scope.mount))
	const moving = useMemo(() => slewing || parking, [slewing, parking])

	return (
		<>
			<Modal {...modal.props} classNames={{ base: 'min-w-[410px] max-h-[90vh]', wrapper: 'pointer-events-none' }}>
				<ModalContent>
					{() => (
						<>
							<ModalHeader {...modal.moveProps} className='flex flex-row gap-0 items-center'>
								<ConnectButton isConnected={connected} isDisabled={moving} isLoading={connecting} onPointerUp={mount.connectOrDisconnect} />
								<div className='flex flex-col flex-1 gap-0 justify-center items-center'>
									<span className='leading-5'>Mount</span>
									<span className='text-xs font-normal text-gray-400'>{mount.scope.mount.name}</span>
								</div>
								<div className='flex flex-row items-center gap-2 me-6'></div>
							</ModalHeader>
							<ModalBody>
								<div className='mt-0 grid grid-cols-12 gap-2'>
									<div className='col-span-full flex flex-row items-center justify-between'>
										<Chip color='primary' size='sm'>
											{parking ? 'parking' : parked ? 'parked' : slewing ? 'slewing' : tracking ? 'tracking' : 'idle'}
										</Chip>
										<div className='flex flex-row items-center gap-2'>
											<Tooltip content='Location'>
												<Button color='danger' isDisabled={!connected || moving} isIconOnly onPointerUp={() => mount.toggleLocationModal()} size='sm' variant='light'>
													<Tabler.IconMapPinFilled size={18} />
												</Button>
											</Tooltip>
										</div>
									</div>
									<Input className='col-span-3' isReadOnly label='RA (J2000)' size='sm' value={formatRA(currentCoordinate.rightAscensionJ2000)} />
									<Input className='col-span-3' isReadOnly label='DEC (J2000)' size='sm' value={formatDEC(currentCoordinate.declinationJ2000)} />
									<Input className='col-span-3' isReadOnly label='RA' size='sm' value={formatRA(equatorialCoordinate.rightAscension)} />
									<Input className='col-span-3' isReadOnly label='DEC' size='sm' value={formatDEC(equatorialCoordinate.declination)} />
									<Input className='col-span-3' isReadOnly label='Azimuth' size='sm' value={formatAZ(currentCoordinate.azimuth)} />
									<Input className='col-span-3' isReadOnly label='Altitude' size='sm' value={formatALT(currentCoordinate.altitude)} />
									<Input className='col-span-3' isReadOnly label='Constellation' size='sm' value={currentCoordinate.constellation} />
									<Input className='col-span-3' isReadOnly label='LST' size='sm' value={currentCoordinate.lst} />
									<Input className='col-span-4' isReadOnly label='Meridian at' size='sm' value={currentCoordinate.meridianAt} />
									<Input className='col-span-3' isReadOnly label='Pier' size='sm' value={currentCoordinate.pierSide} />
									<div className='col-span-5'></div>
									<div className='col-span-8 flex flex-col gap-1 justify-between'>
										<TargetCoordinateTypeButtonGroup className='w-full' isDisabled={!connected || moving} onValueChange={(value) => mount.updateTargetCoordinate('type', value)} value={targetCoordinate.type} />
										<div className='flex flex-row gap-2 items-center justify-between text-sm'>
											<div className='w-full flex flex-row items-center justify-between'>
												<span className='font-bold'>AZ:</span>
												<span>000 00 00</span>
											</div>
											<div className='w-full flex flex-row items-center justify-between'>
												<span className='font-bold'>ALT:</span>
												<span>+00 00 00</span>
											</div>
										</div>
									</div>
									<div className='col-span-4 text-sm'>
										<div className='flex flex-row items-center justify-between'>
											<span className='font-bold'>CONST:</span>
											<span>AND</span>
										</div>
										<div className='flex flex-row items-center justify-between'>
											<span className='font-bold'>MERIDIAN AT:</span>
											<span>00:00</span>
										</div>
										<div className='flex flex-row items-center justify-between'>
											<span className='font-bold'>PIER:</span>
											<span>NEITHER</span>
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
										<DropdownItem key='goto' startContent={<Lucide.Telescope size={18} />}>
											Go To
										</DropdownItem>
										<DropdownItem key='slew' startContent={<Lucide.Telescope size={18} />}>
											Slew
										</DropdownItem>
										<DropdownItem key='sync' startContent={<Lucide.RefreshCw size={18} />}>
											Sync
										</DropdownItem>
										<DropdownItem key='frame' startContent={<Lucide.Image size={18} />}>
											Frame
										</DropdownItem>
									</DropdownButton>
									<Nudge className='col-span-5 row-span-2' isCancelDisabled={!canAbort || parked} isDisabled={!connected || moving || parked} onCancel={mount.stop} onNudge={mount.moveTo} />
									<Switch className='col-span-4 flex-col-reverse gap-0.2 justify-center max-w-none' classNames={{ label: 'text-xs ms-0' }} isDisabled={!connected || moving || parked} isSelected={tracking} onValueChange={(value) => mount.tracking(value)}>
										Tracking
									</Switch>
									<div className='col-span-3 flex flex-row items-center justify-center gap-2'>
										<Tooltip content={parked ? 'Unpark' : 'Park'}>
											<Button color={parked ? 'success' : 'danger'} isDisabled={!connected || !canPark || moving} isIconOnly onPointerUp={mount.togglePark} variant='flat'>
												{parked ? <Lucide.Play size={18} /> : <Tabler.IconPlayerStopFilled size={18} />}
											</Button>
										</Tooltip>
										<Tooltip content='Home'>
											<Button color='primary' isDisabled={!connected || !canHome || moving || parked} isIconOnly onPointerUp={mount.home} variant='flat'>
												<Lucide.Home size={18} />
											</Button>
										</Tooltip>
									</div>
									<TrackModeSelect className='col-span-4' isDisabled={!connected || moving || parked} modes={trackModes} onValueChange={(value) => mount.trackMode(value)} value={trackMode} />
									<SlewRateSelect className='col-span-3' isDisabled={!connected || moving || parked} onValueChange={(value) => mount.slewRate(value)} rates={slewRates} value={slewRate ?? ''} />
								</div>
							</ModalBody>
							<ModalFooter {...modal.moveProps}></ModalFooter>
						</>
					)}
				</ModalContent>
			</Modal>
			{location.showModal && <Location initialPosition={geographicCoordinate} onClose={() => mount.toggleLocationModal(false)} onPositionChange={mount.location} />}
		</>
	)
})

export interface TargetCoordinateDropdownButtonLabelProps {
	readonly action: MountState['targetCoordinate']['action']
}

const TARGET_COORDINATE_DROPDOWN_BUTTON_LABELS_AND_ICONS = {
	goto: { label: 'Go To', icon: Lucide.Telescope },
	slew: { label: 'Slew', icon: Lucide.Telescope },
	sync: { label: 'Sync', icon: Lucide.RefreshCw },
	frame: { label: 'Frame', icon: Lucide.Image },
} as const

export function TargetCoordinateDropdownButtonLabel({ action }: TargetCoordinateDropdownButtonLabelProps) {
	const label = useMemo(() => TARGET_COORDINATE_DROPDOWN_BUTTON_LABELS_AND_ICONS[action]?.label, [action])
	const Icon = useMemo(() => TARGET_COORDINATE_DROPDOWN_BUTTON_LABELS_AND_ICONS[action]?.icon, [action])

	return (
		<div className='flex items-center gap-1 text-medium'>
			{Icon && <Icon size={18} />} {label}
		</div>
	)
}
