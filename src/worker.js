const DISCORD_API = "https://discord.com/api/v10";
const VOICE_MESSAGE_FLAG = 1 << 13;
const EPHEMERAL_FLAG = 1 << 6;
const DEFAULT_ATTACHMENT_LIMIT = 20 * 1024 * 1024;
const RUNTIME_VERSION = "2026-09-25-voicy-v2-dynamic-upload-limit";

const VOICE_COMMAND = {
  name: "voice",
  description: "Send an existing OGG Opus file as a Discord voice message",
  type: 1,
  integration_types: [1],
  contexts: [0, 1, 2],
  options: [
    {
      name: "file",
      description: "Choose an OGG Opus audio file",
      type: 11,
      required: true,
    },
  ],
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return homePage(env);
    }

    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({ ok: true, runtime: RUNTIME_VERSION });
    }

    if (request.method === "GET" && url.pathname === "/setup") {
      return setupPage();
    }

    if (request.method === "POST" && url.pathname === "/register") {
      return registerCommand(request, env);
    }

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const rawBody = await request.text();
    const valid = await verifyDiscordRequest(request, rawBody, env.DISCORD_PUBLIC_KEY);
    if (!valid) {
      return new Response("Invalid request signature", { status: 401 });
    }

    let interaction;
    try {
      interaction = JSON.parse(rawBody);
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    if (interaction.type === 1) {
      return Response.json({ type: 1 });
    }

    if (interaction.type === 2 && interaction.data?.name === "voice") {
      return handleVoiceInteraction(interaction);
    }

    return interactionResponse("Unknown command.", true);
  },
};

function homePage(env) {
  const appId = encodeURIComponent(String(env.DISCORD_APPLICATION_ID || ""));
  const installUrl = appId
    ? `https://discord.com/oauth2/authorize?client_id=${appId}&integration_type=1&scope=applications.commands`
    : "";

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Voicy</title>
  <style>
    body{font-family:system-ui,-apple-system,sans-serif;max-width:680px;margin:64px auto;padding:0 20px;line-height:1.55}
    a{display:inline-block;padding:12px 16px;border-radius:10px;background:#5865f2;color:#fff;text-decoration:none;font-weight:700}
    code{background:#f2f2f2;padding:2px 6px;border-radius:6px}
  </style>
</head>
<body>
  <h1>Voicy</h1>
  <p>Install the app, then use <code>/voice</code> anywhere Discord allows user-installed commands.</p>
  ${installUrl ? `<p><a href="${installUrl}">Install Voicy</a></p>` : ""}
  <p>Current input format: OGG Opus.</p>
</body>
</html>`;

  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "referrer-policy": "no-referrer",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
    },
  });
}

function setupPage() {
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Voicy Setup</title>
  <style>
    body{font-family:system-ui,-apple-system,sans-serif;max-width:620px;margin:64px auto;padding:0 20px;line-height:1.55}
    input,button{font:inherit;padding:12px;border-radius:9px;border:1px solid #bbb}
    input{width:100%;box-sizing:border-box;margin:8px 0 12px}
    button{cursor:pointer;font-weight:700}
  </style>
</head>
<body>
  <h1>Register /voice</h1>
  <p>Enter the Cloudflare <code>SETUP_KEY</code> secret. This is submitted in the request body, not the URL.</p>
  <form method="post" action="/register">
    <input type="password" name="key" autocomplete="off" required>
    <button type="submit">Register command</button>
  </form>
</body>
</html>`;

  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "referrer-policy": "no-referrer",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    },
  });
}

async function registerCommand(request, env) {
  requireEnv(env, ["DISCORD_APPLICATION_ID", "DISCORD_BOT_TOKEN", "SETUP_KEY"]);

  const form = await request.formData().catch(() => null);
  const provided = String(form?.get("key") || "");
  if (!provided || provided !== String(env.SETUP_KEY)) {
    return new Response("Unauthorized", { status: 403 });
  }

  const response = await fetch(
    `${DISCORD_API}/applications/${env.DISCORD_APPLICATION_ID}/commands`,
    {
      method: "POST",
      headers: {
        Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(VOICE_COMMAND),
    },
  );

  const text = await response.text();
  if (!response.ok) {
    return new Response(`Discord command registration failed (${response.status})\n${text}`, {
      status: 502,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  return new Response(`Registered /voice globally.\n\n${text}`, {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

async function handleVoiceInteraction(interaction) {
  const option = (interaction.data?.options || []).find((item) => item.name === "file");
  const attachmentId = option?.value;
  const attachment = interaction.data?.resolved?.attachments?.[attachmentId];

  if (!attachment?.url) {
    return interactionResponse("I couldn't read that attachment. Try selecting the file again.", true);
  }

  const size = Number(attachment.size || 0);
  const interactionLimit = Number(
    interaction.attachment_size_limit || DEFAULT_ATTACHMENT_LIMIT,
  );

  if (size > interactionLimit) {
    return interactionResponse(
      `This file is larger than Discord's current upload limit for this interaction (${formatBytes(interactionLimit)}).`,
      true,
    );
  }

  let source;
  try {
    source = await fetch(attachment.url);
  } catch {
    return interactionResponse("I couldn't download that audio file from Discord.", true);
  }

  if (!source.ok) {
    return interactionResponse(`Discord returned ${source.status} while reading the audio file.`, true);
  }

  const bytes = new Uint8Array(await source.arrayBuffer());
  const metadata = inspectOggOpus(bytes);

  if (!metadata.ok) {
    return interactionResponse(
      "That file isn't OGG Opus. Convert it to OGG Opus first, then run /voice again.",
      true,
    );
  }

  const waveform = makeWaveform(bytes, metadata.duration);
  const callbackPayload = {
    type: 4,
    data: {
      flags: VOICE_MESSAGE_FLAG,
      attachments: [
        {
          id: "0",
          filename: "voice-message.ogg",
          duration_secs: metadata.duration,
          waveform,
        },
      ],
      allowed_mentions: { parse: [] },
    },
  };

  const form = new FormData();
  form.append("payload_json", JSON.stringify(callbackPayload));
  form.append(
    "files[0]",
    new Blob([bytes], { type: "audio/ogg; codecs=opus" }),
    "voice-message.ogg",
  );

  const callback = await fetch(
    `${DISCORD_API}/interactions/${interaction.id}/${interaction.token}/callback`,
    {
      method: "POST",
      body: form,
    },
  );

  if (!callback.ok) {
    const detail = await callback.text().catch(() => "");
    console.error("Voice callback failed", callback.status, detail.slice(0, 1000));
  }

  return new Response(null, { status: 202 });
}

function interactionResponse(content, ephemeral = false) {
  return Response.json({
    type: 4,
    data: {
      content: String(content || "").slice(0, 1900),
      ...(ephemeral ? { flags: EPHEMERAL_FLAG } : {}),
      allowed_mentions: { parse: [] },
    },
  });
}

function inspectOggOpus(bytes) {
  if (bytes.length < 64) return { ok: false };
  if (!startsWithAscii(bytes, 0, "OggS")) return { ok: false };

  const opusHead = findAscii(bytes, "OpusHead");
  if (opusHead < 0 || opusHead + 12 > bytes.length) return { ok: false };

  const preSkip = bytes[opusHead + 10] | (bytes[opusHead + 11] << 8);
  let offset = 0;
  let lastGranule = 0n;
  let pages = 0;

  while (offset + 27 <= bytes.length) {
    if (!startsWithAscii(bytes, offset, "OggS")) {
      return { ok: false };
    }

    const segmentCount = bytes[offset + 26];
    const tableEnd = offset + 27 + segmentCount;
    if (tableEnd > bytes.length) return { ok: false };

    let payloadLength = 0;
    for (let i = 0; i < segmentCount; i += 1) {
      payloadLength += bytes[offset + 27 + i];
    }

    const next = tableEnd + payloadLength;
    if (next > bytes.length) return { ok: false };

    let granule = 0n;
    for (let i = 0; i < 8; i += 1) {
      granule |= BigInt(bytes[offset + 6 + i]) << BigInt(i * 8);
    }

    if (granule !== 0xffffffffffffffffn && granule > lastGranule) {
      lastGranule = granule;
    }

    pages += 1;
    offset = next;
  }

  if (!pages || lastGranule <= BigInt(preSkip)) return { ok: false };

  const decodedSamples = Number(lastGranule - BigInt(preSkip));
  if (!Number.isFinite(decodedSamples) || decodedSamples <= 0) return { ok: false };

  const duration = Math.max(0.1, Math.round((decodedSamples / 48000) * 1000) / 1000);
  return { ok: true, duration };
}

function makeWaveform(bytes, duration) {
  const count = clamp(Math.round(duration * 10), 32, 256);
  const bins = new Uint8Array(count);
  const usableStart = Math.min(bytes.length - 1, 64);
  const usableLength = Math.max(1, bytes.length - usableStart);

  for (let i = 0; i < count; i += 1) {
    const start = usableStart + Math.floor((i / count) * usableLength);
    const end = usableStart + Math.floor(((i + 1) / count) * usableLength);
    const span = Math.max(1, end - start);
    const step = Math.max(1, Math.floor(span / 24));
    let sum = 0;
    let samples = 0;

    for (let p = start; p < end; p += step) {
      sum += Math.abs(bytes[p] - 128);
      samples += 1;
    }

    const average = samples ? sum / samples : 24;
    bins[i] = clamp(Math.round(28 + average * 1.45), 18, 220);
  }

  for (let i = 1; i < bins.length - 1; i += 1) {
    bins[i] = Math.round((bins[i - 1] + bins[i] * 2 + bins[i + 1]) / 4);
  }

  let binary = "";
  for (const value of bins) binary += String.fromCharCode(value);
  return btoa(binary);
}

async function verifyDiscordRequest(request, rawBody, publicKeyHex) {
  const signature = request.headers.get("x-signature-ed25519");
  const timestamp = request.headers.get("x-signature-timestamp");
  if (!signature || !timestamp || !publicKeyHex) return false;

  try {
    const key = await crypto.subtle.importKey(
      "raw",
      hexToBytes(publicKeyHex),
      { name: "Ed25519" },
      false,
      ["verify"],
    );

    return await crypto.subtle.verify(
      "Ed25519",
      key,
      hexToBytes(signature),
      new TextEncoder().encode(timestamp + rawBody),
    );
  } catch (error) {
    console.error("Signature verification error", error);
    return false;
  }
}

function requireEnv(env, names) {
  const missing = names.filter((name) => !env[name]);
  if (missing.length) {
    throw new Error(`Missing Cloudflare variable(s): ${missing.join(", ")}`);
  }
}

function startsWithAscii(bytes, offset, value) {
  if (offset < 0 || offset + value.length > bytes.length) return false;
  for (let i = 0; i < value.length; i += 1) {
    if (bytes[offset + i] !== value.charCodeAt(i)) return false;
  }
  return true;
}

function findAscii(bytes, value) {
  for (let i = 0; i <= bytes.length - value.length; i += 1) {
    if (startsWithAscii(bytes, i, value)) return i;
  }
  return -1;
}

function hexToBytes(hex) {
  const value = String(hex || "").trim();
  if (!/^[0-9a-f]+$/i.test(value) || value.length % 2 !== 0) {
    throw new Error("Invalid hexadecimal value.");
  }

  const output = new Uint8Array(value.length / 2);
  for (let i = 0; i < output.length; i += 1) {
    output[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16);
  }
  return output;
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return "unknown";
  const mib = value / (1024 * 1024);
  return `${Math.round(mib * 10) / 10} MiB`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
