import brazilLogo from '@/assets/brazil.png'
import nebulosaLogo from '@/assets/nebulosa.ico'
import type { UseDraggableModalResult } from '@/shared/hooks'
import { Chip, Modal, ModalBody, ModalContent, ModalHeader } from '@heroui/react'
import * as Lucide from 'lucide-react'
import packageJson from '../../../package.json'

export interface AboutProps {
	readonly draggable: UseDraggableModalResult
}

export function About({ draggable }: AboutProps) {
	return (
		<Modal size='sm' ref={draggable.targetRef} isOpen={draggable.isOpen} onOpenChange={draggable.onOpenChange} classNames={{ base: 'max-w-[480px] max-h-[90vh]', wrapper: 'pointer-events-none' }} backdrop='transparent' isDismissable={false} onPointerUp={draggable.onPointerUp}>
			<ModalContent>
				{() => (
					<>
						<ModalHeader {...draggable.moveProps} className='flex flex-row items-center'>
							About
						</ModalHeader>
						<ModalBody>
							<div className='w-full grid grid-cols-12 gap-2'>
								<div className='col-span-2 row-span-6 flex flex-col gap-2'>
									<img src={nebulosaLogo} />
									<a target='_blank' rel='noreferrer' href='https://github.com/tiagohm/nebulosa.app'>
										<img src='https://img.shields.io/github/stars/tiagohm/nebulosa.app?style=flat&label=GitHub&color=%231a1e23' />
									</a>
								</div>
								<div className='col-span-10 text-4xl font-bold flex items-center gap-3'>
									Nebulosa <Chip>{packageJson.version}</Chip>
								</div>
								<div className='col-span-10 text-gray-300 text-center'>The complete integrated solution for all of your astronomical imaging needs.</div>
								<div className='col-span-10 text-xs flex flex-row items-center gap-1 italic justify-center'>
									© 2022-{new Date().getFullYear()} Tiago Melo <img src={brazilLogo} className='mx-1 w-6' /> All rights eserved
								</div>
								<div className='col-span-10 mt-4 p-4 bg-blue-600/10 rounded-2xl text-center'>This software is WIP, comes with absolutely no warranty and the copyright holder is not liable or responsible for anything.</div>
								<div className='col-span-10 px-4 py-2 bg-green-600/10 rounded-2xl flex flex-row gap-2 justify-center items-center'>
									<Lucide.Link size={14} />
									Icons from
									<a href='https://www.flaticon.com/' target='_blank' rel='noreferrer' className='underline'>
										Flaticon
									</a>
									and
									<a href='https://lucide.dev/icons/' target='_blank' rel='noreferrer' className='underline'>
										Lucide
									</a>
								</div>
								<div className='col-span-10 mt-4 mb-1 flex flex-row flex-wrap items-center justify-center gap-1 text-sm'>
									Powered by
									<a href='https://react.dev/' target='_blank' rel='noreferrer' className='bg-neutral-700 px-1 rounded'>
										React
									</a>
									and
									<a href='https://bun.sh/' target='_blank' rel='noreferrer' className='bg-neutral-700 px-1 rounded'>
										Bun
									</a>
									and developed with <Lucide.Heart color='red' size={15} /> by
									<a href='https://github.com/tiagohm' target='_blank' rel='noreferrer' className='bg-neutral-700 px-1 rounded'>
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
}
