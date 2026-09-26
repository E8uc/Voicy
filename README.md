# Voicy

A small Cloudflare Worker Discord app that turns an existing **OGG Opus** file into a real Discord voice-message response.

## What it does

- Global `/voice file:<attachment>` command.
- Designed for **User Install**, so the command can be used from supported server, DM, and group-DM contexts after a user installs the app.
- Returns a real Discord voice message using the `IS_VOICE_MESSAGE` flag with `duration_secs` and `waveform` attachment metadata.
- No database, Durable Object, Gateway connection, or user token.

## Cloudflare secrets

Create these as **Secrets**, never normal committed variables:

- `DISCORD_BOT_TOKEN` — used only to register the global application command.
- `SETUP_KEY` — your private password for the `/setup` registration page.

`DISCORD_APPLICATION_ID` and `DISCORD_PUBLIC_KEY` are non-secret and are stored in `wrangler.toml`.

## Deploy

This repo is ready for Cloudflare Workers Git integration.

Deploy command:

```text
npm run deploy
```

After the Worker is online:

1. In Discord Developer Portal, set the Worker URL as the **Interactions Endpoint URL**.
2. Enable **User Install** for the application. User installation only needs the `applications.commands` scope.
3. Add `DISCORD_BOT_TOKEN` and `SETUP_KEY` as Cloudflare secrets.
4. Open `https://YOUR-WORKER.workers.dev/setup` and enter the setup key once to register `/voice` globally.
5. Open the Worker root URL and use **Install Voicy**, or use Discord's install link from the Developer Portal.

## Input format

For the first release, Voicy accepts OGG files containing Opus audio and re-uploads them as `voice-message.ogg` with MIME type `audio/ogg; codecs=opus`.

Files are limited to 8 MB so the Worker can fetch and return the audio inside Discord's strict initial-interaction response window.

## Important implementation detail

Discord permits `IS_VOICE_MESSAGE` on the **initial interaction response**, but does not permit that flag on normal webhook followups or webhook edits. For that reason Voicy uploads the voice message through Discord's interaction callback endpoint immediately instead of deferring the command.

The waveform is generated locally from the compressed file bytes for display. It is a visual preview, not a decoded PCM amplitude analysis.
