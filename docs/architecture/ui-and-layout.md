# UI Structure

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

The structure a new screen fits into, so it lands in the existing shell without a layout system of its own.
Where each feature lives is the [Workspace Responsibility Matrix](workspace-responsibility-matrix.md).

## Shell

- The shell (`web/src/shell/ApplicationShell.tsx`) is always mounted while navigating: the top bar, the navigation rail, the workspace or page of the route, and the status bar.
- Only the workspace or page of the route is swapped on navigation, and a render error inside it is caught in its place (`WorkspaceErrorBoundary`), so the rest of the shell, the Abort of running operations above all, stays usable.
- The navigation rail lists the workspaces (`WORKSPACES`) and the About page; pages opened from the Management menu or the top bar are not listed.
- Connections, Equipment Setup, and Profiles are modals of the shell, not routes.
- The observing site menu of the top bar is the one place that shows the active site; no workspace or tool repeats it.
- The status bar is the only global status surface: the devices of the active profile's roles, and every running operation that holds a device of its connection, each with the Abort that sends the one command that interrupts it, the same as the page that started it (see [Operation Lifecycle Rules](operation-lifecycle-rules.md)).
- Closing a panel or navigating away never stops a session or an operation; only an explicit interruption does.

## Workspace Frame

- Every workspace and every tool view is framed by `WorkspaceLayout` (`web/src/shell/WorkspaceLayout.tsx`): optional tabs spanning the workspace, a header with the title, the context controls, the workspace actions, and the panel toggle, then the content beside the contextual panel.
- The buttons a workspace or tool puts in its header are its workspace actions (the `actions` of `WorkspaceLayout`), never a toolbar strip inside the content.
- The contextual panel is the column of the current context, docked on wide screens and a drawer otherwise; it holds no operational state, so collapsing or replacing it never stops what its controls started.
- The panel shows one content at a time: Images the panel of the selected tool, Sky the selected panel view.
- A workspace whose own controls show the panel holds its visibility with `useWorkspacePanel`, so a control that needs the panel opens it in either form.
- A contextual panel holds collapsible sections only, at its top level, each keyed by a namespaced id that keeps its expanded state; it never nests a disclosure inside a section, and `EmptyState` replaces a whole panel that has nothing to show.
- Pages (Equipment Control, Settings) use a list and a detail area instead of a contextual panel.

## Availability

- Requirements are judged from the roles of the equipment setup and the state of their devices (see [Device Resource Matrix](device-resource-matrix.md)).
- Unavailable actions stay visible and disabled, with the reason as their tooltip.
- A panel that needs equipment says what to set up and offers Equipment Setup, never another connected device.
- Values shown are those the server reports; inputs hold pending values until an explicit action applies them.
- Status is always text, colour only reinforces it, and absence is shown as absence.

## Shared Building Blocks

- Shared primitives live in `web/src/ui/`; a new screen composes them, and a new primitive is added there only when two features need it.
- Values are written by the semantic formatters of `web/src/format.ts`, one per quantity, and instants read in the display zone of the active site.
- Every pixel image is shown by `ImageViewer` (`web/src/viewer/`) with overlays in image coordinates (see [Shared Image](shared-image.md) and [Overlays](overlay.md)).
