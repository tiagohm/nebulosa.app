# External Tools

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

External Tools registers the programs and services the backend uses but does not ship, with the settings each one takes: ASTAP, Astrometry.net Local, Nova Astrometry.net, and MediaMTX.
The registry and its store are `api/src/externaltools.ts`, edited in Settings → External Tools.

## Purpose

Plate solving, star detection, and the observatory video gateway depend on programs installed beside Nebulosa.
The operator configures and checks them once per server, and every service finds them in one place.

## Relations

- ASTAP serves [Plate Solving](plate-solving.md) and [Star Detection](star-detection.md) through the toolkit's adapter (`core/src/astrometry/solvers/astap.ts`); Astrometry.net Local and Nova Astrometry.net serve [Plate Solving](plate-solving.md).
- MediaMTX is the media gateway of [Observatory Cameras](observatory-cameras.md), the only program the server keeps running instead of running it per operation.
- Nova Astrometry.net is a web service signed in to with the API key of an account.
- Settings belong to the server instance, never to a profile or a browser, and are rows of the operational database (see [Persistence and State](persistence-and-state.md)).

## Rules and Limitations

- A program that is not configured resolves to nothing, so its services refuse to run it; no platform default path is assumed.
- A service resolves the settings once when an operation starts, so a save applies to the next operations without a restart.
- No route runs an arbitrary command.
- A test checks the file on the server's filesystem and never starts the program, so it proves neither that it runs nor that it analyzes images.
- An API key is never stored or logged; only the session it opens is kept, in memory, so a restart signs out.
- The native star detection and the libastrometry binding are not external tools; the binding is not integrated, since its single blocking native call cannot be interrupted and its crash would take the server down.
- There is no authentication: anyone who reaches the API can change the executables the server runs, so keep the server on localhost when untrusted clients can reach the network.
