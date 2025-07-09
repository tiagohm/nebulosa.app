import { Button, Chip, Input, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, Switch, Tooltip } from '@heroui/react'
import * as Tabler from '@tabler/icons-react'
import { useMolecule } from 'bunshi/react'
import * as Lucide from 'lucide-react'
import { formatDEC, formatRA } from 'nebulosa/src/angle'
import { memo, useMemo } from 'react'
import { useSnapshot } from 'valtio'
import { EquipmentMolecule } from '@/molecules/indi/equipment'
import { MountMolecule } from '@/molecules/indi/mount'
import { useModal } from '@/shared/hooks'
import { ConnectButton } from './ConnectButton'
import { Nudge } from './Nudge'
import { SlewRateSelect } from './SlewRateSelect'
import { TargetCoordinateTypeButtonGroup } from './TargetCoordinateTypeButtonGroup'
import { TrackModeSelect } from './TrackModeSelect'

export const Mount = memo(() => {
	const equipment = useMolecule(EquipmentMolecule)
	const mount = useMolecule(MountMolecule)
	// biome-ignore format: don't break lines!
	const { mount: { connected, tracking, slewing, parking, parked, trackModes, trackMode, slewRates, slewRate, canAbort, canPark, canHome, equatorialCoordinate }, connecting, targetCoordinate } = useSnapshot(mount.state)
	const modal = useModal(() => equipment.closeModal('mount', mount.scope.mount))
	const moving = useMemo(() => slewing || parking, [slewing, parking])

	return (
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
								<div className='col-span-full flex flex-row items-center'>
									<Chip color='primary' size='sm'>
										{parking ? 'parking' : parked ? 'parked' : slewing ? 'slewing' : tracking ? 'tracking' : 'idle'}
									</Chip>
								</div>
								<Input className='col-span-3' isReadOnly label='RA (J2000)' size='sm' value='00 00 00' />
								<Input className='col-span-3' isReadOnly label='DEC (J2000)' size='sm' value='00 00 00' />
								<Input className='col-span-3' isReadOnly label='RA' size='sm' value={formatRA(equatorialCoordinate.rightAscension)} />
								<Input className='col-span-3' isReadOnly label='DEC' size='sm' value={formatDEC(equatorialCoordinate.declination)} />
								<Input className='col-span-3' isReadOnly label='Azimuth' size='sm' value='00 00 00' />
								<Input className='col-span-3' isReadOnly label='Altitude' size='sm' value='00 00 00' />
								<Input className='col-span-3' isReadOnly label='Constellation' size='sm' value='AND' />
								<Input className='col-span-3' isReadOnly label='LST' size='sm' value='00:00' />
								<Input className='col-span-4' isReadOnly label='Meridian at' size='sm' value='00:00 (-12:00)' />
								<Input className='col-span-3' isReadOnly label='Pier' size='sm' value='NEITHER' />
								<div className='col-span-5'></div>
								<TargetCoordinateTypeButtonGroup className='col-span-5' isDisabled={!connected || moving} onValueChange={(value) => mount.updateTargetCoordinate('type', value)} value={targetCoordinate.type} />
								<div className='col-span-3 text-sm'>
									<div className='flex flex-row items-center justify-between'>
										<span className='font-bold'>AZ:</span>
										<span>000 00 00</span>
									</div>
									<div className='flex flex-row items-center justify-between'>
										<span className='font-bold'>ALT:</span>
										<span>+00 00 00</span>
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
								<Nudge className='col-span-5 row-span-2' isCancelDisabled={!canAbort} isDisabled={!connected || moving} onNudge={(dir, down) => console.info(dir, down)} />
								<Switch className='col-span-4 flex-col-reverse gap-0.2 justify-center max-w-none' classNames={{ label: 'text-xs ms-0' }} isDisabled={!connected || moving} isSelected={tracking} onValueChange={(value) => mount.tracking(value)}>
									Tracking
								</Switch>
								<div className='col-span-3 flex flex-row items-center justify-center gap-2'>
									<Tooltip content={parked ? 'Unpark' : 'Park'}>
										<Button color={parked ? 'success' : 'danger'} isDisabled={!connected || !canPark || moving} isIconOnly onPointerUp={mount.togglePark} variant='flat'>
											{parked ? <Lucide.Play size={16} /> : <Tabler.IconPlayerStopFilled size={16} />}
										</Button>
									</Tooltip>
									<Tooltip content='Home'>
										<Button color='primary' isDisabled={!connected || !canHome || moving} isIconOnly onPointerUp={mount.home} variant='flat'>
											<Lucide.Home size={16} />
										</Button>
									</Tooltip>
								</div>
								<TrackModeSelect className='col-span-4' isDisabled={!connected || moving} modes={trackModes} onValueChange={(value) => mount.trackMode(value)} value={trackMode} />
								<SlewRateSelect className='col-span-3' isDisabled={!connected || moving} onValueChange={(value) => mount.slewRate(value)} rates={slewRates} value={slewRate ?? ''} />
							</div>
						</ModalBody>
						<ModalFooter {...modal.moveProps}></ModalFooter>
					</>
				)}
			</ModalContent>
		</Modal>
	)
})
