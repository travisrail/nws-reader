# nws-reader

A local dashboard for active **National Weather Service** alerts — drawn on a
map, sortable into a card strip, and read aloud on demand.

Runs entirely on your own machine. No API key, no account, no cloud hosting.
Just `dotnet run` and open `http://localhost:5080`.

<!--
Add a screenshot at docs/screenshot.png and uncomment:
![NWS Alert Reader dashboard](docs/screenshot.png)
-->

## What it does

- Polls `api.weather.gov` every 60 seconds for active alerts in an area you
  pick: the whole country, a state, a county/forecast zone, or a single
  lat/lon point.
- Renders each alert's polygon on a dark-themed Leaflet map and shows a
  summary card in a horizontal strip below.
- Detects **PDS** ("Particularly Dangerous Situation") tags and **Tornado /
  Flash Flood Emergencies**, giving them distinct, hard-to-miss visual
  treatment (animated borders and badges).
- Reads alerts aloud on click using your browser's built-in
  `SpeechSynthesis` voices — no external speech service.

## Why it's useful

- **Severe weather awareness without watching a screen.** Leave it open on a
  spare monitor during storm season; click `🔈 Read` on a warning and keep
  working.
- **Cuts the noise.** The default filter shows only Tornado Warnings and
  Severe Thunderstorm Warnings. Statements, advisories, and watches stay
  hidden until you ask for them.
- **PDS warnings stand out.** The most dangerous tornado warnings get a
  pulsing red border, an animated dashed polygon, a "PDS" badge, and a
  spoken "particularly dangerous situation" prefix when read.
- **Spatial context, not just a list.** A polygon on a map tells you "is this
  hitting *me*" faster than reading area names off a card.
- **Drop-in local tool.** No login, no rate-limit headaches, no third-party
  tracking. The whole thing is a single ASP.NET Core process talking to
  NWS's free public API.

## Quick start

Requires **.NET 10 SDK** (any recent .NET should also work — adjust
`TargetFramework` in `nws-reader.csproj` if you're on 8 or 9).

```sh
dotnet run
# then open http://localhost:5080
```

Or open the folder in VS Code and press **F5** — `.vscode/launch.json` runs
the build task and launches the browser pointed at the right URL.

## Lookup options

The Lookup dropdown picks how alerts are scoped:

| Type        | Value example          | What you get                              |
|-------------|------------------------|-------------------------------------------|
| National    | (none)                 | All active alerts in the US               |
| State       | `KS`                   | All alerts in the state                   |
| Zone ID     | `KSC161`               | Alerts for a single county/forecast zone  |
| Lat,Lon     | `39.18,-96.57`         | Alerts whose polygon covers that point    |

Find your zone with:

```sh
curl -H "User-Agent: nws-reader (your-email@example.com)" \
  "https://api.weather.gov/points/39.18,-96.57"
```

The response's `forecastZone` and `county` URLs end in the zone ID.

## Filter chips

Five toggleable categories above the map:

- **Tornado Warning** (on by default)
- **Severe T-Storm Warning** (on by default)
- **Other Warnings** — Flood, Winter Storm, etc.
- **Watches** — Tornado Watch, etc.
- **Other** — Statements, Advisories, etc.

Filters apply to both the cards and the map polygons. The chip row shows
"Showing X of Y" so you don't lose track of hidden alerts.

## Reading alerts aloud

Every alert card has a `🔈 Read` button. The map popup (after clicking a
polygon or a card's `📍 Locate`) has both `🔈 Read` (summary) and `Read full`
(the entire description). The top bar's `🔈 Read All` reads everything
currently visible after filtering, in severity order. `Stop` (or **Esc**)
cancels.

Voices are whatever's installed on the system. The picker biases English
voices to the top. On Windows + Edge, the "Microsoft Online (Natural)"
voices sound noticeably better than the legacy ones.

## Keyboard shortcuts

| Key   | Action          |
|-------|-----------------|
| `R`   | Refresh now     |
| `F`   | Fit map to alerts |
| `Esc` | Stop speaking   |

## Configuration

`appsettings.json` exposes:

- **`Nws:UserAgent`** — required. NWS rejects requests without one. Replace
  the placeholder with a real contact (your email or a project URL). The app
  refuses to start if this is empty.
- **`Nws:BaseAddress`** — defaults to `https://api.weather.gov`.
- **`Nws:TimeoutSeconds`** — HTTP timeout per request, default 15.

## Tech stack

- **ASP.NET Core (`net10.0`)** minimal API
- **Vanilla JS + plain CSS** in `wwwroot/` — no build step, no npm
- **Leaflet 1.9.4** via CDN with **CartoDB Dark Matter** tiles
- Browser **`SpeechSynthesis`** for TTS

## Project layout

```
.
├── Program.cs              minimal API + DI + static files
├── Services/NwsClient.cs   HttpClient wrapper around api.weather.gov
├── Models/AlertDtos.cs     public DTOs + internal NWS GeoJSON shapes
├── appsettings.json        User-Agent and other config
├── wwwroot/
│   ├── index.html          layout
│   ├── styles.css          dark theme, severity color tokens
│   └── app.js              polling, render, map, TTS
└── CLAUDE.md               architectural notes for AI assistance
```

## Limitations

- **Zone-based alerts have no map polygon.** Winter Weather Advisories,
  river-based Flood Warnings, and similar zone-issued products show up as
  cards but don't draw on the map. Resolving zone IDs to county geometries
  would need extra round-trips per alert and isn't wired up yet.
- **Leaflet loads from a CDN** (`unpkg.com`). First load needs internet.
  Self-hosting is a small change if you need full offline.
- **Polling, not push.** Alerts surface within ~60 seconds, not instantly.
  NWS publishes a CAP/Atom feed for true push, but it adds noticeable
  complexity for a personal dashboard.

## Acknowledgments

- Alert data: <https://www.weather.gov/documentation/services-web-api>
- Map tiles © [CARTO](https://carto.com/attributions),
  data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors
- Mapping library: [Leaflet](https://leafletjs.com/)
