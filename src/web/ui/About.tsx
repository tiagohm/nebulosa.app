import { Chip } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import brazilLogo from '@/assets/brazil.png'
import nebulosaLogo from '@/assets/nebulosa.ico'
import { AboutMolecule } from '@/molecules/about'
import packageJson from '../../../package.json'
import { Icons } from './Icon'
import { Link } from './Link'
import { Modal } from './Modal'

export const About = memo(() => {
	const about = useMolecule(AboutMolecule)

	const Header = (
		<div className='w-full ms-10 justify-center text-4xl font-bold flex items-center gap-3'>
			Nebulosa <Chip>{packageJson.version}</Chip>
		</div>
	)

	return (
		<Modal header={Header} id='about' maxWidth='448px' onHide={about.hide}>
			<div className='mt-0 grid grid-cols-12 gap-2'>
				<div className='col-span-full sm:col-span-3 row-span-6 flex flex-col items-center gap-2'>
					<img className='max-h-35' src={nebulosaLogo} />
					<Link href='https://github.com/tiagohm/nebulosa.app'>
						<img src='https://img.shields.io/github/stars/tiagohm/nebulosa.app?style=flat&label=GitHub&color=%231a1e23' />
					</Link>
				</div>
				<div className='col-span-full sm:col-span-9 text-gray-300 text-center'>The complete integrated solution for all of your astronomical imaging needs.</div>
				<div className='col-span-full sm:col-span-9 text-xs flex flex-row items-center gap-1 text-gray-500 justify-center'>
					© 2022-{about.state.year} Tiago Melo <img className='mx-1 w-6' src={brazilLogo} /> All rights reserved
				</div>
				<div className='col-span-full sm:col-span-9 mt-4 p-4 bg-blue-600/10 rounded-2xl text-center'>This software is WIP, comes with absolutely no warranty and the copyright holder is not liable or responsible for anything.</div>
				<div className='col-span-full sm:col-span-9 px-4 py-2 bg-green-600/10 rounded-2xl flex flex-row flex-nowrap gap-1 justify-center items-center text-sm'>
					<Icons.Link size={14} />
					Icons from
					<Link className='underline' href='https://www.flaticon.com/' label='Flaticon' />
					,
					<Link className='underline' href='https://lucide.dev/icons/' label='Lucide' />
					,
					<Link className='underline' href='https://tabler.io/icons/' label='Tabler' />
					and
					<Link className='underline' href='https://pictogrammers.com/library/mdi/' label='MDI' />
				</div>
				<div className='col-span-full sm:col-span-9 mt-4 mb-1 flex flex-row flex-wrap items-center justify-center gap-1 text-xs'>
					Powered by
					<Link className='bg-neutral-700 px-1 rounded' href='https://react.dev/' label='React' />
					and
					<Link className='bg-neutral-700 px-1 rounded' href='https://bun.sh/' label='Bun' />
					and developed with <Icons.Heart color='red' size={15} /> by
					<Link className='bg-neutral-700 px-1 rounded' href='https://github.com/tiagohm' label='Me' />
				</div>
			</div>
		</Modal>
	)
})
