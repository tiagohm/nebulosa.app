import { Navbar, NavbarBrand, NavbarContent } from '@heroui/react'
import { ConnectionBox } from './ConnectionBox'
import { HomeMenu } from './HomeMenu'
import { ImageWorkspace } from './ImageWorkspace'
import { OpenImageButton } from './OpenImageButton'

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
			<Navbar isBlurred={false} className='bg-neutral-900 shadow'>
				<NavbarBrand>
					<ConnectionBox />
				</NavbarBrand>
				<NavbarContent className='flex gap-4 flex-1' justify='center'>
					<div className='flex flex-row w-full justify-start items-center gap-2'>
						<HomeMenu />
						<OpenImageButton />
					</div>
				</NavbarContent>
			</Navbar>
		</>
	)
}
