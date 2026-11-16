// Kleine lokale API für Strava. Das Client-Secret und die Tokens bleiben hier
// auf dem Rechner (config.local.json) und gelangen nie in den Browser.
import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const CONFIG_PATH = process.env.ROLLWERK_CONFIG || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'config.local.json');
const STRAVA = process.env.STRAVA_BASE || 'https://www.strava.com';

let config = null;
async function loadConfig() {
  if (config) return config;
  try {
    config = JSON.parse(await readFile(CONFIG_PATH, 'utf8'));
  } catch {
    config = {};
  }
  return config;
}
async function saveConfig() {
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 });
}

const states = new Set();

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req, limit = 20 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('Anfrage zu groß'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** Nur Anfragen vom eigenen Rechner und von der eigenen Seite zulassen. */
function localOnly(req) {
  const host = String(req.headers.host || '');
  if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return false;
  const origin = req.headers.origin;
  if (origin && origin !== `http://${host}`) return false;
  return true;
}

async function tokenRequest(params) {
  const cfg = await loadConfig();
  const r = await fetch(`${STRAVA}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: cfg.clientId, client_secret: cfg.clientSecret, ...params }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.message || `Strava antwortet mit ${r.status}`);
  cfg.accessToken = data.access_token;
  cfg.refreshToken = data.refresh_token;
  cfg.expiresAt = data.expires_at;
  if (data.athlete) cfg.athlete = `${data.athlete.firstname || ''} ${data.athlete.lastname || ''}`.trim();
  await saveConfig();
}

async function accessToken() {
  const cfg = await loadConfig();
  if (!cfg.refreshToken) throw new Error('Nicht mit Strava verbunden.');
  if (!cfg.accessToken || (cfg.expiresAt || 0) * 1000 < Date.now() + 60000) {
    await tokenRequest({ grant_type: 'refresh_token', refresh_token: cfg.refreshToken });
  }
  return cfg.accessToken;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Bearbeitet /api/…-Anfragen. Liefert false, wenn die Route unbekannt ist. */
export async function handleApi(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const route = `${req.method} ${url.pathname}`;
  if (!url.pathname.startsWith('/api/')) return false;
  if (!localOnly(req)) {
    json(res, 403, { error: 'Nur lokal erreichbar.' });
    return true;
  }
  try {
    const cfg = await loadConfig();
    switch (route) {
      case 'GET /api/strava/status':
        json(res, 200, {
          configured: !!(cfg.clientId && cfg.clientSecret),
          connected: !!cfg.refreshToken,
          athlete: cfg.athlete || null,
          clientId: cfg.clientId || '',
        });
        return true;

      case 'POST /api/strava/config': {
        const body = JSON.parse((await readBody(req, 10000)).toString() || '{}');
        const clientId = String(body.clientId || '').trim();
        const clientSecret = String(body.clientSecret || '').trim();
        if (!/^\d+$/.test(clientId) || !/^[0-9a-f]{20,}$/i.test(clientSecret)) {
          json(res, 400, { error: 'Client-ID oder Client-Secret sehen nicht richtig aus.' });
          return true;
        }
        config = { clientId, clientSecret };
        await saveConfig();
        json(res, 200, { ok: true });
        return true;
      }

      case 'GET /api/strava/login': {
        if (!cfg.clientId) {
          json(res, 400, { error: 'Strava ist noch nicht eingerichtet.' });
          return true;
        }
        const state = randomBytes(16).toString('hex');
        states.add(state);
        const q = new URLSearchParams({
          client_id: cfg.clientId,
          response_type: 'code',
          redirect_uri: `http://${req.headers.host}/api/strava/callback`,
          approval_prompt: 'auto',
          scope: 'activity:write',
          state,
        });
        res.writeHead(302, { Location: `${STRAVA}/oauth/authorize?${q}` });
        res.end();
        return true;
      }

      case 'GET /api/strava/callback': {
        const state = url.searchParams.get('state');
        const code = url.searchParams.get('code');
        let result = 'ok';
        if (!state || !states.delete(state)) result = 'state';
        else if (!code || url.searchParams.get('error')) result = 'denied';
        else if (!(url.searchParams.get('scope') || '').includes('activity:write')) result = 'scope';
        else {
          try {
            await tokenRequest({ grant_type: 'authorization_code', code });
          } catch {
            result = 'token';
          }
        }
        res.writeHead(302, { Location: `/#/einstellungen?strava=${result}` });
        res.end();
        return true;
      }

      case 'POST /api/strava/disconnect': {
        if (cfg.accessToken) {
          await fetch(`${STRAVA}/oauth/deauthorize`, { method: 'POST', headers: { Authorization: `Bearer ${cfg.accessToken}` } }).catch(() => undefined);
        }
        config = { clientId: cfg.clientId, clientSecret: cfg.clientSecret };
        await saveConfig();
        json(res, 200, { ok: true });
        return true;
      }

      case 'POST /api/strava/upload': {
        const fit = await readBody(req);
        const token = await accessToken();
        const form = new FormData();
        form.append('file', new Blob([fit]), 'rollwerk.fit');
        form.append('data_type', 'fit');
        form.append('name', url.searchParams.get('name') || 'Rollwerk-Fahrt');
        form.append('description', 'Gefahren mit Rollwerk');
        form.append('sport_type', 'VirtualRide');
        form.append('trainer', '1');
        form.append('external_id', url.searchParams.get('id') || `rollwerk-${Date.now()}`);
        let r = await fetch(`${STRAVA}/api/v3/uploads`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
        let data = await r.json().catch(() => ({}));
        if (!r.ok) {
          json(res, 502, { error: data.error || data.message || `Strava antwortet mit ${r.status}` });
          return true;
        }
        // Strava verarbeitet die Datei asynchron: kurz auf das Ergebnis warten
        for (let i = 0; i < 15 && !data.activity_id && !data.error; i++) {
          await sleep(1500);
          r = await fetch(`${STRAVA}/api/v3/uploads/${data.id}`, { headers: { Authorization: `Bearer ${token}` } });
          data = await r.json().catch(() => ({}));
        }
        if (data.error) json(res, 502, { error: data.error });
        else json(res, 200, { activityId: data.activity_id || null, pending: !data.activity_id });
        return true;
      }
    }
  } catch (err) {
    json(res, 500, { error: err instanceof Error ? err.message : String(err) });
    return true;
  }
  json(res, 404, { error: 'Unbekannte Route.' });
  return true;
}
