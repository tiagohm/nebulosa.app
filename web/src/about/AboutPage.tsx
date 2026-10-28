import type { AboutInfo } from 'api'
import { type ReactNode, useEffect, useState } from 'react'
import logo from '../../assets/nebulosa.ico'
import { Button } from '../ui/Button'
import { APP_REPOSITORY_URL, aboutFields, browserAboutIo, CORE_REPOSITORY_URL, fetchAbout, LICENSE_URL, NOT_AVAILABLE, versionInfoText } from './about'

// About page (the button at the bottom of the navigation rail): the identity of the application, the version and
// build of the distribution the server runs, fetched once when the page opens, and the author, license, and
// repositories of the project, shown even when the server cannot be reached. It changes no state of the server.

// Number of leading hexadecimal digits shown of a commit; the full commit is its tooltip.
const SHORT_COMMIT_LENGTH = 12

// Loading state of the identity of the server.
type AboutLoad = { readonly kind: 'loading' } | { readonly kind: 'loaded'; readonly info: AboutInfo } | { readonly kind: 'failed'; readonly message: string }

// Outcome of the latest copy of the version info.
type CopyResult = 'copied' | 'failed'

// About page.
export function AboutPage() {
	const [load, setLoad] = useState<AboutLoad>({ kind: 'loading' })
	const [attempt, setAttempt] = useState(0)
	const [copy, setCopy] = useState<CopyResult>()

	useEffect(() => {
		const controller = new AbortController()

		fetchAbout(browserAboutIo, controller.signal).then(
			(info) => setLoad({ kind: 'loaded', info }),
			(error: unknown) => {
				if (controller.signal.aborted) return
				setLoad({ kind: 'failed', message: error instanceof Error ? error.message : 'Request failed' })
			},
		)

		return () => controller.abort()
	}, [attempt])

	function retry() {
		setLoad({ kind: 'loading' })
		setAttempt((n) => n + 1)
	}

	async function copyVersionInfo(info: AboutInfo) {
		try {
			// The clipboard is missing outside a secure context, such as the server opened over plain HTTP on the LAN.
			if (!navigator.clipboard) throw new Error('Clipboard unavailable')
			await navigator.clipboard.writeText(versionInfoText(info))
			setCopy('copied')
		} catch {
			setCopy('failed')
		}
	}

	const info = load.kind === 'loaded' ? load.info : undefined

	return (
		<section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
			<header className="flex min-h-12 flex-none items-center border-b border-line-100 bg-base-100 px-4 py-1.5">
				<h1 className="m-0 text-sm font-semibold text-ink-100">About</h1>
			</header>
			<div className="min-h-0 flex-1 overflow-y-auto">
				<div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-6">
					<div className="flex items-center gap-4">
						<img src={logo} alt="Nebulosa logo" className="size-16 flex-none" />
						<div className="flex min-w-0 flex-col gap-1">
							<h2 className="m-0 text-xl font-semibold text-ink-100">Nebulosa</h2>
							{info && <p className="m-0 text-sm text-ink-200">{info.description}</p>}
						</div>
					</div>

					<AboutSection title="Application">
						{load.kind === 'loading' && <p className="m-0 text-sm text-ink-300">Loading…</p>}
						{load.kind === 'failed' && (
							<div className="flex flex-wrap items-center gap-3">
								<p className="m-0 min-w-0 flex-1 text-sm text-danger">Could not read the application details: {load.message}</p>
								<Button variant="secondary" onClick={retry}>
									Retry
								</Button>
							</div>
						)}
						{info && (
							<dl className="m-0 grid grid-cols-[8.5rem_minmax(0,1fr)] gap-x-4 max-sm:grid-cols-[7rem_minmax(0,1fr)] gap-y-2 text-sm">
								{aboutFields(info).map(([label, value]) => (
									<DetailRow key={label} label={label} value={value} />
								))}
							</dl>
						)}
						<div className="flex flex-wrap items-center gap-3">
							<Button variant="secondary" disabled={!info} title={info ? undefined : 'The application details are not loaded.'} onClick={() => info && void copyVersionInfo(info)}>
								Copy Version Info
							</Button>
							{copy === 'copied' && <span className="text-sm text-success">Copied.</span>}
							{copy === 'failed' && <span className="text-sm text-danger">Could not copy to the clipboard.</span>}
						</div>
					</AboutSection>

					<AboutSection title="Project">
						<dl className="m-0 grid grid-cols-[8.5rem_minmax(0,1fr)] gap-x-4 max-sm:grid-cols-[7rem_minmax(0,1fr)] gap-y-2 text-sm">
							<dt className="text-ink-300">Author</dt>
							<dd className="m-0 text-ink-100">Tiago Melo</dd>
							<dt className="text-ink-300">License</dt>
							<dd className="m-0">
								<ExternalLink href={LICENSE_URL}>MIT License</ExternalLink>
							</dd>
							<dt className="text-ink-300">Application</dt>
							<dd className="m-0 min-w-0 wrap-break-word">
								<ExternalLink href={APP_REPOSITORY_URL}>github.com/tiagohm/nebulosa.app</ExternalLink>
							</dd>
							<dt className="text-ink-300">Toolkit</dt>
							<dd className="m-0 min-w-0 wrap-break-word">
								<ExternalLink href={CORE_REPOSITORY_URL}>github.com/tiagohm/nebulosa.ts</ExternalLink>
							</dd>
						</dl>
					</AboutSection>
				</div>
			</div>
		</section>
	)
}

// Properties of a section of the About page.
interface AboutSectionProps {
	// Heading of the section.
	readonly title: string
	// Content of the section.
	readonly children: ReactNode
}

// Titled section of the About page.
function AboutSection({ title, children }: AboutSectionProps) {
	return (
		<section className="flex flex-col gap-3">
			<h2 className="m-0 text-xs font-semibold tracking-wide text-ink-200 uppercase">{title}</h2>
			{children}
		</section>
	)
}

// Properties of an identity field of the About page.
interface DetailRowProps {
	// Name of the field.
	readonly label: string
	// Value the server reported; undefined when the build did not record it.
	readonly value?: string
}

// Identity field of the running distribution; a commit is shortened, with the full value as its tooltip.
function DetailRow({ label, value }: DetailRowProps) {
	const commit = value !== undefined && /^[0-9a-f]{40}$/.test(value)

	return (
		<>
			<dt className="text-ink-300">{label}</dt>
			<dd className="m-0 min-w-0 wrap-break-word">
				{value === undefined ? (
					<span className="text-ink-300">{NOT_AVAILABLE}</span>
				) : (
					<span title={commit ? value : undefined} className="text-ink-100">
						{commit ? value.slice(0, SHORT_COMMIT_LENGTH) : value}
					</span>
				)}
			</dd>
		</>
	)
}

// Properties of a link to a page outside the application.
interface ExternalLinkProps {
	// Address of the page.
	readonly href: string
	// Text of the link.
	readonly children: ReactNode
}

// Link opening a page outside the application in a new tab, without giving it access to this one.
function ExternalLink({ href, children }: ExternalLinkProps) {
	return (
		<a href={href} target="_blank" rel="noopener noreferrer" className="text-accent underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
			{children}
		</a>
	)
}
