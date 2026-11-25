# External Tools

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

External Tools registers the programs and data the backend uses but does not ship, with the settings each one takes: the index files and star database of the built-in Nebulosa solver, and MediaMTX.
The registry and its store are `api/src/externaltools.ts`, edited in Settings → External Tools.

## Purpose

Plate solving and the observatory video gateway depend on data and programs installed beside Nebulosa.
The operator configures and checks them once per server, and every service finds them in one place.

## Relations

- The built-in solver serves [Plate Solving](plate-solving.md); no external program solves or detects stars.
- The built-in solver takes a folder of quad index files and a folder of a star database instead of an executable; the folder of an installed ASTAP star database may be given. An empty index folder stands for its default index folder in the data directory, where its settings download index bands (see [Plate Solving](plate-solving.md)).
- MediaMTX is the media gateway of [Observatory Cameras](observatory-cameras.md), the only program the server keeps running instead of running it per operation.
- The state of each program is shown with the same words wherever it appears: in Settings → External Tools and in the plate solving controls that use it.
- Settings belong to the server instance, never to a profile or a browser, and are rows of the operational database (see [Persistence and State](persistence-and-state.md)).

## Rules and Limitations

- A program that is not configured resolves to nothing, so its services refuse to run it; no platform default path is assumed. The built-in solver is always configured, since its default index folder is part of the data directory.
- A service resolves the settings once when an operation starts, so a save applies to the next operations without a restart.
- No route runs an arbitrary command.
- A test checks the file on the server's filesystem, then starts the program once with a fixed argument that only prints its version, and for MediaMTX it checks the version the gateway needs. For the built-in solver it only looks for the index files and supported star databases in its folders, without reading them. It never analyzes an image, so it proves that the program runs, not that it solves.
- The latest check of each program is kept in memory only; the server checks the saved programs again when it starts, so their states are known after a restart.
- The native star detection and the libastrometry binding are not external tools, and the built-in solver is one only for the folders of its data; the binding is not integrated, since its single blocking native call cannot be interrupted and its crash would take the server down.
- There is no authentication: anyone who reaches the API can change the executables the server runs and the folders the built-in solver reads, and a test starts the executable it is given even unsaved, so keep the server on localhost when untrusted clients can reach the network.
