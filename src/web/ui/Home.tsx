import { Navbar, NavbarBrand, NavbarContent } from '@heroui/react'
import { ConnectionBox } from './ConnectionBox'
import { HomeMenu } from './HomeMenu'
import { ImagePickerButton } from './ImagePickerButton'
import { ImageWorkspace } from './ImageWorkspace'

export default function Home() {
	return (
		<div className='w-full h-full flex flex-col'>
			<TopBar />
			<ImageWorkspace />
		</div>
	)
}

function TopBar() {
	return (
		<>
			<Navbar className='bg-neutral-900 shadow' isBlurred={false}>
				<NavbarBrand>
					<ConnectionBox />
				</NavbarBrand>
				<NavbarContent className='flex gap-4 flex-1' justify='center'>
					<div className='flex flex-row w-full justify-start items-center gap-2'>
						<HomeMenu />
						<ImagePickerButton />
					</div>
				</NavbarContent>
			</Navbar>
		</>
	)
}
