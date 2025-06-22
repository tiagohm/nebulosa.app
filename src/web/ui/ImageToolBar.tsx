import { Button, Popover, PopoverContent, PopoverTrigger, Switch, Tooltip } from '@heroui/react'
import * as Tabler from '@tabler/icons-react'
import { useMolecule } from 'bunshi/react'
import * as Lucide from 'lucide-react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { ImageViewerMolecule } from '@/shared/molecules'
import { ToggleButton } from './ToggleButton'

export const ImageToolBar = memo(() => {
	const viewer = useMolecule(ImageViewerMolecule)
	const { transformation, crosshair, info, starDetection } = useSnapshot(viewer.state)

	return (
		<>
			<div className='w-full fixed bottom-0 mb-1 p-1 z-[99999]'>
				<div className='flex flex-row items-center justify-start gap-2 px-2 py-1.5 mx-auto w-fit rounded-xl bg-black max-w-full overflow-scroll no-scrollbar'>
					<Tooltip content='Save' placement='top'>
						<Button color='secondary' isIconOnly variant='flat'>
							<Lucide.Save />
						</Button>
					</Tooltip>
					<Tooltip content='Plate Solver' placement='top'>
						<Button color='secondary' isIconOnly onPointerUp={() => viewer.showModal('plateSolver')} variant='flat'>
							<Lucide.Sigma />
						</Button>
					</Tooltip>
					<Tooltip content='Stretch' placement='top'>
						<Button color='secondary' isIconOnly onPointerUp={() => viewer.showModal('stretch')} variant='flat'>
							<Tabler.IconChartCandle transform='rotate(90)' />
						</Button>
					</Tooltip>
					<Tooltip content='Auto Stretch' placement='top'>
						<ToggleButton color='primary' isSelected={transformation.stretch.auto} onPointerUp={() => viewer.toggleAutoStretch()}>
							<Lucide.WandSparkles />
						</ToggleButton>
					</Tooltip>
					{info.metadata.bayer && info.metadata.channels === 1 && (
						<Tooltip content='Debayer' placement='top'>
							<ToggleButton color='primary' isSelected={transformation.debayer} onPointerUp={() => viewer.toggleDebayer()}>
								<Lucide.Grid3X3 />
							</ToggleButton>
						</Tooltip>
					)}
					<Tooltip content='Rotate' placement='top'>
						<Button color='secondary' isIconOnly variant='flat'>
							<Tabler.IconRotateClockwise2 />
						</Button>
					</Tooltip>
					<Popover placement='bottom' showArrow>
						<PopoverTrigger>
							<Button color='success' isIconOnly variant='flat'>
								<Lucide.Palette />
							</Button>
						</PopoverTrigger>
						<PopoverContent>
							<div className='flex flex-row items-center justify-center gap-2 p-2'>
								{!info.mono && (
									<Tooltip content='SCNR' placement='top'>
										<Button color='secondary' isIconOnly onPointerUp={() => viewer.showModal('scnr')} variant='flat'>
											<Lucide.Blend />
										</Button>
									</Tooltip>
								)}
								<Tooltip content='Adjustment' placement='top'>
									<Button color='secondary' isIconOnly onPointerUp={() => viewer.showModal('adjustment')} variant='flat'>
										<Lucide.Wand />
									</Button>
								</Tooltip>
								<Tooltip content='Filter' placement='top'>
									<Button color='secondary' isIconOnly onPointerUp={() => viewer.showModal('filter')} variant='flat'>
										<Tabler.IconFilters />
									</Button>
								</Tooltip>
								<Tooltip content='Horizontal mirror' placement='top'>
									<ToggleButton color='primary' isSelected={transformation.horizontalMirror} onPointerUp={() => viewer.toggleHorizontalMirror()}>
										<Lucide.FlipHorizontal />
									</ToggleButton>
								</Tooltip>
								<Tooltip content='Vertical Mirror' placement='top'>
									<ToggleButton color='primary' isSelected={transformation.verticalMirror} onPointerUp={() => viewer.toggleVerticalMirror()}>
										<Lucide.FlipVertical />
									</ToggleButton>
								</Tooltip>
								<Tooltip content='Invert' placement='top'>
									<ToggleButton color='primary' isSelected={transformation.invert} onPointerUp={() => viewer.toggleInvert()}>
										<Tabler.IconContrastFilled />
									</ToggleButton>
								</Tooltip>
							</div>
						</PopoverContent>
					</Popover>
					<Popover placement='bottom' showArrow>
						<PopoverTrigger>
							<Button color='success' isIconOnly variant='flat'>
								<Lucide.BringToFront />
							</Button>
						</PopoverTrigger>
						<PopoverContent>
							<div className='flex flex-row justify-center items-start gap-2 p-2'>
								<Tooltip content='Crosshair' placement='top'>
									<ToggleButton color='primary' isSelected={crosshair} onPointerUp={() => viewer.toggleCrosshair()}>
										<Lucide.Crosshair />
									</ToggleButton>
								</Tooltip>
								<Tooltip content='Annotatation' placement='top'>
									<Button color='secondary' isIconOnly variant='flat'>
										<Lucide.Pen />
									</Button>
								</Tooltip>
								<div className='flex flex-col gap-2 justify-center'>
									<Tooltip content='Star Detection' placement='top'>
										<Button color='secondary' isIconOnly onPointerUp={() => viewer.showModal('starDetection')} variant='flat'>
											<Lucide.Stars />
										</Button>
									</Tooltip>
									{starDetection.stars.length > 0 && <Switch isSelected={starDetection.show} onValueChange={(value) => (viewer.state.starDetection.show = value)} size='sm' />}
								</div>
								<Tooltip content='ROI' placement='top'>
									<Button color='secondary' isIconOnly variant='flat'>
										<Lucide.Crop />
									</Button>
								</Tooltip>
								<Tooltip content='FOV' placement='top'>
									<Button color='secondary' isIconOnly variant='flat'>
										<Lucide.Scan />
									</Button>
								</Tooltip>
							</div>
						</PopoverContent>
					</Popover>
					<Tooltip content='Statistics' placement='top'>
						<Button color='secondary' isIconOnly variant='flat'>
							<Tabler.IconChartColumn />
						</Button>
					</Tooltip>
					<Tooltip content='FITS Header' placement='top'>
						<Button color='secondary' isIconOnly onPointerUp={() => viewer.showModal('fitsHeader')} variant='flat'>
							<Tabler.IconAlignJustified />
						</Button>
					</Tooltip>
					<Tooltip content='Mouse Coordinate' placement='top'>
						<Button color='secondary' isIconOnly variant='flat'>
							<Lucide.MousePointerClick />
						</Button>
					</Tooltip>
					<Tooltip content='Settings' placement='top'>
						<Button color='secondary' isIconOnly onPointerUp={() => viewer.showModal('settings')} variant='flat'>
							<Lucide.Settings />
						</Button>
					</Tooltip>
					<Tooltip content='Close' placement='top'>
						<Button className='ms-2' color='danger' isIconOnly onPointerUp={() => viewer.remove()} variant='solid'>
							<Lucide.X />
						</Button>
					</Tooltip>
				</div>
			</div>
		</>
	)
})
