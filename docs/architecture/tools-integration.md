# Tools Integration

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

The Tools workspace is the catalog of Nebulosa's standalone tools and the frame each one opens in (`TOOL_DEFINITIONS` and `TOOL_GROUPS` of `web/src/tools/tools.ts`, `toolReadiness` of `web/src/tools/readiness.ts`).
Each tool belongs to exactly one group, in the order of a night (Planning, Rig & Observatory, Frames, Reference), opens at its own URL inside its own workspace layout, and its card shows a readiness word only by exception.

## Purpose

Many capabilities of Nebulosa are not tied to one device or image: planners, almanacs, references, frame libraries, and observatory services.
The catalog lets the operator find them by the task at hand and tells at a glance which tool is blocked or is keeping work running on the server.

## Relations

- Follows the shell and layout rules of [UI Structure](ui-and-layout.md): a tool's header leads back to the catalog, and the rail reopens the last place shown in Tools.
- Readiness reads the stores of the tab, never second-guessing them: the profile's mount role for the [Meridian Flip Monitor](meridian-flip-monitor.md) and [Mount Remote Control](mount-remote-control.md), the active observing site for [Astro Weather](astro-weather.md), and the media gateway for [Observatory Cameras](observatory-cameras.md).
- A tool keeping work running on the server (an enabled flip monitor, an armed or running [Meridian Flip](meridian-flip.md), a remote-control listener) is listed first while it runs.
- Points to the Images and Sky workspaces for the tasks that live there (plate solving, star detection, focusing, guiding, polar alignment, framing and finding objects).
- Each tool is described by the document of its feature; the [Workspace Responsibility Matrix](workspace-responsibility-matrix.md) lists them.

## Rules and Limitations

- A blocked tool still opens, into its own setup state; a planned tool cannot be opened.
- A tool that only needs the internet, or an input only part of a tool needs, is never marked: the tool shows its own state when opened.
- The catalog's filter and scroll are tab memory, never persisted.
- The Alpaca Server is planned: an `api` service over the toolkit's `AlpacaServer` (`core/src/devices/alpaca/server.ts`), started and stopped explicitly, bound to localhost by default, publishing only an allowlist of devices and never those imported from Alpaca connections, with the Tools view only controlling it.
