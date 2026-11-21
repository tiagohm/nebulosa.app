# Astronomical Time Converter

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

The Astronomical Time Converter is a tool of the Reference group that converts one instant between calendars, timescales, Julian dates, epochs, and sidereal times (`api/src/astronomicaltime.ts`, `web/src/tools/astronomicaltime/`).
Its module also owns the Earth orientation (`api/src/astronomicaltime.eop.ts`) and the nutation (`api/src/astronomicaltime.nutation.ts`) the whole server computes with.

## Purpose

Astronomy software speaks many timescales, and the operator regularly needs to read an instant as UTC, TT, a Julian date, or a local sidereal time, or the hour angle of a target.
The converter answers these with the toolkit's own timescales, so its values are the ones the rest of Nebulosa uses.
The Earth orientation and nutation it installs are central: every hour angle, pointing correction, and apparent position of the server depends on them.

## Relations

- Uses the toolkit (`core`) as its only source of astronomy; the browser computes nothing but the text of its fields.
- Stateless, read-only conversions: no operation, event, device, or persisted state.
- Earth orientation: `app/src/server.ts` starts it before serving, reading the IERS tables from the data directory and installing them as the toolkit's default providers, so the [Sky Map](sky-map.md), the mounts, the [Mount Pointing Model](mount-pointing-model.md) and its fit worker, and the converter read one UT1 and one polar motion.
- Downloads the IERS tables (IERS, with its USNO mirror) in the background when they are old; no request waits on it.
- Nutation: installed after the Earth orientation, and by the pointing fit worker, as an interpolated IAU 2006/2000A nutation shared by every instant without its own providers; [Planetary Events](planetary-events.md) and the [Observing Planner](observing-planner.md) keep their own.
- [Close Approaches](close-approaches.md) converts its times with the same leap seconds.
- Reads the Sky clock and selection on request and can set the Sky clock; it never changes a device, the profile, or the status bar.
- Its location and time zone follow [Observing Sites and Time Zones](observing-sites-and-time-zones.md), for the tool only.
- Hosted by the Tools workspace (see [Tools Integration](tools-integration.md)); its state lives in the tab and is never persisted.

## Rules and Limitations

- No value crosses a single floating-point Julian date, and calendars are proleptic Gregorian with astronomical year numbering, within the years the tool accepts.
- A local reading the clocks repeat or skip names no single instant and is refused, the repeated one until Earlier or Later is chosen.
- Before 1960 a reading is taken as UT with the toolkit's best-estimate ΔT; after now no further leap second is assumed.
- Outside the IERS tables UT1 and sidereal times are approximate, and the answer says so.
- An old answer is shown as such and is never copied or used for new inputs.
- Solar eclipse maps use the toolkit's ΔT model and do not follow UT1, and saved pointing models are not refitted when UT1 changes.
