import { useDraggableModal } from '@/shared/hooks'
// biome-ignore format:
import { Button, Navbar, NavbarBrand, NavbarContent, Popover, PopoverContent, PopoverTrigger, Tooltip } from '@heroui/react'
import { useLocalStorage } from '@uidotdev/usehooks'
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
import { FilePicker } from './FilePicker'

const POPUP_ITEMS = [
	{ key: 'camera', label: 'Camera', icon: cameraPng },
	{ key: 'mount', label: 'Mount', icon: mountPng },
	{ key: 'filter-wheel', label: 'Filter Wheel', icon: filterWheelPng },
	{ key: 'focuser', label: 'Focuser', icon: focuserPng },
	{ key: 'rotator', label: 'Rotator', icon: rotatorPng },
	{ key: 'light-box', label: 'Light Box', icon: lightBoxPng },
	{ key: 'dust-cap', label: 'Dust Cap', icon: dustCapPng },
	{ key: 'guide-output', label: 'Guide Output', icon: guideOutputPng },
	{ key: 'guider', label: 'Guider', icon: guiderPng },
	{ key: 'sky-atlas', label: 'Sky Atlas', icon: skyAtlasPng },
	{ key: 'framing', label: 'Framing', icon: framingPng },
	{ key: 'aligment', label: 'Aligment', icon: alignmentPng },
	{ key: 'auto-focus', label: 'Auto Focus', icon: autoFocusPng },
	{ key: 'flat-wizard', label: 'Flat Wizard', icon: flatWizardPng },
	{ key: 'sequencer', label: 'Sequencer', icon: sequencerPng },
	{ key: 'indi', label: 'INDI', icon: indiPng },
	{ key: 'calculator', label: 'Calculator', icon: calculatorPng },
	{ key: 'settings', label: 'Settings', icon: settingsPng },
	{ key: 'about', label: 'About', icon: aboutPng },
] as const

type PopupItemKey = (typeof POPUP_ITEMS)[number]['key']

export default function Home() {
	return (
		<div className='w-full h-full flex flex-col'>
			<TopBar onPopupItemPress={alert} onImageChoose={alert} />
		</div>
	)
}

interface TopBarProps {
	readonly onPopupItemPress: (key: PopupItemKey) => void
	readonly onImageChoose?: (path: string[]) => void
}

function TopBar({ onPopupItemPress: onPopupButtonPress, onImageChoose }: TopBarProps) {
	const [connected, setConnected] = useState(false)
	const [openImagePath, setOpenImagePath] = useLocalStorage('image.open.path', '')
	const openImageModal = useDraggableModal()

	function onConnected(connection: Connection) {
		setConnected(!connected)
	}

	function showOpenImageModal() {
		openImageModal.show()
	}

	function handleImageChoose(path?: string[]) {
		if (path?.length) {
			setOpenImagePath(path[0])
			onImageChoose?.(path)
		}
	}

	return (
		<>
			<Navbar isBlurred={false} className='bg-neutral-900 shadow'>
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
									{POPUP_ITEMS.map((item) => (
										<Tooltip key={item.key} content={item.label} placement='bottom' showArrow>
											<Button isIconOnly size='lg' color='secondary' variant='light' onPress={() => onPopupButtonPress(item.key)}>
												<img src={item.icon} className='w-9' />
											</Button>
										</Tooltip>
									))}
								</div>
							</PopoverContent>
						</Popover>
						<Tooltip content='Open Image' showArrow>
							<Button isIconOnly color='secondary' variant='light' onPress={showOpenImageModal}>
								<Lucide.ImagePlus />
							</Button>
						</Tooltip>
					</div>
				</NavbarContent>
			</Navbar>
			<FilePicker draggable={openImageModal} path={openImagePath} onChoose={handleImageChoose} filter='*.{fits,fit,xisf}' multiple />
		</>
	)
}
