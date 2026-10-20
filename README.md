# Voicy

A small Cloudflare Worker Discord app that turns an existing **OGG Opus** file into a real Discord voice-message response.

## What it does

- Global `/voice` command: `/voice` opens a box asking for the **ID**, or `/voice id:0000001`, or `/voice file:<attachment>`.
- `docs/index.html`: a recorder website (GitHub Pages) that converts your recording to OGG Opus in the browser, uploads it, and gives you an ID.
- Designed for **User Install**, so the command can be used from supported server, DM, and group-DM contexts after a user installs the app.
- Returns a real Discord voice message using the `IS_VOICE_MESSAGE` flag with `duration_secs` and `waveform` attachment metadata.
- Voices are stored in a Cloudflare **KV** namespace (`VOICES`). No Gateway connection or user token.

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

Voicy no longer imposes its own fixed 8 MB cap. It reads Discord's `attachment_size_limit` from each interaction and accepts files up to the limit Discord reports for that user/context. Large files can still be less reliable because Discord requires the initial interaction response within 3 seconds.

## Important implementation detail

Discord permits `IS_VOICE_MESSAGE` on the **initial interaction response**, but does not permit that flag on normal webhook followups or webhook edits. For that reason Voicy uploads the voice message through Discord's interaction callback endpoint immediately instead of deferring the command.

The waveform is generated locally from the compressed file bytes for display. It is a visual preview, not a decoded PCM amplitude analysis.

## Recorder website (GitHub Pages)

1. Push this repo to GitHub, then **Settings → Pages → Deploy from a branch → `main` / `/docs`**.
2. Set your Worker URL in `DEFAULT_API` at the top of the script in `docs/index.html`. The page is public: visitors need no key.
3. Record → **Upload** → you get an ID like `4821907`.
4. In Discord: `/voice`, type the ID, done. IDs are 7 random digits; leading zeros are optional.

Voices are **single use**: the stored file is deleted as soon as Discord accepts the message. Unused voices expire after 6 hours (`VOICE_TTL_HOURS` in `wrangler.toml` to change it). Uploads are limited per IP (6/min) and to 2 MB. `ALLOWED_ORIGIN` locks CORS to your Pages origin.

The page also trims (drag the handles), boosts quiet audio, pauses/resumes recording, takes pasted files, lets you pick a microphone, and lists IDs that haven't been sent yet. Max 5 minutes per voice.

After redeploying, open `/setup` again once to re-register `/voice` with the new `id` option.

Browser note: conversion uses WebCodecs `AudioEncoder` (Chrome, Edge, recent Firefox/Safari). Firefox that records OGG natively skips conversion.
