import { EmptyState, WorkspaceLayout } from '../shell/WorkspaceLayout'

// Images workspace: viewing and analysis of opened images, independent of connections and equipment.

// Images workspace.
export function ImagesWorkspace() {
	return (
		<WorkspaceLayout workspace="images" title="Images" panel={{ title: 'Image Inspector', content: <EmptyState title="No image open" /> }}>
			<EmptyState title="No image open" />
		</WorkspaceLayout>
	)
}
