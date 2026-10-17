import { cn } from 'cn'
import { type KeyboardEvent, useRef, useState } from 'react'
import { useSnapshot } from 'valtio'
import { FileExplorerModal } from '../files/FileExplorerModal'
import { IMAGE_EXTENSIONS } from '../files/files'
import { activeProfile, profileState, setLastImageDirectory } from '../profile/profile'
import { EmptyState, WorkspaceLayout } from '../shell/WorkspaceLayout'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'
import { moveIndex } from '../ui/navigation'
import { Select } from '../ui/Select'
import { ImageViewer } from '../viewer/ImageViewer'
import { FIT_VIEW } from '../viewer/transform'
import { ImageInspector } from './ImageInspector'
import { activeDocument, activeTool, activeView, closeImage, type ImageDocument, imagesState, openImage, selectImage, selectImageTool, setImageView } from './images'
import { IMAGE_TOOL_DEFINITIONS, IMAGE_TOOLS, imageToolUnavailable } from './tools'

// Images workspace: FITS and XISF images opened from the server, one tab each, shown in the shared
// viewer, with the contextual tool each document selected (the Image Inspector at first) in the
// contextual panel. It works without any connection or equipment. Documents, with their own zoom, pan,
// stretch, and tool, stay open while the tab lives, across document and workspace switches.

// Images workspace.
export function ImagesWorkspace() {
	const state = useSnapshot(imagesState)
	const profiles = useSnapshot(profileState)
	const [choosing, setChoosing] = useState(false)
	const document = activeDocument(state)
	const view = activeView(state)
	const tool = activeTool(state)?.tool ?? 'inspector'
	const definition = IMAGE_TOOL_DEFINITIONS[tool]
	const Panel = definition.panel ?? ImageInspector
	const toolSelector = <Select options={IMAGE_TOOLS} value={tool} disabled={!document} format={(t) => IMAGE_TOOL_DEFINITIONS[t].label} disabledReason={imageToolUnavailable} onChange={(t) => document && selectImageTool(imagesState, document.key, t)} className="w-52 max-sm:w-40" />
	const openButton = (
		<Button size="sm" variant="secondary" onClick={() => setChoosing(true)}>
			<Icon name="folder" className="size-4" />
			Open Image
		</Button>
	)

	return (
		<WorkspaceLayout workspace="images" title="Images" actions={openButton} context={toolSelector} panel={{ title: definition.panelTitle, content: <Panel document={document} view={view} onOpen={() => setChoosing(true)} /> }}>
			<div className="flex h-full flex-col">
				{state.documents.length > 0 && <DocumentTabs documents={state.documents} activeKey={state.activeKey} />}
				<div className="min-h-0 flex-1">
					<ImageViewer
						view={view?.view ?? FIT_VIEW}
						onViewChange={(next) => document && setImageView(imagesState, document.key, next)}
						image={view?.rendering && document?.info ? { url: view.rendering.url, width: document.info.width, height: document.info.height } : undefined}
						loading={document?.status === 'loading' || view?.renderPending}
						error={document?.error ?? view?.error}
						empty={<EmptyState title="No image open" description="Open a FITS or XISF image from the server." action={openButton} />}
					/>
				</div>
			</div>
			<FileExplorerModal
				open={choosing}
				title="Open Image"
				initialPath={activeProfile(profiles).settings.lastImageDirectory}
				extensions={IMAGE_EXTENSIONS}
				onClose={() => setChoosing(false)}
				onChoose={(path, directory) => {
					setChoosing(false)
					setLastImageDirectory(profileState, directory)
					void openImage(imagesState, path)
				}}
			/>
		</WorkspaceLayout>
	)
}

interface DocumentTabsProps {
	// Open documents in tab order.
	readonly documents: readonly ImageDocument[]
	// Key of the document shown.
	readonly activeKey?: string
}

// Tab strip of the open documents. Arrow keys move between tabs, Delete closes the focused one.
function DocumentTabs({ documents, activeKey }: DocumentTabsProps) {
	const stripRef = useRef<HTMLDivElement>(null)

	function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
		const index = documents.findIndex((d) => d.key === activeKey)
		const next = moveIndex(index, documents.length, e.key === 'ArrowUp' || e.key === 'ArrowDown' ? '' : e.key)

		if (next !== undefined) {
			e.preventDefault()
			selectImage(imagesState, documents[next].key)
			stripRef.current?.querySelectorAll<HTMLElement>('[data-tab]')[next]?.focus()
		} else if (e.key === 'Delete' && activeKey) {
			e.preventDefault()
			closeImage(imagesState, activeKey)
		}
	}

	return (
		<div ref={stripRef} onKeyDown={handleKeyDown} className="flex h-9 flex-none items-end gap-px overflow-x-auto border-b border-line-100 bg-base-100 px-2">
			{documents.map((document) => {
				const active = document.key === activeKey

				return (
					<div key={document.key} className={cn('group flex h-8 max-w-56 flex-none items-center rounded-t-sm border border-b-0', active ? 'border-line-100 bg-base-000 text-ink-100' : 'border-transparent text-ink-300 hover:bg-base-200 hover:text-ink-100')}>
						<button
							type="button"
							data-tab
							tabIndex={active ? 0 : -1}
							title={document.source.path}
							onClick={() => selectImage(imagesState, document.key)}
							onAuxClick={(e) => e.button === 1 && closeImage(imagesState, document.key)}
							className="flex h-full min-w-0 cursor-pointer items-center gap-2 border-0 bg-transparent pr-1 pl-3 font-mono text-xs text-inherit focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
						>
							{document.status === 'error' && <span className="size-1.5 flex-none rounded-full bg-danger" />}
							<span className="truncate">{document.name}</span>
						</button>
						<button
							type="button"
							tabIndex={-1}
							title={`Close ${document.name}`}
							onClick={() => closeImage(imagesState, document.key)}
							className={cn('mr-1 flex size-5 flex-none cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent p-0 text-ink-300 hover:bg-base-300 hover:text-ink-100', active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100')}
						>
							<Icon name="close" className="size-3.5" strokeWidth={2} />
							<span className="sr-only">Close</span>
						</button>
					</div>
				)
			})}
		</div>
	)
}
