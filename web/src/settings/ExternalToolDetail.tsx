import type { ExternalToolCheck, ExternalToolConfig, ExternalToolState, GatewayStatus } from 'api'
import { useEffect, useState } from 'react'
import { useSnapshot } from 'valtio'
import { formatZonedDateTime, MISSING } from '../format'
import { useActiveTimeZone } from '../location/useLocation'
import { PanelSection } from '../shell/ContextualPanel'
import { observatoryCamerasState } from '../tools/observatorycameras/observatorycameras'
import { Actions } from '../ui/Actions'
import { Button } from '../ui/Button'
import { DataRow } from '../ui/DataRow'
import { DisclosureSummary } from '../ui/DisclosureSummary'
import { Notice } from '../ui/Notice'
import { NumberInput } from '../ui/NumberInput'
import { TextInput } from '../ui/TextInput'
import { CAPABILITY_LABELS, checkMatches, externalToolsState, hasSettings, sameConfig, saveExternalTool, signInExternalTool, signOutExternalTool, testExternalTool } from './externaltools'
import { savedDisplay, ToolBadge, type ToolDisplay, toolDisplay } from './ExternalToolStatus'

// Settings of one external program or web service: its state and the test that proves it first, then the settings it
// takes (its executable path on the server, the configuration file passed to it, the endpoint of the service, or the
// folders of the built-in solver) and
// the time limit of a run, edited as a local draft that only Save sends to the server, then what it is used for and
// needs. A web service is signed in to with an API key typed here, sent once to the server and never kept in the draft
// or the browser; only whether the server holds a session is shown. Test checks the draft on the server without saving
// it, starting the program once to print its version, and its result is shown only while the draft still has the values
// it checked. The header shows the state of the saved settings, the same one as the list; a result of unsaved values is
// marked as such. Saved settings changed by another tab replace an unchanged draft; an edited draft is kept and its save
// is refused until it is reloaded.

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

// Example of the executable of each program, a name the server looks up on its PATH.
const EXECUTABLE_EXAMPLES: Readonly<Partial<Record<ExternalToolState['id'], string>>> = { astap: 'astap_cli', astrometryLocal: 'solve-field', mediamtx: 'mediamtx' }

// What a run of each capability is, for the explanation of the time limit.
const RUN_NAMES: Readonly<Partial<Record<ExternalToolState['capabilities'][number], string>>> = { 'plate-solving': 'a plate solve', 'star-detection': 'a star detection' }

// Label of each state of the media gateway of the observatory cameras.
const GATEWAY_LABELS: Readonly<Record<GatewayStatus, string>> = { notInstalled: 'Not Installed', starting: 'Starting', ready: 'Running', restarting: 'Restarting', unavailable: 'Unavailable', stopping: 'Stopping', stopped: 'Stopped' }

// Returns a time limit in milliseconds as the person reads it: whole seconds below a minute ("15 s"), else whole
// minutes ("60 min"), else minutes and seconds.
function formatLimit(milliseconds: number) {
	const seconds = Math.round(milliseconds / 1000)
	if (seconds < 60) return `${seconds} s`
	return seconds % 60 === 0 ? `${seconds / 60} min` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`
}

// Details of a check, collapsed by default: where the program resolved to, the version it printed (the folders of the
// built-in solver instead), and when it ran.
function CheckDiagnostics({ check, session, folders }: { readonly check: ExternalToolCheck; readonly session: boolean; readonly folders: boolean }) {
	const timeZone = useActiveTimeZone()
	return (
		<details className="-my-2 text-sm leading-5 text-ink-200">
			<DisclosureSummary title="Diagnostics" />
			<div className="flex flex-col gap-1 pb-2">
				{session ? (
					<DataRow label="Endpoint">{check.config.endpoint || 'Default'}</DataRow>
				) : folders ? (
					<>
						<DataRow label="Index folder">{check.config.indexDirectory || MISSING}</DataRow>
						<DataRow label="Star database folder">{check.config.catalogDirectory || MISSING}</DataRow>
					</>
				) : (
					<>
						<DataRow label="Resolved path">{check.resolvedPath ?? MISSING}</DataRow>
						<DataRow label="Version">{check.version ?? (check.code === 'ok' || check.code === 'noDatabase' ? 'Not printed' : MISSING)}</DataRow>
					</>
				)}
				<DataRow label="Checked at">{formatZonedDateTime(check.checkedAt, timeZone)}</DataRow>
			</div>
		</details>
	)
}

// State of the media gateway the server keeps running with MediaMTX, as Observatory Cameras reports it.
function GatewayRow() {
	const { gateway } = useSnapshot(observatoryCamerasState)
	if (!gateway) return null
	const tone = gateway.status === 'ready' ? 'success' : gateway.status === 'unavailable' ? 'danger' : 'default'

	return (
		<>
			<DataRow label="Gateway" tone={tone}>
				{GATEWAY_LABELS[gateway.status]}
			</DataRow>
			{gateway.status === 'unavailable' && gateway.message && <Notice error>{gateway.message}</Notice>}
			{gateway.status === 'stopped' && <Notice>It starts once an observatory camera is enabled.</Notice>}
		</>
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

	// Why Sign In cannot be pressed, for its tooltip.
	const signInReason = disabled ? 'Save or reset the changes first' : busy ? 'Signing in…' : !apiKey.trim() ? 'Enter the API key of your account' : undefined

	return (
		<PanelSection title="Account">
			<DataRow label="Session">{tool.signedIn ? 'Signed in' : 'Signed out'}</DataRow>
			{tool.signedIn ? (
				<Actions>
					<Button variant="secondary" disabled={busy} title={busy ? 'Signing out…' : undefined} onClick={() => void change(false)}>
						{busy ? 'Signing Out…' : 'Sign Out'}
					</Button>
				</Actions>
			) : (
				<>
					<TextInput label="API Key" type="password" value={apiKey} disabled={disabled || busy} onChange={(e) => setApiKey(e.target.value)} />
					<Actions>
						<Button disabled={signInReason !== undefined} title={signInReason} onClick={() => void change(true)}>
							{busy ? 'Signing In…' : 'Sign In'}
						</Button>
					</Actions>
					<Notice>The key is sent once to the service through the server and never stored. The session the service returns is kept in the memory of the server only, so a restart of the server signs out. Images solved with this service are uploaded to it.</Notice>
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
	// An editor that goes away, such as one whose record another tab deleted, leaves no unsaved changes behind.
	useEffect(() => () => onDirtyChange(false), [onDirtyChange])

	const outdated = tool.revision !== base.revision
	const { min, max } = tool.timeoutLimits
	// Whether the program is a gateway the server keeps running, whose timeout bounds its start, not a run.
	const gateway = tool.capabilities.includes('video-gateway')
	// Whether the program is the built-in solver, which takes folders instead of an executable.
	const folders = tool.fields.includes('indexDirectory')
	const check = test && checkMatches(test, draft) ? test : tool.lastCheck && checkMatches(tool.lastCheck, draft) ? tool.lastCheck : undefined
	const staleTest = !testing && !check && test !== undefined
	// Whether the values in the fields are set up enough to be used: a web service signed in to, a program with an
	// executable, the built-in solver with a folder.
	const draftConfigured = tool.session ? tool.signedIn === true : hasSettings(draft)
	// State of the values in the fields, and of the saved settings shown in the header like in the list.
	const display: ToolDisplay = testing ? 'checking' : toolDisplay(check, tool.session, draftConfigured)
	const headerDisplay: ToolDisplay = testing && !dirty ? 'checking' : savedDisplay(tool)
	const runs = tool.capabilities.flatMap((capability) => RUN_NAMES[capability] ?? []).join(' or ')
	// Why Save cannot be pressed, for its tooltip.
	const saveReason = outdated ? 'Reload the settings saved elsewhere first' : saving ? 'Saving…' : !dirty ? 'No changes to save' : undefined

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
			// Saved settings without a check are tested at once, so every tab sees their state.
			if (!result.tool.lastCheck && (tool.session || hasSettings(result.tool.config))) await runTest(result.tool.config)
		} else if (result.status === 'error') {
			setError(result.error)
		}
	}

	async function runTest(config: ExternalToolConfig = draft) {
		setTesting(true)
		setError(undefined)
		const result = await testExternalTool(tool.id, config)
		setTesting(false)
		if ('check' in result) setTest(result.check)
		else setError(result.error)
	}

	// The sentence under the state: the result of the check, or what to do before there is one.
	function verdict() {
		if (testing) return 'Testing on the server…'
		if (check) return check.message
		if (staleTest) return 'The last test checked other values. Test again to check these.'
		if (draftConfigured) return dirty ? 'These values are not tested yet. Test them before saving.' : 'Not tested since the server started.'
		if (tool.session) return 'Sign in with the API key of your account to use the service.'
		return folders ? 'Set the folder of the index files or of a star database below, then test it.' : `Set the executable of ${tool.name} below, then test it.`
	}

	return (
		<div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
			<div className="max-w-xl">
				<header className="flex flex-col gap-1 border-b border-line-100 px-4 py-3">
					<div className="flex flex-wrap items-center gap-x-3 gap-y-1">
						<h2 className="m-0 min-w-0 flex-1 truncate leading-6 font-medium text-ink-100">{tool.name}</h2>
						<ToolBadge display={headerDisplay} />
					</div>
					<Notice>{tool.description}</Notice>
				</header>
				{outdated && (
					<div className="flex flex-wrap items-center gap-3 border-b border-line-100 px-4 py-2">
						<Notice error>These settings were saved elsewhere since you started editing. Reload them to continue; your changes will be discarded.</Notice>
						<Button variant="secondary" onClick={reload}>
							Reload
						</Button>
					</div>
				)}
				<PanelSection title="Status">
					{dirty && (
						<DataRow label="Unsaved values">
							<ToolBadge display={display} />
						</DataRow>
					)}
					<p className="m-0 text-sm leading-5 text-pretty text-ink-100">{verdict()}</p>
					{check && <CheckDiagnostics check={check} session={tool.session} folders={folders} />}
					<Actions>
						<Button variant="secondary" disabled={testing} title={testing ? 'A test is in progress' : undefined} onClick={() => void runTest()}>
							{testing ? 'Testing…' : 'Test Settings'}
						</Button>
					</Actions>
					<Notice>
						{tool.session
							? 'Test checks the endpoint and the session of the server without contacting the service.'
							: folders
								? 'Test looks for the index files and star databases in the folders on the server, without saving; it does not read them nor analyze an image.'
								: `Test starts ${tool.name} once on the server to print its version${tool.id === 'astap' ? ' and looks for its star database' : ''}, without saving; it does not analyze an image.`}
					</Notice>
				</PanelSection>
				{tool.session && <SignIn tool={tool} disabled={dirty || outdated} />}
				<PanelSection title="Configuration">
					{tool.fields.includes('executable') && (
						<>
							<TextInput label="Executable Path" placeholder={`Full path on the server, or a name on its PATH, such as ${EXECUTABLE_EXAMPLES[tool.id] ?? tool.id}`} value={draft.executable} onChange={(e) => edit({ ...draft, executable: e.target.value })} />
							<Notice>The path is resolved on the computer running the Nebulosa server, not on this browser's computer. A name without a folder is looked up on the server's PATH.</Notice>
						</>
					)}
					{tool.fields.includes('config') && (
						<>
							<TextInput label="Configuration File" placeholder="Empty for the default configuration of the program" value={draft.config ?? ''} onChange={(e) => edit({ ...draft, config: e.target.value })} />
							<Notice>Optional backend configuration on the server, which names the folders of the index files. Without one, the program's default configuration is used.</Notice>
						</>
					)}
					{tool.fields.includes('indexDirectory') && (
						<>
							<TextInput label="Index Folder" placeholder="Full path of a folder on the server" value={draft.indexDirectory ?? ''} onChange={(e) => edit({ ...draft, indexDirectory: e.target.value })} />
							<Notice>Folder of Nebulosa (.nqi) and Astrometry.net (index-*.fits) quad index files on the server, searched with its subfolders. They solve images anywhere on the sky at the scales of their bands.</Notice>
						</>
					)}
					{tool.fields.includes('catalogDirectory') && (
						<>
							<TextInput label="Star Database Folder" placeholder="Optional, such as the folder of ASTAP" value={draft.catalogDirectory ?? ''} onChange={(e) => edit({ ...draft, catalogDirectory: e.target.value })} />
							<Notice>Folder of an ASTAP (D05, D20, D50, D80) or HNSKY (G14, G16) star database on the server; the deepest one is used. It solves images around a known position and scale when the index files find nothing.</Notice>
						</>
					)}
					{tool.fields.includes('endpoint') && (
						<>
							<TextInput label="Endpoint" placeholder="Empty for the public nova.astrometry.net" value={draft.endpoint ?? ''} onChange={(e) => edit({ ...draft, endpoint: e.target.value })} />
							<Notice>Base URL of the service. Changing it signs out.</Notice>
						</>
					)}
					<NumberInput label={gateway ? 'Startup Time Limit' : 'Run Time Limit'} suffix="s" min={min / 1000} max={max / 1000} step={1} value={draft.timeout / 1000} onChange={(seconds) => edit({ ...draft, timeout: seconds * 1000 })} />
					<Notice>
						{gateway
							? `Time ${tool.name} may take to become ready after starting, from ${formatLimit(min)} to ${formatLimit(max)}. The server keeps it running while any observatory camera is enabled, and saving restarts it.`
							: `Longest ${runs} with ${tool.name} may run before it is stopped, from ${formatLimit(min)} to ${formatLimit(max)}. An operation keeps the settings it started with.`}
					</Notice>
					<Actions>
						<Button disabled={saveReason !== undefined} title={saveReason} onClick={() => void save()}>
							{saving ? 'Saving…' : 'Save Changes'}
						</Button>
						{dirty && (
							<Button variant="secondary" disabled={saving} onClick={() => edit(base.config)}>
								Reset Changes
							</Button>
						)}
						{dirty && <span className="text-xs text-warning">Unsaved Changes</span>}
					</Actions>
					{dirty && (display === 'notFound' || display === 'failed') && <Notice warning>The test found a problem with these values: once saved, what uses {tool.name} fails until they are fixed.</Notice>}
					{error && <Notice error>{error}</Notice>}
				</PanelSection>
				<PanelSection title="Usage">
					<DataRow label="Used for">{tool.capabilities.map((capability) => CAPABILITY_LABELS[capability]).join(', ')}</DataRow>
					{gateway && <GatewayRow />}
					<Notice>{tool.requirements}</Notice>
				</PanelSection>
			</div>
		</div>
	)
}
