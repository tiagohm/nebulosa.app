import aboutIcon from '@/assets/about.webp'
import alignmentIcon from '@/assets/alignment.webp'
import autoFocusIcon from '@/assets/auto-focus.webp'
import calculatorIcon from '@/assets/calculator.webp'
import cameraIcon from '@/assets/camera.webp'
import dustCapIcon from '@/assets/dust-cap.webp'
import filterWheelIcon from '@/assets/filter-wheel.webp'
import flatWizardIcon from '@/assets/flat-wizard.webp'
import focuserIcon from '@/assets/focuser.webp'
import framingIcon from '@/assets/framing.webp'
import guideOutputIcon from '@/assets/guide-output.webp'
import guiderIcon from '@/assets/guider.webp'
import heaterIcon from '@/assets/heater.webp'
import indiIcon from '@/assets/indi.webp'
import lightBoxIcon from '@/assets/light-box.webp'
import mountIcon from '@/assets/mount.webp'
import rotatorIcon from '@/assets/rotator.webp'
import sequencerIcon from '@/assets/sequencer.webp'
import settingsIcon from '@/assets/settings.webp'
import skyAtlasIcon from '@/assets/sky-atlas.webp'
import thermometerIcon from '@/assets/thermometer.webp'
import { Button, Chip, Popover, PopoverContent, PopoverTrigger, Tooltip } from '@heroui/react'
import * as Lucide from 'lucide-react'

export type HomeMenuItem = 'camera' | 'mount' | 'filter-wheel' | 'focuser' | 'rotator' | 'light-box' | 'dust-cap' | 'guide-output' | 'dew-heater' | 'thermometer' | 'guider' | 'sky-atlas' | 'framing' | 'aligment' | 'auto-focus' | 'flat-wizard' | 'sequencer' | 'indi' | 'calculator' | 'settings' | 'about'

export interface HomeMenuProps {
	readonly onItemPointerUp: (item: HomeMenuItem) => void
}

export function HomeMenu({ onItemPointerUp }: HomeMenuProps) {
	return (
		<Popover placement='bottom' showArrow>
			<PopoverTrigger>
				<Button isIconOnly color='secondary' variant='light'>
					<Lucide.Menu />
				</Button>
			</PopoverTrigger>
			<PopoverContent>
				<div className='grid grid-cols-6 gap-2 p-4'>
					<Tooltip content='Camera' placement='bottom' showArrow>
						<Button isIconOnly size='lg' color='secondary' variant='light' onPointerUp={() => onItemPointerUp('camera')}>
							<img src={cameraIcon} className='w-9' />
						</Button>
					</Tooltip>
					<Tooltip content='Mount' placement='bottom' showArrow>
						<Button isIconOnly size='lg' color='secondary' variant='light' onPointerUp={() => onItemPointerUp('mount')}>
							<img src={mountIcon} className='w-9' />
						</Button>
					</Tooltip>
					<Tooltip content='Filter Wheel' placement='bottom' showArrow>
						<Button isIconOnly size='lg' color='secondary' variant='light' onPointerUp={() => onItemPointerUp('filter-wheel')}>
							<img src={filterWheelIcon} className='w-9' />
						</Button>
					</Tooltip>
					<Tooltip content='Focuser' placement='bottom' showArrow>
						<Button isIconOnly size='lg' color='secondary' variant='light' onPointerUp={() => onItemPointerUp('focuser')}>
							<img src={focuserIcon} className='w-9' />
						</Button>
					</Tooltip>
					<Tooltip content='Rotator' placement='bottom' showArrow>
						<Button isIconOnly size='lg' color='secondary' variant='light' onPointerUp={() => onItemPointerUp('rotator')}>
							<img src={rotatorIcon} className='w-9' />
						</Button>
					</Tooltip>
					<Tooltip content='Light Box' placement='bottom' showArrow>
						<Button isIconOnly size='lg' color='secondary' variant='light' onPointerUp={() => onItemPointerUp('light-box')}>
							<img src={lightBoxIcon} className='w-9' />
						</Button>
					</Tooltip>
					<Tooltip content='Dust Cap' placement='bottom' showArrow>
						<Button isIconOnly size='lg' color='secondary' variant='light' onPointerUp={() => onItemPointerUp('dust-cap')}>
							<img src={dustCapIcon} className='w-9' />
						</Button>
					</Tooltip>
					<Tooltip content='Guide Output' placement='bottom' showArrow>
						<Button isIconOnly size='lg' color='secondary' variant='light' onPointerUp={() => onItemPointerUp('guide-output')}>
							<img src={guideOutputIcon} className='w-9' />
						</Button>
					</Tooltip>
					<Tooltip content='Dew Heater' placement='bottom' showArrow>
						<Button isIconOnly size='lg' color='secondary' variant='light' onPointerUp={() => onItemPointerUp('dew-heater')}>
							<img src={heaterIcon} className='w-9' />
						</Button>
					</Tooltip>
					<Tooltip content='Thermometer' placement='bottom' showArrow>
						<Button isIconOnly size='lg' color='secondary' variant='light' onPointerUp={() => onItemPointerUp('thermometer')}>
							<img src={thermometerIcon} className='w-9' />
						</Button>
					</Tooltip>
					<Tooltip content='Guider' placement='bottom' showArrow>
						<Button isIconOnly size='lg' color='secondary' variant='light' onPointerUp={() => onItemPointerUp('guider')}>
							<img src={guiderIcon} className='w-9' />
						</Button>
					</Tooltip>
					<Tooltip content='Sky Atlas' placement='bottom' showArrow>
						<Button isIconOnly size='lg' color='secondary' variant='light' onPointerUp={() => onItemPointerUp('sky-atlas')}>
							<img src={skyAtlasIcon} className='w-9' />
						</Button>
					</Tooltip>
					<Tooltip content='Framing' placement='bottom' showArrow>
						<Button isIconOnly size='lg' color='secondary' variant='light' onPointerUp={() => onItemPointerUp('framing')}>
							<img src={framingIcon} className='w-9' />
						</Button>
					</Tooltip>
					<Tooltip content='Aligment' placement='bottom' showArrow>
						<Button isIconOnly size='lg' color='secondary' variant='light' onPointerUp={() => onItemPointerUp('aligment')}>
							<img src={alignmentIcon} className='w-9' />
						</Button>
					</Tooltip>
					<Tooltip content='Auto Focus' placement='bottom' showArrow>
						<Button isIconOnly size='lg' color='secondary' variant='light' onPointerUp={() => onItemPointerUp('auto-focus')}>
							<img src={autoFocusIcon} className='w-9' />
						</Button>
					</Tooltip>
					<Tooltip content='Flat Wizard' placement='bottom' showArrow>
						<Button isIconOnly size='lg' color='secondary' variant='light' onPointerUp={() => onItemPointerUp('flat-wizard')}>
							<img src={flatWizardIcon} className='w-9' />
						</Button>
					</Tooltip>
					<Tooltip content='Sequencer' placement='bottom' showArrow>
						<Button isIconOnly size='lg' color='secondary' variant='light' onPointerUp={() => onItemPointerUp('sequencer')}>
							<img src={sequencerIcon} className='w-9' />
						</Button>
					</Tooltip>
					<Tooltip content='INDI' placement='bottom' showArrow>
						<Button isIconOnly size='lg' color='secondary' variant='light' onPointerUp={() => onItemPointerUp('indi')}>
							<img src={indiIcon} className='w-9' />
						</Button>
					</Tooltip>
					<Tooltip content='Calculator' placement='bottom' showArrow>
						<Button isIconOnly size='lg' color='secondary' variant='light' onPointerUp={() => onItemPointerUp('calculator')}>
							<img src={calculatorIcon} className='w-9' />
						</Button>
					</Tooltip>
					<Tooltip content='Settings' placement='bottom' showArrow>
						<Button isIconOnly size='lg' color='secondary' variant='light' onPointerUp={() => onItemPointerUp('settings')}>
							<img src={settingsIcon} className='w-9' />
						</Button>
					</Tooltip>
					<Tooltip content='About' placement='bottom' showArrow>
						<Button isIconOnly size='lg' color='secondary' variant='light' onPointerUp={() => onItemPointerUp('about')}>
							<img src={aboutIcon} className='w-9' />
						</Button>
					</Tooltip>
					<div className='col-span-full font-bold text-sm mt-2'>CAMERA</div>
					<div className='col-span-full my-2 flex flex-col items-center justify-center gap-2 flex-wrap'>
						<Chip variant='flat' className='min-w-full cursor-pointer' endContent={<Lucide.Settings size={20} />} onClose={() => alert('o')}>
							CCD Simulator
						</Chip>
						<Chip variant='flat' className='min-w-full cursor-pointer' endContent={<Lucide.Settings size={20} />} onClose={() => alert('o')}>
							ZWO ASI120MM
						</Chip>
						<Chip variant='flat' className='min-w-full cursor-pointer' color='success' endContent={<Lucide.Settings size={20} />} onClose={() => alert('o')}>
							ZWO ASI294MM
						</Chip>
					</div>
				</div>
			</PopoverContent>
		</Popover>
	)
}
