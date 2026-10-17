import { EmptyState, WorkspaceLayout } from '../shell/WorkspaceLayout'

// Tools workspace: the catalog where tools are discovered and opened.

// Tools workspace.
export function ToolsWorkspace() {
	return (
		<WorkspaceLayout workspace="tools" title="Tools" panel={{ title: 'Tool Details', content: <EmptyState title="No tool selected" /> }}>
			<EmptyState title="No tools available yet" />
		</WorkspaceLayout>
	)
}
