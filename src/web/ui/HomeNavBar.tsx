import { Navbar, NavbarBrand, NavbarContent } from '@heroui/react'
import { ConnectionBox } from './ConnectionBox'
import { HomeMenu } from './HomeMenu'
import { ImagePickerButton } from './ImagePickerButton'

export function HomeNavBar() {
	return (
		<>
			<Navbar className='bg-neutral-900 shadow' isBlurred={false}>
				<NavbarBrand className='flex-auto'>
					<ConnectionBox />
				</NavbarBrand>
				<NavbarContent className='flex gap-4 flex-1' justify='center'>
					<div className='flex flex-row justify-start items-center gap-2'>
						<HomeMenu />
						<ImagePickerButton />
					</div>
				</NavbarContent>
			</Navbar>
		</>
	)
}
