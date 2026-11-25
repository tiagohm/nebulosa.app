# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary user is an amateur astrophotographer running their own rig: cameras, mount, focuser, filter wheel, and the other accessories exposed by INDI or Alpaca drivers. They use Nebulosa through a night of imaging, beside the telescope or from elsewhere on the local network, to plan what to shoot, set up and control the equipment, capture, and check the frames as they arrive.

## Product Purpose

Nebulosa is an integrated astronomical imaging application. It replaces the chain of separate programs an imager usually runs (planetarium, planners, capture and device control, focusing and polar alignment, plate solving, guiding, image analysis and stacking) with one application that shares one state. Success is a night where the operator never has to leave Nebulosa, and where every running operation stays visible and controllable from whatever screen they are holding.

## Positioning

- **One self-contained executable.** The Bun server and the React UI ship as a single binary per operating system. There is no installer and no native GUI toolkit; any browser that can reach the server is the interface.
- **Integrated end to end.** Planning (Sky map, Observing Planner, Jupiter and Saturn planners, Astro Weather, Planetary Events, Meteor Showers, Artificial Satellites, eclipse maps), device control and capture, and image analysis, processing, and stacking live in one application and read the same profile, equipment setup, and observing site.
- **Server-owned, multi-tab state.** Operations run on the server under one arbiter. Every tab, on every device, mirrors them live through the event stream, so a reload or a closed browser never loses running work.
- **Open source on its own toolkit.** MIT-licensed, built on its own TypeScript astronomy toolkit ([`nebulosa.ts`](https://github.com/tiagohm/nebulosa.ts), the `core/` submodule) rather than wrapping third-party engines.

## Operating Context

- Used at night, in the dark, at the telescope or within reach of it. Dark adaptation matters.
- Regularly operated from a phone or tablet over the local network, not only from a desktop beside the rig.
- Sessions run for hours, often unattended. The operator walks away and comes back expecting to read the state of everything at a glance.
- Often run at dark sites with no internet. Core work (device control, capture, analysis, the sky catalog, the planners) must not depend on online services; online sources (weather, SDO images, SkyBoT, satellite elements) are enhancements that degrade to absence.
- Plate solving and star detection are built in and need no external program; the operator downloads or installs the index files of the plate solver and, for observatory cameras, MediaMTX, and configures them in Settings.
- The server has no authentication: it is meant for `localhost` or a trusted network.

## Capabilities and Constraints

- Workspaces: Images (documents and camera tabs, with image tools and camera operations), Sky (planetarium, search, inspectors, framing), and Tools (standalone tools). Pages outside the navigation rail: Equipment Control, Settings, About.
- The full inventory and its status (Implemented, Partial, Integration Required, Planned) is [docs/architecture/capability-inventory.md](docs/architecture/capability-inventory.md). The next delivery is the Sequencer.
- Terminology is fixed by the glossary of [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): connection, device, profile, equipment setup and role, Equipment Catalog, operation, reservation, session, image document, camera tab, lease.
- The equipment setup is the absolute source of truth about the devices in use; no screen second-guesses it.
- Where each feature lives in the UI and the structural rules it follows are in [docs/architecture/ui-and-layout.md](docs/architecture/ui-and-layout.md); the visual system is in [DESIGN.md](DESIGN.md).
- The UI works from phone width up, never scrolls the page horizontally, and turns the contextual panel into a drawer below 1024 px.
- Values shown are the ones the server reports. Inputs hold pending values until an explicit action. Absence is shown as absence, never as zero.

## Brand Commitments

- The name is **Nebulosa** (Portuguese for nebula). Its icon is `web/assets/nebulosa.ico`.
- Voice: plain, precise English. Every quantity carries its unit. Status is stated in words. Commands are named by what they do (Solve Image, Slew to Object, Connect all).

## Evidence on Hand

- The application itself, its architecture documents under `docs/`, and the README.
- Credits for every external service, dataset, published method, and program in `CREDIT_GROUPS` (`web/src/about/about.ts`).
- There are no testimonials, user counts, benchmarks, press, or case studies. Future work must not invent them.

## Product Principles

1. **The night is the product.** Every screen serves an operator in the dark, often away from the keyboard, sometimes on a phone. Nothing should cost them dark adaptation, attention, or a trip back to the desk.
2. **Running work is never hidden.** What the devices are doing, and how to stop it, is always one glance and one action away, from every tab.
3. **One application, one state.** A new capability joins the existing workspaces, profile, and equipment setup rather than becoming a separate island.
4. **Trust the operator's setup and the server's readings.** Show what the server reports, act only on explicit commands, and never guess or second-guess the equipment.
5. **Work offline first.** Online data enriches; its absence never blocks the core of a night.

## Accessibility & Inclusion

- Status is always text; colour only reinforces it.
- Lists, rails, tabs, carousels, and selectable table rows are operable with the arrow keys, Home, End, Enter, and Space.
- Controls are named with native elements, `title`, and visually hidden text. Neither ARIA attributes nor attributes for screen readers are used, by project rule (`AGENTS.md`).
- Transitions honour reduced motion, and focus is always visible.
- Unavailable actions stay visible and disabled, with the reason as their tooltip.
