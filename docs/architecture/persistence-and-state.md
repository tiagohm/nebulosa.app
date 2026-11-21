# Persistence and State

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

Where each kind of state lives, and why.

## Where State Lives

- **The operational database** (server): what must survive a restart and be shared by every tab and browser: the workspace, settings of the server instance, objects an operator created, scientifically relevant records, and useful outcomes, such as saved frames, calibration masters, stacking projects, pointing models, guiding calibrations, framings, night plans, the satellite catalog, the SPICE kernels, and the outcomes of operations.
- **The workspace** (server, in the database): the saved connections, the observing sites, the Equipment Catalog, and the profiles with their equipment setups, preferences, and camera forms (`api/src/workspace.ts`).
  The tab edits it and writes back each unit that changed (`WorkspaceSync` of `web/src/profile/sync.ts`); a unit edited from an outdated revision is refused with what the server kept, and every write is published so the other tabs apply it.
  The shell waits for the first read and never runs on a profile of its own making.
- **Server memory**: what is live or derived and ends with the process: connections, devices, operations, sessions, image pixels, analysis jobs and their results, the notification history, and the caches of remote services.
  Long-lived services, such as Mount Remote Control listeners and Meridian Flip Monitors, are never restarted after a restart.
- **Tab memory**: the presentation of the tab, such as the document view, selections, drafts, and the results a tool shows; it starts over on a reload.
- **Browser storage**: only the view state of the tab (`ViewPersistence` of `web/src/profile/view.ts`): the active profile, the fields the profile schema marks as view state, and a few view entries such as the expanded panel sections, kept for the tab across its reloads or for every tab of the browser.
- **Files under the data directory**: scientific files stay files (captured frames, the products of the Calibration Library, Image Stacking, and Live Stacking, SPK kernels, the IERS tables), and the database holds their identities and metadata.
  A product directory without a row is never adopted, but moved aside, never deleted.
- **Bundled assets**: the catalogs the `bin` scripts generate are read-only assets embedded or bundled with the application, not operational state.
- **The URL path**: the route.

Rules:

- Every durable path derives from the data directory: `--home`, else `NEBULOSA_HOME`, else `~/Nebulosa`.
- Secrets and service sessions are never stored in the database.
- Per-device forms and preferences belong to the physical device (connection id and device id), never to a role.
- A preference never starts, stops, or changes a running service, and an operation fits the forms it was given when it starts and keeps that snapshot.

## Central Database

- One operational database, `nebulosa.sqlite` under the data directory, owned by `api/src/database/` (`AppDatabase`), is the only mutable durable store of the application.
- The server opens it before any service serves, and stops, saying why, when it cannot.
- Each domain writes through a store that receives the `AppDatabase`; no service writes operational state as a file or opens a database of its own, which `api/src/persistence.test.ts` guards.
- The schema is one migration file, `api/src/database/migrations/0001_initial.sql`, edited in place while the application is in development; numbered migrations start with the first release.
- Writes are synchronous transactions that never wait on files or the network, and an event is broadcast only after its transaction committed.
- In production only one server can use a data directory at a time; in development the database stays open to other processes.
- Nothing of a former storage is read, converted, or imported.

## No Migrations in Development

- Kept data is never migrated while the application is in development: a change to the shape of what is stored only raises its version, and the old data is discarded.
- Profile values carry `PROFILE_SETTINGS_VERSION` and the view documents `VIEW_VERSION`; a value of another version reads as absent.
- A database table whose definition or `-- @version` changed is emptied, with the tables that depend on it, and created again; raising `BASELINE_EPOCH` recreates the whole database.
- An added optional field reads as its default and raises nothing.
