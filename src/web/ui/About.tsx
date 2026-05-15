import { memo, type ReactNode } from 'react'
import brazilLogo from '@/assets/brazil.png'
import nebulosaLogo from '@/assets/nebulosa.ico'
import packageJson from '../../../package.json'
import { about } from '../store/about.store'
import { Chip } from './components/Chip'
import { Link } from './components/Link'
import { Icons } from './Icon'
import { Modal } from './Modal'

const PROJECT_URL = 'https://github.com/tiagohm/nebulosa.app'

const ICON_CREDITS = [
	{ href: 'https://www.flaticon.com/', label: 'Flaticon' },
	{ href: 'https://lucide.dev/icons/', label: 'Lucide' },
	{ href: 'https://pictogrammers.com/library/mdi/', label: 'MDI' },
	{ href: 'https://tabler.io/icons/', label: 'Tabler' },
] as const

const STACK_LINKS = [
	{ href: 'https://react.dev/', label: 'React', version: packageJson.dependencies.react },
	{ href: 'https://bun.sh/', label: 'Bun', version: undefined },
	{ href: 'https://tailwindcss.com/', label: 'Tailwind CSS', version: packageJson.dependencies.tailwindcss },
] as const

function StackLinkItem(item: (typeof STACK_LINKS)[number]) {
	return <LinkButton href={item.href} key={item.label} label={item.version === undefined ? item.label : `${item.label} ${item.version}`} />
}

function IconCreditItem(item: (typeof ICON_CREDITS)[number]) {
	return <Link className="w-auto!" color="default" href={item.href} key={item.label} label={item.label} underline />
}

export const About = memo(() => (
	<Modal header={<Header />} id="about" maxWidth="472px" onHide={about.hide}>
		<Body />
	</Modal>
))

function Body() {
	return (
		<div className="grid grid-cols-12 gap-3">
			<Logo />
			<Info />
			<PoweredBy />
			<IconCredits />
		</div>
	)
}

function Logo() {
	return (
		<div className="col-span-full flex flex-col items-center gap-3 sm:col-span-4">
			<img className="size-28 rounded-lg p-2" src={nebulosaLogo} />
			<LinkButton href={PROJECT_URL} icon={<Icons.Link />} label="GitHub" />
		</div>
	)
}

function Info() {
	return (
		<div className="col-span-full flex min-w-0 flex-col gap-3 sm:col-span-8">
			<p className="text-center text-sm leading-5 text-neutral-300">{packageJson.description}</p>
			<div className="rounded-lg border border-neutral-800 bg-neutral-900/70 p-3">
				<InfoRow label="Version">
					<Chip color="primary" label={packageJson.version} size="sm" />
				</InfoRow>
				<InfoRow label="License">
					<span>{packageJson.license}</span>
				</InfoRow>
				<InfoRow label="Author">
					<span className="inline-flex min-w-0 items-center gap-1">
						{packageJson.author.name}
						<img className="h-4 w-5 shrink-0" src={brazilLogo} />
					</span>
				</InfoRow>
				<InfoRow label="Copyright">
					<span>2022-{about.state.year}</span>
				</InfoRow>
			</div>
			<div className="rounded-lg border border-(--color-variant)/20 bg-(--color-variant)/10 p-3 text-center text-sm leading-5 text-neutral-200 [--color-variant:var(--warning)]">This software is WIP, comes with absolutely no warranty, and the copyright holder is not liable or responsible for anything.</div>
		</div>
	)
}

function PoweredBy() {
	return (
		<div className="col-span-full flex flex-wrap items-center justify-center gap-1.5 border-t border-neutral-800 pt-3 text-xs text-neutral-400">
			<span>Powered by</span>
			{STACK_LINKS.map(StackLinkItem)}
		</div>
	)
}

function IconCredits() {
	return (
		<div className="col-span-full flex flex-wrap items-center justify-center gap-1.5 text-xs text-neutral-500">
			<Icons.Link className="shrink-0" />
			<span>Icons from</span>
			{ICON_CREDITS.map(IconCreditItem)}
		</div>
	)
}

interface InfoRowProps {
	readonly children: ReactNode
	readonly label: string
}

function InfoRow({ children, label }: InfoRowProps) {
	return (
		<div className="grid grid-cols-[5.25rem_minmax(0,1fr)] items-center gap-2 py-1 text-sm">
			<span className="text-neutral-500">{label}</span>
			<div className="min-w-0 text-neutral-200">{children}</div>
		</div>
	)
}

interface LinkButtonProps {
	readonly href: string
	readonly icon?: ReactNode
	readonly label: ReactNode
}

function LinkButton({ href, icon, label }: LinkButtonProps) {
	return (
		<Link
			className="w-auto! rounded-lg bg-neutral-800 px-2 py-1 text-neutral-100! hover:bg-neutral-700"
			href={href}
			label={
				<span className="inline-flex min-w-0 items-center gap-1">
					{icon}
					<span className="min-w-0 truncate">{label}</span>
				</span>
			}
		/>
	)
}

function Header() {
	return (
		<div className="ms-10 flex min-w-0 flex-1 items-center justify-center gap-3">
			<span className="min-w-0 truncate text-3xl font-bold text-neutral-100">Nebulosa</span>
		</div>
	)
}
