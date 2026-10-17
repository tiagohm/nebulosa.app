import { EmptyState, WorkspaceLayout } from '../shell/WorkspaceLayout'

// Sky workspace: sky exploration and observation planning, independent of connections and equipment.

// Sky workspace.
export function SkyWorkspace() {
	return (
		<WorkspaceLayout workspace="sky" title="Sky" panel={{ title: 'Object Inspector', content: <EmptyState title="No object selected" /> }}>
			<EmptyState title="Sky Atlas coming soon" />
		</WorkspaceLayout>
	)
}
