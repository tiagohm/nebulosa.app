# External Tools

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

External Tools registers the programs and services the backend uses but does not ship, with the settings each one takes: ASTAP, Astrometry.net Local, Astrometry.net Online (the nova.astrometry.net service), and MediaMTX.
The registry and its store are `api/src/externaltools.ts`, edited in Settings → External Tools.

## Purpose

Plate solving, star detection, and the observatory video gateway depend on programs installed beside Nebulosa.
The operator configures and checks them once per server, and every service finds them in one place.

## Relations

- ASTAP serves [Plate Solving](plate-solving.md) and [Star Detection](star-detection.md) through the toolkit's adapter (`core/src/astrometry/solvers/astap.ts`); Astrometry.net Local and Astrometry.net Online serve [Plate Solving](plate-solving.md).
- MediaMTX is the media gateway of [Observatory Cameras](observatory-cameras.md), the only program the server keeps running instead of running it per operation.
- Astrometry.net Online is a web service signed in to with the API key of an account.
- The state of each program is shown with the same words wherever it appears: in Settings → External Tools and in the plate solving and star detection controls that use it.
- Settings belong to the server instance, never to a profile or a browser, and are rows of the operational database (see [Persistence and State](persistence-and-state.md)).

## Rules and Limitations

- A program that is not configured resolves to nothing, so its services refuse to run it; no platform default path is assumed.
- A service resolves the settings once when an operation starts, so a save applies to the next operations without a restart.
- No route runs an arbitrary command.
- A test checks the file on the server's filesystem, then starts the program once with a fixed argument that only prints its help or version; for ASTAP it also looks for a star database beside the program, and for MediaMTX it checks the version the gateway needs. It never analyzes an image, so it proves that the program runs, not that it solves.
- The latest check of each program is kept in memory only; the server checks the saved programs again when it starts, so their states are known after a restart. A web service is not checked then, since a restart signs out of it.
- An API key is never stored or logged; only the session it opens is kept, in memory, so a restart signs out.
- The native star detection and the libastrometry binding are not external tools; the binding is not integrated, since its single blocking native call cannot be interrupted and its crash would take the server down.
- There is no authentication: anyone who reaches the API can change the executables the server runs, and a test starts the executable it is given even unsaved, so keep the server on localhost when untrusted clients can reach the network.
