import type { ExternalToolCheck, ExternalToolConfig, ExternalToolState } from 'api'
import { useEffect, useState } from 'react'
import { Actions, Notice, Readout } from '../equipment-control/parts'
import { PanelSection } from '../shell/ContextualPanel'
import { Button } from '../ui/Button'
import { NumberInput } from '../ui/NumberInput'
import { TextInput } from '../ui/TextInput'
import { CAPABILITY_LABELS, checkMatches, externalToolsState, sameConfig, saveExternalTool, signInExternalTool, signOutExternalTool, testExternalTool } from './externaltools'
import { type CheckDisplay, CheckBadge, ConfigBadge } from './ExternalToolStatus'

// Settings of one external program or web service: the settings it takes (its executable path on the server,
// the configuration file passed to it, or the endpoint of the service) and the default time limit of a run,
// edited as a local draft that only Save sends to the server. A web service is signed in to with an API key typed
// here, sent once to the server and never kept in the draft or the browser; only whether a session is saved is
// shown. Test checks the draft on the server's
// filesystem without saving it, and its result is shown only while the draft still has the values it
// checked. Saved settings changed by another tab replace an unchanged draft; an edited draft is kept and
// its save is refused until it is reloaded.

export interface ExternalToolDetailProps {
	// Program shown, as the server reports it.
	readonly tool: ExternalToolState
	// Reports whether the draft differs from the saved settings.
	readonly onDirtyChange: (dirty: boolean) => void
}

// Saved settings a draft was edited from.
interface Base {
	// Revision of the saved settings.
	readonly revision: number
	// Saved settings.
	readonly config: ExternalToolConfig
}

// Formats an instant (milliseconds since the Unix epoch) as local date and time.
function formatInstant(time: number) {
	return new Date(time).toLocaleString()
}

// Diagnostics of a check, collapsed by default.
function CheckDiagnostics({ check }: { readonly check: ExternalToolCheck }) {
	return (
		<details className="text-[13px] leading-5 text-ink-200">
			<summary className="cursor-pointer text-[11px] font-medium tracking-[0.08em] text-ink-300 uppercase select-none">Diagnostics</summary>
			<div className="mt-2 flex flex-col gap-1">
				{check.config.endpoint === undefined ? <Readout label="Executable path">{check.config.executable || '—'}</Readout> : <Readout label="Endpoint">{check.config.endpoint || 'Default'}</Readout>}
				{check.config.config !== undefined && <Readout label="Configuration file">{check.config.config || 'Default'}</Readout>}
				<Readout label="Resolved path">{check.resolvedPath ?? '—'}</Readout>
				<Readout label="Version">{check.version ?? 'Unknown'}</Readout>
				<Readout label="Checked at">{formatInstant(check.checkedAt)}</Readout>
				<Readout label="Duration">{check.duration.toFixed(1)} ms</Readout>
				<Readout label="Code">{check.code}</Readout>
			</div>
		</details>
	)
}

// Sign-in of a web service: signed in or not, a password field for the API key, and the action that changes it. The
// key is cleared once sent. Disabled while the draft has unsaved edits, since a sign-in uses the saved endpoint.
function SignIn({ tool, disabled }: { readonly tool: ExternalToolState; readonly disabled: boolean }) {
	const [apiKey, setApiKey] = useState('')
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string>()

	async function change(signIn: boolean) {
		setBusy(true)
		setError(undefined)
		const result = signIn ? await signInExternalTool(externalToolsState, tool.id, apiKey.trim()) : await signOutExternalTool(externalToolsState, tool.id)
		setBusy(false)
		if ('error' in result) setError(result.error)
		else setApiKey('')
	}

	return (
		<PanelSection title="Account">
			<Readout label="Session">{tool.signedIn ? 'Signed in' : 'Signed out'}</Readout>
			{tool.signedIn ? (
				<Actions>
					<Button variant="secondary" disabled={busy} onClick={() => void change(false)}>
						{busy ? 'Signing Out…' : 'Sign Out'}
					</Button>
				</Actions>
			) : (
				<>
					<TextInput label="API Key" type="password" spellCheck={false} autoComplete="off" value={apiKey} disabled={disabled || busy} onChange={(e) => setApiKey(e.target.value)} />
					<Actions>
						<Button disabled={disabled || busy || !apiKey.trim()} onClick={() => void change(true)}>
							{busy ? 'Signing In…' : 'Sign In'}
						</Button>
					</Actions>
					<Notice>The key is sent once to the service through the server and never stored; only the session the service returns is saved on the server. Images solved with this service are uploaded to it.</Notice>
				</>
			)}
			{disabled && !tool.signedIn && <Notice>Save or reset the changes first: signing in uses the saved endpoint.</Notice>}
			{error && <Notice error>{error}</Notice>}
		</PanelSection>
	)
}

// Settings of an external program.
export function ExternalToolDetail({ tool, onDirtyChange }: ExternalToolDetailProps) {
	const [base, setBase] = useState<Base>({ revision: tool.revision, config: tool.config })
	const [draft, setDraft] = useState<ExternalToolConfig>(tool.config)
	const [saving, setSaving] = useState(false)
	const [testing, setTesting] = useState(false)
	const [test, setTest] = useState<ExternalToolCheck>()
	const [error, setError] = useState<string>()
	const dirty = !sameConfig(draft, base.config)

	// Follows settings saved elsewhere while the draft is unchanged, or already has their values.
	if (tool.revision !== base.revision && (!dirty || sameConfig(draft, tool.config))) {
		setBase({ revision: tool.revision, config: tool.config })
		setDraft(tool.config)
	}

	useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange])

	const outdated = tool.revision !== base.revision
	const { min, max } = tool.timeoutLimits
	const check = test && checkMatches(test, draft) ? test : tool.lastCheck && checkMatches(tool.lastCheck, draft) ? tool.lastCheck : undefined
	const checkStatus: CheckDisplay = testing ? 'checking' : (check?.status ?? 'notTested')
	const staleTest = !testing && !check && test !== undefined

	function edit(config: ExternalToolConfig) {
		setDraft(config)
		setError(undefined)
	}

	function reload() {
		setBase({ revision: tool.revision, config: tool.config })
		setDraft(tool.config)
		setError(undefined)
	}

	async function save() {
		setSaving(true)
		setError(undefined)
		const result = await saveExternalTool(externalToolsState, tool.id, draft, base.revision)
		setSaving(false)

		if (result.status === 'saved') {
			setBase({ revision: result.tool.revision, config: result.tool.config })
			setDraft(result.tool.config)
			// A draft tested before saving is checked again, so the saved settings get a check every tab sees.
			if (test && checkMatches(test, result.tool.config) && !result.tool.lastCheck) await runTest()
		} else if (result.status === 'error') {
			setError(result.error)
		}
	}

	async function runTest() {
		setTesting(true)
		setError(undefined)
		const result = await testExternalTool(tool.id, draft)
		setTesting(false)
		if ('check' in result) setTest(result.check)
		else setError(result.error)
	}

	return (
		<div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
			<header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line-100 px-4 py-3">
				<div className="flex min-w-0 flex-1 basis-60 flex-col">
					<h2 className="m-0 truncate text-[15px] leading-[22px] font-medium text-ink-100">{tool.name}</h2>
					<p className="m-0 text-xs text-ink-300">{tool.description}</p>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<ConfigBadge status={tool.status} />
					<CheckBadge status={checkStatus} />
				</div>
			</header>
			{tool.error && (
				<div className="border-b border-line-100 px-4 py-2">
					<Notice error>{tool.error}. Saving replaces it with these settings, unless it was written by a newer version.</Notice>
				</div>
			)}
			{outdated && (
				<div className="flex flex-wrap items-center gap-3 border-b border-line-100 px-4 py-2">
					<Notice error>These settings were saved elsewhere since you started editing. Reload them to continue; your changes will be discarded.</Notice>
					<Button variant="secondary" onClick={reload}>
						Reload
					</Button>
				</div>
			)}
			<PanelSection title="Configuration">
				{tool.fields.includes('executable') && (
					<>
						<TextInput label="Executable Path" placeholder="Full path on the server, such as /usr/bin/astap" spellCheck={false} autoComplete="off" value={draft.executable} onChange={(e) => edit({ ...draft, executable: e.target.value })} />
						<Notice>The path is resolved on the computer running the Nebulosa server, not on this browser's computer. A name without a folder is looked up on the server's PATH.</Notice>
					</>
				)}
				{tool.fields.includes('config') && (
					<>
						<TextInput label="Configuration File" placeholder="Default configuration of the program" spellCheck={false} autoComplete="off" value={draft.config ?? ''} onChange={(e) => edit({ ...draft, config: e.target.value })} />
						<Notice>Optional backend configuration on the server, which names the folders of the index files. Without one, the program's default configuration is used.</Notice>
					</>
				)}
				{tool.fields.includes('endpoint') && (
					<>
						<TextInput label="Endpoint" placeholder="https://nova.astrometry.net" spellCheck={false} autoComplete="off" value={draft.endpoint ?? ''} onChange={(e) => edit({ ...draft, endpoint: e.target.value })} />
						<Notice>Base URL of the service; the public nova.astrometry.net when empty. Changing it signs out.</Notice>
					</>
				)}
				<NumberInput label="Default Timeout" suffix="s" min={min / 1000} max={max / 1000} step={1} value={draft.timeout / 1000} onChange={(seconds) => edit({ ...draft, timeout: seconds * 1000 })} />
				<Notice>
					Time limit of each run, from {min / 1000} to {max / 1000} seconds. Services that run {tool.name} use these settings; an operation keeps the settings it started with.
				</Notice>
			</PanelSection>
			<PanelSection title="Actions">
				<Actions>
					<Button disabled={!dirty || saving || outdated} onClick={() => void save()}>
						{saving ? 'Saving…' : 'Save Changes'}
					</Button>
					<Button variant="secondary" disabled={testing} onClick={() => void runTest()}>
						Test Configuration
					</Button>
					{dirty && (
						<Button variant="ghost" disabled={saving} onClick={() => edit(base.config)}>
							Reset Changes
						</Button>
					)}
					{dirty && <span className="text-xs text-accent">Unsaved Changes</span>}
				</Actions>
				{error && <Notice error>{error}</Notice>}
			</PanelSection>
			{tool.session && <SignIn tool={tool} disabled={dirty || outdated} />}
			<PanelSection title="Availability">
				{check ? (
					<>
						<Notice error={check.status !== 'available'}>{check.message}</Notice>
						<Notice>{tool.session ? 'Test checks the endpoint and the saved session without contacting the service.' : `Test checks the files on the server only; it does not start ${tool.name} nor analyze an image.`}</Notice>
						<CheckDiagnostics check={check} />
					</>
				) : (
					<Notice>{testing ? 'Checking on the server…' : staleTest ? 'The last test checked other values. Test again to check the current ones.' : 'Not tested. Test checks the settings on the server without saving them.'}</Notice>
				)}
				<Readout label="Capabilities">{tool.capabilities.map((capability) => CAPABILITY_LABELS[capability]).join(', ')}</Readout>
				<Readout label="Revision">{tool.revision}</Readout>
			</PanelSection>
		</div>
	)
}
