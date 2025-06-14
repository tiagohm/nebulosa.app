import { ImageViewerMolecule } from '@/shared/molecules'
import { Button, Popover, PopoverContent, PopoverTrigger, Switch, Tooltip } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import * as Lucide from 'lucide-react'
import { useSnapshot } from 'valtio'
import { ToggleButton } from './ToggleButton'

export type ImageToolbarButtonType = 'fits-header' | 'star-detection'

export interface ImageToolbarProps extends React.HTMLAttributes<HTMLDivElement> {
	readonly tooltipPlacement?: 'bottom' | 'top'
	readonly onButtonPress: (type: ImageToolbarButtonType) => void
}

export function ImageToolbar({ tooltipPlacement = 'top', onButtonPress, ...props }: ImageToolbarProps) {
	const viewer = useMolecule(ImageViewerMolecule)
	const { transformation, crosshair, info, starDetection } = useSnapshot(viewer.state)

	return (
		<div {...props}>
			<div className='flex flex-row items-center justify-center gap-2 w-full'>
				<Tooltip content='Save' placement={tooltipPlacement}>
					<Button isIconOnly color='secondary' variant='flat'>
						<Lucide.Save />
					</Button>
				</Tooltip>
				<Tooltip content='Plate Solver' placement={tooltipPlacement}>
					<Button isIconOnly color='secondary' variant='flat'>
						<Lucide.Sigma />
					</Button>
				</Tooltip>
				<Tooltip content='Stretch' placement={tooltipPlacement}>
					<Button isIconOnly color='secondary' variant='flat'>
						<Lucide.ChartColumnDecreasing />
					</Button>
				</Tooltip>
				<Tooltip content='Auto Stretch' placement={tooltipPlacement}>
					<ToggleButton color='primary' isSelected={transformation.stretch.auto} onPointerUp={() => viewer.toggleAutoStretch()}>
						<Lucide.WandSparkles />
					</ToggleButton>
				</Tooltip>
				<Tooltip content='SCNR' placement={tooltipPlacement}>
					<Button isIconOnly color='secondary' variant='flat' isDisabled={info?.mono}>
						<Lucide.Blend />
					</Button>
				</Tooltip>
				<Tooltip content='Debayer' placement={tooltipPlacement}>
					<ToggleButton color='primary' isDisabled={!info?.metadata.bayer || info?.metadata.channels !== 1} isSelected={transformation.debayer} onPointerUp={() => viewer.toggleDebayer()}>
						<Lucide.Grid3X3 />
					</ToggleButton>
				</Tooltip>
				<Tooltip content='Adjustment' placement={tooltipPlacement}>
					<Button isIconOnly color='secondary' variant='flat'>
						<Lucide.Wand />
					</Button>
				</Tooltip>
				<Tooltip content='Rotate' placement={tooltipPlacement}>
					<Button isIconOnly color='secondary' variant='flat'>
						<Lucide.RotateCw />
					</Button>
				</Tooltip>
				<Popover placement='bottom' showArrow>
					<PopoverTrigger>
						<Button isIconOnly color='success' variant='flat'>
							<Lucide.Palette />
						</Button>
					</PopoverTrigger>
					<PopoverContent>
						<div className='flex flex-row items-center justify-center gap-2 p-2'>
							<Tooltip content='Horizontal mirror' placement={tooltipPlacement}>
								<ToggleButton color='primary' isSelected={transformation.horizontalMirror} onPointerUp={() => viewer.toggleHorizontalMirror()}>
									<Lucide.FlipHorizontal />
								</ToggleButton>
							</Tooltip>
							<Tooltip content='Vertical Mirror' placement={tooltipPlacement}>
								<ToggleButton color='primary' isSelected={transformation.verticalMirror} onPointerUp={() => viewer.toggleVerticalMirror()}>
									<Lucide.FlipVertical />
								</ToggleButton>
							</Tooltip>
							<Tooltip content='Invert' placement={tooltipPlacement}>
								<ToggleButton color='primary' isSelected={transformation.invert} onPointerUp={() => viewer.toggleInvert()}>
									<Lucide.Image />
								</ToggleButton>
							</Tooltip>
						</div>
					</PopoverContent>
				</Popover>
				<Popover placement='bottom' showArrow>
					<PopoverTrigger>
						<Button isIconOnly color='success' variant='flat'>
							<Lucide.BringToFront />
						</Button>
					</PopoverTrigger>
					<PopoverContent>
						<div className='flex flex-row justify-center items-start gap-2 p-2'>
							<Tooltip content='Crosshair' placement={tooltipPlacement}>
								<ToggleButton color='primary' isSelected={crosshair} onPointerUp={() => viewer.toggleCrosshair()}>
									<Lucide.Crosshair />
								</ToggleButton>
							</Tooltip>
							<Tooltip content='Annotatation' placement={tooltipPlacement}>
								<Button isIconOnly color='secondary' variant='flat'>
									<Lucide.Pen />
								</Button>
							</Tooltip>
							<div className='flex flex-col gap-2 justify-center'>
								<Tooltip content='Star Detection' placement={tooltipPlacement}>
									<Button isIconOnly color='secondary' variant='flat' onPress={() => onButtonPress('star-detection')}>
										<Lucide.Stars />
									</Button>
								</Tooltip>
								{starDetection.stars.length > 0 && <Switch size='sm' isSelected={starDetection.show} onValueChange={(value) => (viewer.state.starDetection.show = value)} />}
							</div>
							<Tooltip content='ROI' placement={tooltipPlacement}>
								<Button isIconOnly color='secondary' variant='flat'>
									<Lucide.Crop />
								</Button>
							</Tooltip>
							<Tooltip content='FOV' placement={tooltipPlacement}>
								<Button isIconOnly color='secondary' variant='flat'>
									<Lucide.Scan />
								</Button>
							</Tooltip>
						</div>
					</PopoverContent>
				</Popover>
				<Tooltip content='Statistics' placement={tooltipPlacement}>
					<Button isIconOnly color='secondary' variant='flat'>
						<Lucide.ChartNoAxesColumnIncreasing />
					</Button>
				</Tooltip>
				<Tooltip content='FITS Header' placement={tooltipPlacement}>
					<Button isIconOnly color='secondary' variant='flat' onPress={() => onButtonPress('fits-header')}>
						<Lucide.List />
					</Button>
				</Tooltip>
				<Tooltip content='Mouse Coordinate' placement={tooltipPlacement}>
					<Button isIconOnly color='secondary' variant='flat'>
						<Lucide.MousePointerClick />
					</Button>
				</Tooltip>
				<Tooltip content='Close' placement={tooltipPlacement}>
					<Button isIconOnly color='danger' variant='solid' className='ms-2' onPointerUp={() => viewer.remove()}>
						<Lucide.X />
					</Button>
				</Tooltip>
			</div>
		</div>
	)
}
