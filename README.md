# Nebulosa

[![Active Development](https://img.shields.io/badge/Maintenance%20Level-Actively%20Developed-brightgreen.svg)](https://gist.github.com/cheerfulstoic/d107229326a01ff0f333a1d3476e068d)
[![Test](https://github.com/tiagohm/nebulosa.app/actions/workflows/test.yml/badge.svg)](https://github.com/tiagohm/nebulosa.app/actions/workflows/test.yml)

Nebulosa is an integrated astronomical imaging application built with Bun, React, and the [`nebulosa`](https://github.com/tiagohm/nebulosa.ts) TypeScript astronomy toolkit. It combines a local web UI, Bun API server, device-control handlers, and image-processing workflows for capture, planning, solving, and analysis.

## Development

```sh
git clone --recurse-submodules https://github.com/tiagohm/nebulosa.app
bun i
bun run make:catalog --force
bun run make:moon --force
```

| Command                               | Description                                        |
| ------------------------------------- | -------------------------------------------------- |
| `bun dev`                             | Starts the server with hot reload and frontend HMR |
| `bun start`                           | Starts the server in production mode               |
| `bun compile`                         | Builds the standalone executable into `.dist/`     |
| `bun lint`                            | Type-checks and Lints the project                  |
| `bun fmt`                             | Formats the project                                |
| `bun test --parallel --timeout 30000` | Runs the tests                                     |

Workspaces:

- `core`: [`nebulosa`](https://github.com/tiagohm/nebulosa.ts) astronomy toolkit (git submodule)
- `api`: Bun backend
- `web`: React frontend
- `app`: Bundles `api` and `web` into a single server and executable

See [ARCHITECTURE.md](docs/ARCHITECTURE.md) for the capability inventory, workspace responsibilities, and shared contracts.

## Production

After the setup above, build the standalone executable. It bundles the server, the web UI, the workers, and the catalogs into a single file for the platform it is built on: `.dist/nebulosa.exe` on Windows and `.dist/nebulosa` elsewhere.

```sh
bun compile
```

Run it and open the address it prints (`http://localhost:7000` by default):

```sh
./.dist/nebulosa
./.dist/nebulosa --host 0.0.0.0 --port 8080
```

To run from source instead, without compiling, use `bun start`, which takes the same options (`bun start --port 8080`).

| Option / variable            | Default      | Description                                                                                                                                                |
| ---------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--host` / `APP_HOST`        | `localhost`  | Host or IP address the server listens on; `0.0.0.0` accepts every network interface                                                                        |
| `--port` / `APP_PORT`        | `7000`       | TCP port the server listens on                                                                                                                             |
| `NEBULOSA_HOME`              | `~/Nebulosa` | Data directory: the database (`nebulosa.sqlite`), captures, calibration frames and masters, and stacking projects                                          |
| `NEBULOSA_CAMERA_SECRET_KEY` | (none)       | Base64 of 32 random bytes that encrypts the addresses of the observatory cameras; without it, the key is kept by the operating system's credential storage |

The command-line options win over the environment variables. The executable also reads a `.env` file from the directory it is started in, and `APP_HOST` and `APP_PORT` present when it was compiled become its defaults.

- Only one server can use a data directory at a time; give a second server its own `NEBULOSA_HOME`.
- Stop it with Ctrl+C (or `SIGTERM` from a service manager): the device operations still running are stopped and the database is closed before it exits.
- There is no authentication: any client that can reach the server can command the devices and browse the server's files. Keep it on `localhost`, or on a network you trust.
- Observatory Cameras (Tools) relays IP security cameras through [MediaMTX](https://github.com/bluenviron/mediamtx) 1.21 or later, which you install and set in Settings → External Tools. The browser receives the video directly from the server over UDP port 8189, so allow it in the server's firewall. The camera addresses are encrypted in the database with a key kept outside it: a copy of the database without `NEBULOSA_CAMERA_SECRET_KEY` (or the operating system's credential storage) cannot give them back.
