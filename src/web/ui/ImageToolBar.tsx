import { Button, Popover, PopoverContent, PopoverTrigger, Switch, Tooltip } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { ImageViewerMolecule } from '@/molecules/image/viewer'
import { Icons } from './Icon'
import { ToggleButton } from './ToggleButton'

export const ImageToolBar = memo(() => {
	const viewer = useMolecule(ImageViewerMolecule)
	const { transformation, crosshair, info, starDetection } = useSnapshot(viewer.state)

	return (
		<div className='w-full fixed bottom-0 mb-1 p-1 z-[99999]'>
			<div className='flex flex-row items-center justify-start gap-2 px-2 py-1.5 mx-auto w-fit rounded-xl bg-black max-w-full overflow-scroll no-scrollbar'>
				<Tooltip content='Save' placement='top'>
					<Button color='secondary' isIconOnly variant='flat'>
						<Icons.Save />
					</Button>
				</Tooltip>
				<Tooltip content='Plate Solver' placement='top'>
					<Button color='secondary' isIconOnly onPointerUp={() => viewer.show('plateSolver')} variant='flat'>
						<Icons.Sigma />
					</Button>
				</Tooltip>
				<Tooltip content='Stretch' placement='top'>
					<Button color='secondary' isIconOnly onPointerUp={() => viewer.show('stretch')} variant='flat'>
						<Icons.Tune />
					</Button>
				</Tooltip>
				<Tooltip content='Auto Stretch' placement='top'>
					<ToggleButton color='primary' isSelected={transformation.stretch.auto} onPointerUp={viewer.toggleAutoStretch}>
						<Icons.WandSparkles />
					</ToggleButton>
				</Tooltip>
				{info.metadata.bayer && info.metadata.channels === 1 && (
					<Tooltip content='Debayer' placement='top'>
						<ToggleButton color='primary' isSelected={transformation.debayer} onPointerUp={viewer.toggleDebayer}>
							<Icons.Grid />
						</ToggleButton>
					</Tooltip>
				)}
				<Popover placement='bottom' showArrow>
					<PopoverTrigger>
						<Button color='success' isIconOnly variant='flat'>
							<Icons.Palette />
						</Button>
					</PopoverTrigger>
					<PopoverContent>
						<div className='flex flex-row items-center justify-center gap-2 p-2'>
							{!info.mono && (
								<Tooltip content='SCNR' placement='top'>
									<Button color='secondary' isIconOnly onPointerUp={() => viewer.show('scnr')} variant='flat'>
										<Icons.Swatch />
									</Button>
								</Tooltip>
							)}
							<Tooltip content='Adjustment' placement='top'>
								<Button color='secondary' isIconOnly onPointerUp={() => viewer.show('adjustment')} variant='flat'>
									<Icons.ImageEdit />
								</Button>
							</Tooltip>
							<Tooltip content='Filter' placement='top'>
								<Button color='secondary' isIconOnly onPointerUp={() => viewer.show('filter')} variant='flat'>
									<Icons.Brush />
								</Button>
							</Tooltip>
							<Tooltip content='Horizontal mirror' placement='top'>
								<ToggleButton color='primary' isSelected={transformation.horizontalMirror} onPointerUp={viewer.toggleHorizontalMirror}>
									<Icons.FlipHorizontal />
								</ToggleButton>
							</Tooltip>
							<Tooltip content='Vertical Mirror' placement='top'>
								<ToggleButton color='primary' isSelected={transformation.verticalMirror} onPointerUp={viewer.toggleVerticalMirror}>
									<Icons.FlipVertical />
								</ToggleButton>
							</Tooltip>
							<Tooltip content='Invert' placement='top'>
								<ToggleButton color='primary' isSelected={transformation.invert} onPointerUp={viewer.toggleInvert}>
									<Icons.InvertColor />
								</ToggleButton>
							</Tooltip>
						</div>
					</PopoverContent>
				</Popover>
				<Popover placement='bottom' showArrow>
					<PopoverTrigger>
						<Button color='success' isIconOnly variant='flat'>
							<Icons.BringToFront />
						</Button>
					</PopoverTrigger>
					<PopoverContent>
						<div className='flex flex-row justify-center items-start gap-2 p-2'>
							<Tooltip content='Crosshair' placement='top'>
								<ToggleButton color='primary' isSelected={crosshair} onPointerUp={viewer.toggleCrosshair}>
									<Icons.Crosshair />
								</ToggleButton>
							</Tooltip>
							<Tooltip content='Annotation' placement='top'>
								<Button color='secondary' isIconOnly variant='flat'>
									<Icons.Pen />
								</Button>
							</Tooltip>
							<div className='flex flex-col gap-2 justify-center'>
								<Tooltip content='Star Detection' placement='top'>
									<Button color='secondary' isIconOnly onPointerUp={() => viewer.show('starDetection')} variant='flat'>
										<Icons.Stars />
									</Button>
								</Tooltip>
								{starDetection.stars.length > 0 && <Switch isSelected={starDetection.show} onValueChange={(value) => (viewer.state.starDetection.show = value)} size='sm' />}
							</div>
							<Tooltip content='ROI' placement='top'>
								<Button color='secondary' isIconOnly variant='flat'>
									<Icons.Box />
								</Button>
							</Tooltip>
							<Tooltip content='FOV' placement='top'>
								<Button color='secondary' isIconOnly variant='flat'>
									<Icons.Fullscreen />
								</Button>
							</Tooltip>
						</div>
					</PopoverContent>
				</Popover>
				<Tooltip content='Statistics' placement='top'>
					<Button color='secondary' isIconOnly variant='flat'>
						<Icons.Histogram />
					</Button>
				</Tooltip>
				<Tooltip content='FITS Header' placement='top'>
					<Button color='secondary' isIconOnly onPointerUp={() => viewer.show('fitsHeader')} variant='flat'>
						<Icons.Text />
					</Button>
				</Tooltip>
				<Tooltip content='Mouse Coordinate' placement='top'>
					<Button color='secondary' isIconOnly variant='flat'>
						<Icons.MousePointerClick />
					</Button>
				</Tooltip>
				<Tooltip content='Settings' placement='top'>
					<Button color='secondary' isIconOnly onPointerUp={() => viewer.show('settings')} variant='flat'>
						<Icons.Cog />
					</Button>
				</Tooltip>
				<Tooltip content='Close' placement='top'>
					<Button className='ms-2' color='danger' isIconOnly onPointerUp={viewer.remove} variant='solid'>
						<Icons.Close />
					</Button>
				</Tooltip>
			</div>
		</div>
	)
})
