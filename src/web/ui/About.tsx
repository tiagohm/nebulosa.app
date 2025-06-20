import { Chip, Modal, ModalBody, ModalContent, ModalHeader } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import * as Lucide from 'lucide-react'
import { memo } from 'react'
import brazilLogo from '@/assets/brazil.png'
import nebulosaLogo from '@/assets/nebulosa.ico'
import { useModal } from '@/shared/hooks'
import { HomeMolecule } from '@/shared/molecules'
import packageJson from '../../../package.json'

export const About = memo(() => {
	const home = useMolecule(HomeMolecule)
	const modal = useModal(() => (home.state.about.showModal = false))

	return (
		<Modal {...modal.props} classNames={{ base: 'max-w-[460px] max-h-[90vh]', wrapper: 'pointer-events-none' }}>
			<ModalContent>
				{() => (
					<>
						<ModalHeader {...modal.moveProps} className='flex flex-row items-center'>
							About
						</ModalHeader>
						<ModalBody {...modal.moveProps}>
							<div className='w-full grid grid-cols-12 gap-2'>
								<div className='col-span-2 row-span-6 flex flex-col gap-2'>
									<img src={nebulosaLogo} />
									<a href='https://github.com/tiagohm/nebulosa.app' rel='noreferrer' target='_blank'>
										<img src='https://img.shields.io/github/stars/tiagohm/nebulosa.app?style=flat&label=GitHub&color=%231a1e23' />
									</a>
								</div>
								<div className='col-span-10 text-4xl font-bold flex items-center gap-3'>
									Nebulosa <Chip>{packageJson.version}</Chip>
								</div>
								<div className='col-span-10 text-gray-300 text-center'>The complete integrated solution for all of your astronomical imaging needs.</div>
								<div className='col-span-10 text-xs flex flex-row items-center gap-1 italic justify-center'>
									© 2022-{new Date().getFullYear()} Tiago Melo <img className='mx-1 w-6' src={brazilLogo} /> All rights eserved
								</div>
								<div className='col-span-10 mt-4 p-4 bg-blue-600/10 rounded-2xl text-center'>This software is WIP, comes with absolutely no warranty and the copyright holder is not liable or responsible for anything.</div>
								<div className='col-span-10 px-4 py-2 bg-green-600/10 rounded-2xl flex flex-row gap-2 justify-center items-center'>
									<Lucide.Link size={14} />
									Icons from
									<a className='underline' href='https://www.flaticon.com/' rel='noreferrer' target='_blank'>
										Flaticon
									</a>
									and
									<a className='underline' href='https://lucide.dev/icons/' rel='noreferrer' target='_blank'>
										Lucide
									</a>
								</div>
								<div className='col-span-10 mt-4 mb-1 flex flex-row flex-wrap items-center justify-center gap-1 text-sm'>
									Powered by
									<a className='bg-neutral-700 px-1 rounded' href='https://react.dev/' rel='noreferrer' target='_blank'>
										React
									</a>
									and
									<a className='bg-neutral-700 px-1 rounded' href='https://bun.sh/' rel='noreferrer' target='_blank'>
										Bun
									</a>
									and developed with <Lucide.Heart color='red' size={15} /> by
									<a className='bg-neutral-700 px-1 rounded' href='https://github.com/tiagohm' rel='noreferrer' target='_blank'>
										Me
									</a>
								</div>
							</div>
						</ModalBody>
					</>
				)}
			</ModalContent>
		</Modal>
	)
})
