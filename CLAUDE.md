# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

nws-reader is a local ASP.NET Core web app that displays active National Weather
Service alerts and reads them aloud. Runs on `localhost` only — no deployment,
no auth, no DB.

## Tech stack

- ASP.NET Core (`net10.0`), minimal API
- C# backend serving a static-file frontend from `wwwroot/`
- Vanilla JS + plain CSS — no build step, no npm
- Browser `SpeechSynthesis` (Web Speech API) for text-to-speech

## NWS API

Base URL: `https://api.weather.gov`. No API key. Returns GeoJSON.

**Critical:** every request **must** send a `User-Agent` header identifying the
app and a contact (e.g. `nws-reader (your-email@example.com)`). Requests
without one get blocked. Set this once on the `HttpClient` in DI. The value
lives in `appsettings.json` under `Nws:UserAgent` — replace the placeholder
with a real contact when running locally.

Useful endpoints:
- `GET /alerts/active?area={STATE}` — active alerts for a state (e.g. `?area=KS`)
- `GET /alerts/active?zone={ZONE_ID}` — alerts for a forecast/county zone
- `GET /alerts/active?point={lat},{lon}` — alerts covering a point
- `GET /zones/forecast/{zoneId}` — zone metadata

Alert payload fields worth surfacing: `properties.event`, `headline`,
`severity`, `urgency`, `areaDesc`, `effective`, `expires`, `description`,
`instruction`.

Docs: <https://www.weather.gov/documentation/services-web-api>

## TTS notes

- Prefer the browser's `SpeechSynthesis` over server-side speech — simpler,
  works on any modern browser, no extra deps.
- Read out a concise composition (event + areaDesc + headline), not the full
  `description`, unless the user explicitly expands an alert.
- Provide a mute/stop control — auto-speaking unread alerts is annoying without
  one.

## Architecture

Two-layer flow: browser polls our backend, our backend proxies to NWS.

```
browser (wwwroot/app.js)
   │  GET /api/alerts?type=area&value=KS   (every 60s)
   ▼
ASP.NET Core (Program.cs)
   │  HttpClient (User-Agent set in DI)
   ▼
api.weather.gov  →  GeoJSON FeatureCollection
```

- `Program.cs` — bootstrap, `HttpClient` config (base address + `User-Agent`
  header set once via `AddHttpClient<NwsClient>`), `/api/alerts` and
  `/api/health` endpoints, static-file serving.
- `Services/NwsClient.cs` — single class that talks to NWS. Translates the
  frontend's `(type, value)` pair into the right query string param
  (`area` / `zone` / `point`), parses the GeoJSON, sorts by severity, returns
  `AlertsResponse`.
- `Models/AlertDtos.cs` — public `AlertDto` / `AlertsResponse` (sent to the
  browser) + `internal` records that mirror the NWS GeoJSON shape (only the
  fields we actually use).
- `wwwroot/app.js` — polling loop, render, diff against a `seen` set in
  `localStorage` so only **new** alerts trigger TTS, severity-ordered speech
  queue, Page Visibility API to pause polling on hidden tabs.
- `wwwroot/styles.css` — severity color tokens (`--sev-extreme`, `--sev-severe`,
  ...) drive both the left stripe and the badge on each card.

Severity ranking is duplicated in two places (server-side sort in
`NwsClient.SeverityRank` and client-side TTS ordering in `app.js`
`severityRank`) — they must stay in sync.

## Common commands

```sh
dotnet run                # start the dev server (http://localhost:5080)
dotnet watch run          # hot-reload during development
dotnet build
```

API smoke test:

```sh
curl "http://localhost:5080/api/alerts?type=area&value=KS"
```

## Conventions

- Poll the NWS API on a sensible interval (30s–60s is plenty; alerts don't
  update faster than that). Don't hammer it.
- Cache the last response in memory and diff to detect *new* alerts so we only
  speak ones the user hasn't heard yet.
- Keep this app single-user / local — don't add concerns (auth, multi-tenancy,
  persistence) that don't belong in a personal dashboard.
