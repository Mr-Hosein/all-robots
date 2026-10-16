// Fetch data from the Worker -> render the picture -> send it to the Telegram channel.
//
//   node src/main.mjs --sample     render sample-data.json to out/preview.jpg (nothing is sent)
//   node src/main.mjs --dry        fetch real data and render, but do not send
//   node src/main.mjs              fetch, render, send
//
// Environment (GitHub Secrets / Variables):
//   DATA_URL        Worker address that serves the JSON, e.g. https://xxx.workers.dev/
//   DATA_KEY        shared secret, sent as the X-Api-Key header
//   TG_BOT_TOKEN    Telegram bot token
//   TG_CHAT_ID      channel id (e.g. -1002621107529)
//   ADMIN_CHAT_ID   optional: failures are reported here
import { readFileSync, statSync } from 'node:fs';
import { renderImage } from './render.mjs';

const args = new Set(process.argv.slice(2));
const OUT = 'out/price.jpg';

async function withTimeout(url, options, ms) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: c.signal });
  } finally {
    clearTimeout(t);
  }
}

async function fetchData() {
  const { DATA_URL, DATA_KEY } = process.env;
  if (!DATA_URL || !DATA_KEY) throw new Error('DATA_URL / DATA_KEY are not set');
  const url = new URL(DATA_URL);
  url.searchParams.set('data', '1');
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await withTimeout(url, { headers: { 'X-Api-Key': DATA_KEY } }, 90_000);
      if (!res.ok) throw new Error(`Worker answered HTTP ${res.status}`);
      const data = await res.json();
      if (!data || !data.items || !data.dates) throw new Error('Worker JSON has an unexpected shape');
      return data;
    } catch (e) {
      lastErr = e;
      console.error(`fetch attempt ${attempt} failed:`, e.message);
      if (attempt < 3) await new Promise((r) => setTimeout(r, 5000 * attempt));
    }
  }
  throw lastErr;
}

async function tg(method, body, isForm = false) {
  const token = process.env.TG_BOT_TOKEN;
  const res = await withTimeout(
    `https://api.telegram.org/bot${token}/${method}`,
    isForm ? { method: 'POST', body } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    60_000
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.ok) throw new Error(`Telegram ${method} failed: HTTP ${res.status} ${JSON.stringify(json)}`);
  return json.result;
}

async function sendPhoto(path, caption) {
  const form = new FormData();
  form.set('chat_id', process.env.TG_CHAT_ID);
  if (caption) form.set('caption', caption);
  form.set('photo', new Blob([readFileSync(path)], { type: 'image/jpeg' }), 'prices.jpg');
  return tg('sendPhoto', form, true);
}

async function alertAdmin(text) {
  if (!process.env.TG_BOT_TOKEN || !process.env.ADMIN_CHAT_ID) return;
  try {
    await tg('sendMessage', { chat_id: process.env.ADMIN_CHAT_ID, text });
  } catch (e) {
    console.error('could not alert admin:', e.message);
  }
}

async function main() {
  if (args.has('--sample')) {
    const data = JSON.parse(readFileSync(new URL('./sample-data.json', import.meta.url)));
    await renderImage(data, 'out/preview.jpg');
    console.log('preview written to out/preview.jpg');
    return;
  }

  const data = await fetchData();
  await renderImage(data, OUT);
  console.log(`rendered ${OUT} (${Math.round(statSync(OUT).size / 1024)} KB)`);
  if (args.has('--dry')) return;

  const caption = `🕘 ${data.time} • ${data.weekDay} ${data.dates.shamsi.day} ${data.dates.shamsi.monthName} ${data.dates.shamsi.year}\n🆔 @NabzBazarPlus`;
  await sendPhoto(OUT, caption);
  console.log('sent to channel');
}

main().catch(async (e) => {
  console.error(e);
  await alertAdmin(`🔴 ساخت یا ارسال عکس قیمت‌ها شکست خورد:\n${e.message}`.slice(0, 3500));
  process.exit(1);
});
