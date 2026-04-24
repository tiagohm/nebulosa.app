import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import brazilLogo from '@/assets/brazil.png'
import nebulosaLogo from '@/assets/nebulosa.ico'
import { AboutMolecule } from '@/molecules/about'
import packageJson from '../../../package.json'
import { Chip } from './components/Chip'
import { Icons } from './Icon'
import { Link } from './Link'
import { Modal } from './Modal'

export const About = memo(() => {
	const about = useMolecule(AboutMolecule)

	const Header = (
		<div className="ms-10 flex w-full items-center justify-center gap-3 text-4xl font-bold">
			Nebulosa <Chip>{packageJson.version}</Chip>
		</div>
	)

	return (
		<Modal header={Header} id="about" maxWidth="448px" onHide={about.hide}>
			<div className="mt-0 grid grid-cols-12 gap-2">
				<div className="col-span-full row-span-6 flex flex-col items-center gap-2 sm:col-span-3">
					<img className="max-h-35" src={nebulosaLogo} />
					<a href="https://github.com/tiagohm/nebulosa.app" rel="noreferrer" target="_blank">
						<img src="https://img.shields.io/github/stars/tiagohm/nebulosa.app?style=flat&label=GitHub&color=%231a1e23" />
					</a>
				</div>
				<div className="col-span-full text-center text-gray-300 sm:col-span-9">The complete integrated solution for all of your astronomical imaging needs.</div>
				<div className="col-span-full flex flex-row items-center justify-center gap-1 text-xs text-gray-400 sm:col-span-9">
					© 2022-{about.state.year} Tiago Melo <img className="mx-1 w-6" src={brazilLogo} /> All rights reserved
				</div>
				<div className="col-span-full mt-4 rounded-2xl bg-blue-600/10 p-4 text-center sm:col-span-9">This software is WIP, comes with absolutely no warranty and the copyright holder is not liable or responsible for anything.</div>
				<div className="col-span-full flex flex-row flex-nowrap items-center justify-center gap-1 rounded-2xl bg-green-600/10 px-4 py-2 text-sm sm:col-span-9">
					<Icons.Link />
					Icons from
					<Link className="w-auto! underline" href="https://www.flaticon.com/" label="Flaticon" />
					,
					<Link className="w-auto! underline" href="https://lucide.dev/icons/" label="Lucide" />
					,
					<Link className="w-auto! underline" href="https://pictogrammers.com/library/mdi/" label="MDI" />
					and
					<Link className="w-auto! underline" href="https://tabler.io/icons/" label="Tabler" />
				</div>
				<div className="col-span-full mt-4 mb-1 flex flex-row flex-wrap items-center justify-center gap-1 text-xs sm:col-span-9">
					Powered by
					<Link className="w-auto! rounded bg-neutral-700 px-1 text-neutral-100!" href="https://react.dev/" label="React" />
					and
					<Link className="w-auto! rounded bg-neutral-700 px-1 text-neutral-100!" href="https://bun.sh/" label="Bun" />
					and developed with <Icons.Heart color="red" /> by
					<Link className="w-auto! rounded bg-neutral-700 px-1 text-neutral-100!" href="https://github.com/tiagohm" label="Me" />
				</div>
			</div>
		</Modal>
	)
})
