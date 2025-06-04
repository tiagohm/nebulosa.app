// biome-ignore format:
import { Button, Navbar, NavbarBrand, NavbarContent, Popover, PopoverContent, PopoverTrigger, Tooltip } from '@heroui/react'
import * as Lucide from 'lucide-react'
import { useState } from 'react'
import aboutPng from '../assets/about.png'
import alignmentPng from '../assets/alignment.png'
import autoFocusPng from '../assets/auto-focus.png'
import calculatorPng from '../assets/calculator.png'
import cameraPng from '../assets/camera.png'
import dustCapPng from '../assets/dust-cap.png'
import filterWheelPng from '../assets/filter-wheel.png'
import flatWizardPng from '../assets/flat-wizard.png'
import focuserPng from '../assets/focuser.png'
import framingPng from '../assets/framing.png'
import guideOutputPng from '../assets/guide-output.png'
import guiderPng from '../assets/guider.png'
import indiPng from '../assets/indi.png'
import lightBoxPng from '../assets/light-box.png'
import mountPng from '../assets/mount.png'
import rotatorPng from '../assets/rotator.png'
import sequencerPng from '../assets/sequencer.png'
import settingsPng from '../assets/settings.png'
import skyAtlasPng from '../assets/sky-atlas.png'
import { type Connection, ConnectionBox } from './ConnectionBox'

export default function Home() {
	const popupMenuItems: TopBarPopupMenuItem[] = [
		{ label: 'Camera', icon: cameraPng, onPress: () => {} },
		{ label: 'Mount', icon: mountPng, onPress: () => {} },
		{ label: 'Filter Wheel', icon: filterWheelPng, onPress: () => {} },
		{ label: 'Focuser', icon: focuserPng, onPress: () => {} },
		{ label: 'Rotator', icon: rotatorPng, onPress: () => {} },
		{ label: 'Light Box', icon: lightBoxPng, onPress: () => {} },
		{ label: 'Dust Cap', icon: dustCapPng, onPress: () => {} },
		{ label: 'Guide Output', icon: guideOutputPng, onPress: () => {} },
		{ label: 'Guider', icon: guiderPng, onPress: () => {} },
		{ label: 'Sky Atlas', icon: skyAtlasPng, onPress: () => {} },
		{ label: 'Framing', icon: framingPng, onPress: () => {} },
		{ label: 'Aligment', icon: alignmentPng, onPress: () => {} },
		{ label: 'Auto Focus', icon: autoFocusPng, onPress: () => {} },
		{ label: 'Flat Wizard', icon: flatWizardPng, onPress: () => {} },
		{ label: 'Sequencer', icon: sequencerPng, onPress: () => {} },
		{ label: 'INDI', icon: indiPng, onPress: () => {} },
		{ label: 'Calculator', icon: calculatorPng, onPress: () => {} },
		{ label: 'Settings', icon: settingsPng, onPress: () => {} },
		{ label: 'About', icon: aboutPng, onPress: () => {} },
	]

	return (
		<div className='w-full h-full flex flex-col'>
			<TopBar popupMenuItems={popupMenuItems} />
		</div>
	)
}

interface TopBarPopupMenuItem {
	readonly label: string
	readonly icon: string
	readonly onPress: () => void
}

interface TopBarProps {
	readonly popupMenuItems: TopBarPopupMenuItem[]
}

function TopBar({ popupMenuItems }: TopBarProps) {
	const [connected, setConnected] = useState(false)

	function onConnected(connection: Connection) {
		setConnected(!connected)
	}

	return (
		<Navbar>
			<NavbarBrand>
				<ConnectionBox onConnected={onConnected} isConnected={connected} />
			</NavbarBrand>
			<NavbarContent className='hidden sm:flex gap-4 flex-1' justify='center'>
				<div className='flex flex-row w-full justify-start items-center gap-2'>
					<Popover placement='bottom' showArrow>
						<PopoverTrigger>
							<Button isIconOnly color='secondary' variant='light'>
								<Lucide.Menu />
							</Button>
						</PopoverTrigger>
						<PopoverContent>
							<div className='grid grid-cols-8 gap-2 p-4'>
								{popupMenuItems.map((item) => (
									<Tooltip key={item.label} content={item.label} placement='bottom' showArrow>
										<Button isIconOnly size='lg' color='secondary' variant='light' onPress={item.onPress}>
											<img src={item.icon} className='w-9' />
										</Button>
									</Tooltip>
								))}
							</div>
						</PopoverContent>
					</Popover>
					<Tooltip content='Open Image' showArrow>
						<Button isIconOnly color='secondary' variant='light'>
							<Lucide.ImagePlus />
						</Button>
					</Tooltip>
				</div>
			</NavbarContent>
		</Navbar>
	)
}
