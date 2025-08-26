import { Navbar, NavbarBrand, NavbarContent } from '@heroui/react'
import { memo } from 'react'
import { ConnectionBox } from './ConnectionBox'
import { HomeMenu } from './HomeMenu'
import { ImagePickerButton } from './ImagePickerButton'
import { IndiServerButton } from './IndiServerButton'

export const HomeNavBar = memo(() => {
	return (
		<Navbar className='bg-neutral-900 shadow' isBlurred={false}>
			<NavbarBrand className='flex-auto'>
				<ConnectionBox />
			</NavbarBrand>
			<NavbarContent className='flex gap-4 flex-1' justify='center'>
				<div className='flex flex-row justify-start items-center gap-2'>
					<HomeMenu />
					<ImagePickerButton />
				</div>
				<div className='flex flex-1 flex-row justify-end gap-2'>
					<IndiServerButton />
				</div>
			</NavbarContent>
		</Navbar>
	)
})
