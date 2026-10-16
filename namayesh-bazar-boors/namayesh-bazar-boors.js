// ===== نقشه بازار بورس → عکس تازه + تشخیص + برش دقیق (فقط نقشه) → تلگرام + پنل =====
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36";
const MAP_URL = "https://rahavard365.com/marketmap?asset_id=1&coloring_type_id=1&size_type_id=1&category_id=1";
const SESS_TTL = 120;

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- سشن ----------
async function sha256(s) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
}
function getCookie(req, name) {
  const c = req.headers.get("cookie") || "";
  const m = c.match(new RegExp("(?:^|;\\s*)" + name + "=([^;]+)"));
  return m ? m[1] : null;
}
async function createSession(env) {
  const sid = crypto.randomUUID();
  await env.CACHE.put("mm_sess:" + sid, "1", { expirationTtl: SESS_TTL });
  return sid;
}
async function checkSession(env, req) {
  const sid = getCookie(req, "sid");
  if (!sid) return false;
  if (!(await env.CACHE.get("mm_sess:" + sid))) return false;
  await env.CACHE.put("mm_sess:" + sid, "1", { expirationTtl: SESS_TTL });
  return true;
}
const sessionCookie = sid => `sid=${sid}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESS_TTL + 30}`;
const clearCookie = () => "sid=; Path=/; HttpOnly; Secure; Max-Age=0";

// ---------- زمان ----------
function faNow() {
  return new Intl.DateTimeFormat("fa-IR", { timeZone: "Asia/Tehran", weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date());
}
function marketOpenTehran() {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tehran", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  const get = t => (p.find(x => x.type === t) || {}).value;
  const wd = get("weekday");
  const mins = (parseInt(get("hour")) || 0) * 60 + (parseInt(get("minute")) || 0);
  const days = ["Sat", "Sun", "Mon", "Tue", "Wed"];
  return days.includes(wd) && mins >= 8 * 60 + 45 && mins <= 13 * 60 + 15;
}
async function getSettings(env) {
  const [iv, mh] = await Promise.all([env.CACHE.get("mm_INTERVAL"), env.CACHE.get("mm_MH_ONLY")]);
  return { interval: Math.max(5, parseInt(iv || "30")), mhOnly: mh == null ? true : mh === "1" };
}

// ---------- ابزار عکس ----------
const thumUrl = () => "https://image.thum.io/get/fullpage/width/1680/noanimate/jpg/" + MAP_URL + "?_cb=" + Date.now();

// دیکدر PNG داخلی (بدون وابستگی)
async function decodePng(buf) {
  const v = new Uint8Array(buf);
  const sig = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
  for (let i = 0; i < 8; i++) if (v[i] !== sig[i]) throw new Error("امضای PNG نامعتبر");
  let pos = 8, w = 0, h = 0, colorType = 0, bitDepth = 0, interlace = 0;
  const idat = [];
  while (pos + 8 <= v.length) {
    const len = (v[pos] << 24) | (v[pos + 1] << 16) | (v[pos + 2] << 8) | v[pos + 3];
    const type = String.fromCharCode(v[pos + 4], v[pos + 5], v[pos + 6], v[pos + 7]);
    const d = v.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      w = (d[0] << 24) | (d[1] << 16) | (d[2] << 8) | d[3];
      h = (d[4] << 24) | (d[5] << 16) | (d[6] << 8) | d[7];
      bitDepth = d[8]; colorType = d[9]; interlace = d[12];
    } else if (type === "IDAT") idat.push(d);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  if (!w || !h) throw new Error("PNG بدون ابعاد");
  if (bitDepth !== 8) throw new Error("عمق‌بیت " + bitDepth + " پشتیبانی نمی‌شود");
  if (interlace) throw new Error("PNG میان‌بافته پشتیبانی نمی‌شود");
  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!bpp) throw new Error("نوع‌رنگ " + colorType + " پشتیبانی نمی‌شود");
  let total = 0;
  for (const c of idat) total += c.length;
  const z = new Uint8Array(total);
  let off = 0;
  for (const c of idat) { z.set(c, off); off += c.length; }
  const ds = new DecompressionStream("deflate");
  const raw = new Uint8Array(await new Response(new Blob([z]).stream().pipeThrough(ds)).arrayBuffer());
  const stride = w * bpp;
  const out = new Uint8Array(w * h * bpp);
  let p = 0;
  let prev = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[p++];
    const line = raw.subarray(p, p + stride); p += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let val = line[x];
      if (f === 1) val = (val + a) & 255;
      else if (f === 2) val = (val + b) & 255;
      else if (f === 3) val = (val + ((a + b) >> 1)) & 255;
      else if (f === 4) {
        const pp = a + b - c;
        const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        val = (val + ((pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c))) & 255;
      }
      cur[x] = val;
    }
    prev = cur;
  }
  return { width: w, height: h, data: out, bpp };
}

// یک عکس از thum — با تشخیص placeholder (تصویر خیلی کوچک = هنوز رندر نشده)
async function fetchThumOnce(T, report) {
  const r = await fetch(T, { redirect: "follow", signal: AbortSignal.timeout(25000) });
  const ct = r.headers.get("content-type") || "";
  if (!ct.includes("image")) { if (report) report.push("thum: HTTP " + r.status); return null; }
  const b = await r.arrayBuffer();
  if (b.byteLength < 20000) { if (report) report.push("thum: placeholder(" + b.byteLength + ")"); return null; }
  return b;
}

// ناحیهٔ نقشه + سنجش روشنایی (تشخیص پردهٔ تیرهٔ سایت)
async function detectMapBox(T, report) {
  const small = "https://images.weserv.nl/?url=" + encodeURIComponent(T) + "&w=160&output=png";
  const r = await fetch(small, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error("نسخهٔ کوچک: HTTP " + r.status);
  const img = await decodePng(await r.arrayBuffer());
  const { width, height, data, bpp } = img;

  const rowAvg = new Array(height);
  const darkRow = new Array(height);
  for (let y = 0; y < height; y++) {
    let dk = 0, s = 0;
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * bpp;
      const lum = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
      s += lum;
      if (lum < 120) dk++;
    }
    rowAvg[y] = s / width;
    darkRow[y] = dk / width > 0.35;
  }

  let best = null, cur = null;
  for (let y = 0; y < height; y++) {
    if (darkRow[y]) { if (!cur) cur = { a: y, b: y }; else cur.b = y; }
    else if (cur) { if (!best || cur.b - cur.a > best.b - best.a) best = cur; cur = null; }
  }
  if (cur && (!best || cur.b - cur.a > best.b - best.a)) best = cur;
  if (!best || best.b - best.a < height * 0.15)
    throw new Error("نقشهٔ ناقص — ناحیهٔ یافت نشد (بهترین: " + (best ? best.a + ".." + best.b : "هیچ") + " از " + height + ")");

  const bandH = best.b - best.a + 1;
  const colDark = new Array(width).fill(0);
  let bAvg = 0;
  for (let y = best.a; y <= best.b; y++) {
    bAvg += rowAvg[y];
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * bpp;
      const lum = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
      if (lum < 120) colDark[x]++;
    }
  }
  bAvg /= bandH;
  let left = colDark.findIndex(c => c / bandH > 0.3);
  let right = width - 1 - [...colDark].reverse().findIndex(c => c / bandH > 0.3);
  if (left < 0 || right <= left) { left = 0; right = width - 1; }

  return { top: best.a, bottom: best.b, left, right, smallH: height, smallW: width, avgLum: bAvg };
}

async function grabMapShot(report, quick) {
  const tries = quick ? 2 : 3, pause = quick ? 3000 : 5000;
  let lastFull = null;
  for (let attempt = 1; attempt <= tries; attempt++) {
    const T = thumUrl();
    let fullBuf = null;
    try { fullBuf = await fetchThumOnce(T, report); }
    catch (e) { if (report) report.push("تلاش" + attempt + ": " + (e.name === "TimeoutError" ? "تایم‌اوت" : "شبکه")); }
    if (!fullBuf) { await sleep(pause); continue; }
    lastFull = fullBuf;

    let box = null;
    try { box = await detectMapBox(T, report); }
    catch (e) {
      if (report) report.push("تلاش" + attempt + ": " + e.message);
      await sleep(pause); // صفحه ناقص/سفید → رندر تازه
      continue;
    }

    // تشخیص پردهٔ تیره: اول رندر تازه؛ در آخرین تلاش ترمیم روشنایی
    const dimmed = box.avgLum < 65;
    if (dimmed && attempt < tries) {
      if (report) report.push("تلاش" + attempt + ": تصویر تیره (avg " + Math.round(box.avgLum) + ") — رندر تازه…");
      await sleep(pause);
      continue;
    }

    let size = null;
    try {
      const r = await fetch("https://images.weserv.nl/?url=" + encodeURIComponent(T) + "&output=json", { signal: AbortSignal.timeout(15000) });
      if (r.ok) { const j = await r.json(); if (j.width && j.height) size = { w: j.width, h: j.height }; }
      if (!size && report) report.push("تلاش" + attempt + ": ابعاد نامشخص");
    } catch (e) { if (report) report.push("تلاش" + attempt + ": ابعاد " + e.message); }

    if (size) {
      try {
        const sy = size.h / box.smallH;
        const sx = size.w / box.smallW;
        const m = Math.max(6, Math.round(size.h * 0.004));
        const top = Math.max(0, Math.round(box.top * sy) - m);
        const hh = Math.min(size.h - top, Math.round((box.bottom - box.top + 1) * sy) + 2 * m);
        const left = Math.max(0, Math.round(box.left * sx) - m);
        const ww = Math.min(size.w - left, Math.round((box.right - box.left + 1) * sx) + 2 * m);
        if (ww > 100 && hh > 100) {
          const fix = dimmed
            ? "&bri=" + Math.min(90, Math.max(30, Math.round((78 / box.avgLum - 1) * 100))) +
              "&sat=" + Math.min(35, Math.round((78 / box.avgLum - 1) * 50))
            : "";
          const cropUrl = "https://images.weserv.nl/?url=" + encodeURIComponent(T) +
            "&crop=" + ww + "," + hh + "," + left + "," + top + "&output=jpg&q=90" + fix;
          const r2 = await fetch(cropUrl, { signal: AbortSignal.timeout(25000) });
          if (r2.ok) {
            const b2 = await r2.arrayBuffer();
            if (b2.byteLength > 20000) return { buf: b2, cropped: true, info: "تلاش " + attempt + (dimmed ? " + ترمیم روشنایی" : "") };
            if (report) report.push("تلاش" + attempt + ": برش کوچک");
          } else if (report) report.push("تلاش" + attempt + ": برش HTTP " + r2.status);
        }
      } catch (e) {
        if (report) report.push("تلاش" + attempt + ": برش " + (e.name === "TimeoutError" ? "تایم‌اوت" : e.message));
      }
    }
    return { buf: lastFull, cropped: false, info: report.join(" | ") };
  }
  if (lastFull) return { buf: lastFull, cropped: false, info: report.join(" | ") };
  return null;
}

// ---------- تلگرام ----------
async function sendPhoto(env, chatId, buf, caption) {
  const fd = new FormData();
  fd.append("chat_id", chatId); fd.append("caption", caption);
  fd.append("photo", new Blob([buf], { type: "image/jpeg" }), "marketmap.jpg");
  const j = await (await fetch(`https://api.telegram.org/bot${env.TG_TOKEN}/sendPhoto`, { method: "POST", body: fd })).json();
  if (!j.ok) throw new Error("تلگرام: " + (j.description || "?"));
}
async function sendText(env, chatId, text) {
  await fetch(`https://api.telegram.org/bot${env.TG_TOKEN}/sendMessage`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}
async function notifyAdmin(env, text) {
  try { await sendText(env, env.ADMIN_CHAT_ID || env.CHAT_ID, text); } catch {}
}

// ---------- اجرا ----------
async function run(env, quick = false, force = false) {
  if (!env.CACHE) throw new Error("اتصال KV با نام CACHE تنظیم نشده است");
  if (!env.TG_TOKEN || !env.CHAT_ID) throw new Error("TG_TOKEN یا CHAT_ID تنظیم نشده است");

  const S = await getSettings(env);
  if (!force) {
    if (S.mhOnly && !marketOpenTehran()) return "market-closed";
    const last = await env.CACHE.get("mm_last");
    if (last) {
      const dt = Date.now() - Date.parse(last);
      if (dt < S.interval * 60000) return "cooldown";
    }
  }

  const report = [];
  const got = await grabMapShot(report, quick);
  if (!got) {
    let alt = null;
    try {
      const r = await fetch("https://s0.wp.com/mshots/v1/" + encodeURIComponent(MAP_URL + "?_cb=" + Date.now()) + "?w=1680&h=2200", { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(9000) });
      const ct = r.headers.get("content-type") || "";
      if (ct.includes("image")) { const b = await r.arrayBuffer(); if (b.byteLength > 20000) alt = b; }
    } catch {}
    if (!alt) throw new Error("سرویس‌های عکس جواب ندادند [" + report.join(" | ") + "]");
    await sendPhoto(env, env.CHAT_ID, alt, "🗺 نقشه بازار — " + faNow() + " (کل صفحه — برش ناموفق)");
    await env.CACHE.put("mm_last", new Date().toISOString(), { expirationTtl: 604800 });
    await notifyAdmin(env, "ℹ️ برش ناموفق — عکس کامل ارسال شد.\nگزارش: " + report.join(" | "));
    return "sent-full";
  }
  await sendPhoto(env, env.CHAT_ID, got.buf, "🗺 نقشه حرارتی بازار بورس — " + faNow() + (got.cropped ? "" : " (کل صفحه)"));
  if (!got.cropped) {
    const note = await env.CACHE.get("mm_cropnote");
    if (!note) {
      await env.CACHE.put("mm_cropnote", "1", { expirationTtl: 86400 });
      await notifyAdmin(env, "ℹ️ برش انجام نشد — عکس کامل ارسال شد.\nگزارش: " + (got.info || "نامشخص") + "\n(روزانه یک‌بار اطلاع می‌دهد)");
    }
  }
  await env.CACHE.put("mm_last", new Date().toISOString(), { expirationTtl: 604800 });
  await env.CACHE.delete("mm_lasterr").catch(() => {});
  return got.cropped ? "sent-cropped" : "sent-full";
}

// ---------- صفحات ----------
function loginHTML(err) {
  return `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ورود به پنل نقشه بازار</title><link href="https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/Vazirmatn-font-face.css" rel="stylesheet">
<style>body{font-family:Vazirmatn,Tahoma,sans-serif;background:linear-gradient(135deg,#7a2e2e,#a34848);min-height:100vh;display:flex;align-items:center;justify-content:center;margin:0}
.box{background:#fff;border-radius:18px;padding:36px;width:min(380px,92vw);box-shadow:0 12px 40px rgba(0,0,0,.3);text-align:center}
h1{font-size:19px;color:#7a2e2e;margin-bottom:8px}p{font-size:13px;color:#6b7280;margin-bottom:22px}
.err{background:#fee2e2;color:#b91c1c;border-radius:10px;padding:10px;font-size:13px;margin-bottom:14px}
input{font-family:inherit;width:100%;border:1px solid #d8dee8;border-radius:10px;padding:12px 14px;font-size:15px;text-align:center;margin-bottom:14px}
button{font-family:inherit;width:100%;border:0;border-radius:10px;background:#7a2e2e;color:#fff;padding:13px;font-size:15px;font-weight:700;cursor:pointer}</style></head>
<body><div class="box"><h1>🗺 پنل ربات نقشه بازار</h1><p>برای ورود، رمز پنل را وارد کنید</p>
 ${err ? '<div class="err">رمز اشتباه است</div>' : ""}
<form method="get" action="/"><input name="key" type="password" placeholder="رمز پنل" autofocus><button>ورود</button></form></div></body></html>`;
}

function panelHTML() {
  return `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>پنل ربات نقشه بازار</title>
<link href="https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/Vazirmatn-font-face.css" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Vazirmatn,Tahoma,sans-serif;background:#eef2f7;min-height:100vh;color:#1f2937}
.wrap{max-width:860px;margin:0 auto;padding:28px 18px 60px}
header{background:linear-gradient(135deg,#7a2e2e,#a34848);color:#fff;border-radius:18px;padding:24px 28px;box-shadow:0 8px 24px rgba(122,46,46,.25);display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
header h1{font-size:21px;font-weight:800}
.idle{background:rgba(255,255,255,.15);border-radius:10px;padding:7px 14px;font-size:12px;white-space:nowrap}
.out{background:#dc2626;color:#fff;border:0;border-radius:10px;padding:9px 18px;font-family:inherit;font-size:13px;font-weight:700;cursor:pointer}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px;margin-top:18px}
.card{background:#fff;border-radius:14px;padding:16px 18px;box-shadow:0 2px 10px rgba(0,0,0,.06)}
.card .lbl{font-size:12px;color:#6b7280;margin-bottom:8px}
.card .val{font-size:15px;font-weight:700;word-break:break-word}
.ok{color:#0a8f3c}.bad{color:#dc2626}.mut{color:#6b7280;font-weight:500}
.actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:18px}
button{font-family:inherit;border:0;border-radius:12px;padding:13px 22px;font-size:14px;font-weight:700;cursor:pointer;transition:.15s}
button:disabled{opacity:.55;cursor:wait}
.b-run{background:#0a8f3c;color:#fff}.b-ref{background:#e5e9f0;color:#1f2937}
#msg{display:none;margin-top:14px;background:#fff;border-right:4px solid #a34848;border-radius:10px;padding:13px 16px;font-size:13.5px;box-shadow:0 2px 8px rgba(0,0,0,.05)}
.settings{background:#fff;border-radius:14px;padding:22px;box-shadow:0 2px 10px rgba(0,0,0,.06);margin-top:18px}
.settings h2{font-size:16px;margin-bottom:16px;color:#7a2e2e}
.frow{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 0;border-bottom:1px solid #f1f3f7;flex-wrap:wrap}
.frow:last-of-type{border-bottom:0}
.frow .t{font-size:14px;font-weight:600}.frow .d{font-size:12px;color:#6b7280;margin-top:4px}
input[type=number]{font-family:inherit;border:1px solid #d8dee8;border-radius:10px;padding:10px 14px;font-size:14px;width:120px;text-align:center}
.switch{position:relative;width:46px;height:26px}
.switch input{display:none}
.switch i{position:absolute;inset:0;background:#d1d5db;border-radius:20px;transition:.2s;cursor:pointer}
.switch i:before{content:"";position:absolute;width:20px;height:20px;border-radius:50%;background:#fff;top:3px;right:3px;transition:.2s}
.switch input:checked+i{background:#0a8f3c}
.switch input:checked+i:before{right:23px}
.save{background:#7a2e2e;color:#fff;margin-top:16px}
.note{font-size:12px;color:#6b7280;margin-top:12px;line-height:2}
</style></head><body><div class="wrap">
<header>
  <div><h1>🗺 پنل ربات نقشه بازار بورس</h1>
  <p style="opacity:.85;font-size:12.5px;margin-top:5px">تا ۳ تلاش برای عکس کامل + برش خودکار دو بعدی (فقط نقشه)</p></div>
  <div style="display:flex;gap:10px;align-items:center">
    <span class="idle" id="idle">⏱ ۲:۰۰</span>
    <button class="out" onclick="logout()">خروج ⏻</button>
  </div>
</header>
<div class="grid">
  <div class="card"><div class="lbl">آخرین ارسال موفق</div><div class="val mut" id="s-last">—</div></div>
  <div class="card"><div class="lbl">وضعیت بازار</div><div class="val" id="s-mkt">—</div></div>
  <div class="card"><div class="lbl">بازهٔ ارسال</div><div class="val" id="s-iv">—</div></div>
  <div class="card"><div class="lbl">آخرین خطا</div><div class="val mut" id="s-err">ندارد ✓</div></div>
</div>
<div class="actions">
  <button class="b-run" id="runBtn" onclick="doRun(this)">🚀 اجرای دستی (ارسال به کانال)</button>
  <button class="b-ref" id="refBtn" onclick="loadStatus(true)">🔄 تازه‌سازی وضعیت</button>
</div>
<div id="msg"></div>
<div class="settings">
  <h2>⚙️ تنظیمات</h2>
  <div class="frow">
    <div><div class="t">فاصلهٔ ارسال (دقیقه)</div><div class="d">حداقل فاصلهٔ بین دو ارسال خودکار</div></div>
    <input type="number" id="interval" min="5" max="720">
  </div>
  <div class="frow">
    <div><div class="t">فقط ساعات معاملات</div><div class="d">شنبه تا چهارشنبه، ۰۸:۴۵ تا ۱۳:۱۵ به وقت تهران</div></div>
    <label class="switch"><input type="checkbox" id="mhOnly"><i></i></label>
  </div>
  <button class="save" onclick="saveSettings(this)">💾 ذخیره تنظیمات</button>
  <div class="note">اگر صفحهٔ سایت ناقص لود شده باشد، ربات خودش می‌فهمد و تا ۳ بار عکس تازه می‌گیرد. برش هم عمودی و هم افقی است (حاشیه‌های خاکستری حذف می‌شوند). اگر برش نشد، عکس کامل با برچسب «(کل صفحه)» می‌آید.</div>
</div>
</div>
<script>
var IDLE=120,left=IDLE,mm=0,lastPing=0;
function pill(){var m=Math.floor(left/60),s=left%60;document.getElementById('idle').textContent='⏱ خروج خودکار: '+m+':'+(s<10?'0':'')+s}
async function ping(){var n=Date.now();if(n-lastPing>40000){lastPing=n;try{await fetch('/api/ping',{method:'POST'})}catch(e){}}}
['pointerdown','keydown','wheel','touchstart'].forEach(function(ev){document.addEventListener(ev,function(){left=IDLE;ping()})});
document.addEventListener('mousemove',function(){var n=Date.now();if(n-mm>3000){mm=n;left=IDLE;ping()}});
setInterval(function(){left--;pill();if(left<=0){try{fetch('/api/logout',{method:'POST'})}catch(e){};location.href='/'}},1000);pill();
function msg(m){var d=document.getElementById('msg');d.style.display='block';d.textContent=m}
function fd(iso){if(!iso)return '—';try{return new Date(iso).toLocaleString('fa-IR')}catch(e){return iso}}
async function loadStatus(manual){
  try{
    var r=await fetch('/api/status');var d=await r.json();
    if(d.auth===false){location.href='/';return}
    var a=document.getElementById('s-last');a.textContent=fd(d.last);a.className='val '+(d.last?'ok':'mut');
    var m=document.getElementById('s-mkt');m.textContent=d.market_open?'باز است 🟢':'بسته است 🔴';m.className='val '+(d.market_open?'ok':'bad');
    document.getElementById('s-iv').textContent=d.interval+' دقیقه';
    var e=document.getElementById('s-err');e.textContent=d.last_err||'ندارد ✓';e.className='val '+(d.last_err?'bad':'mut');
    document.getElementById('interval').value=d.interval;
    document.getElementById('mhOnly').checked=!!d.mh_only;
    if(manual)msg('✅ وضعیت به‌روزرسانی شد');
  }catch(e){msg('❌ خطا در دریافت وضعیت')}
}
async function doRun(btn){
  btn.disabled=true;btn.textContent='⏳ گرفتن و برش عکس… (تا ۹۰ ثانیه)';left=IDLE;
  try{
    var r=await fetch('/api/run?force=1',{method:'POST'});var d=await r.json();
    msg(d.message);
  }catch(e){msg('❌ خطا در اجرا')}
  finally{btn.disabled=false;btn.textContent='🚀 اجرای دستی (ارسال به کانال)'}
  setTimeout(function(){loadStatus(false)},3000);
}
async function saveSettings(btn){
  btn.disabled=true;left=IDLE;
  try{
    var r=await fetch('/api/settings',{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({interval:parseInt(document.getElementById('interval').value)||30,mh_only:document.getElementById('mhOnly').checked})});
    var d=await r.json();msg(d.ok?'✅ ذخیره شد':'❌ خطا در ذخیره');
  }catch(e){msg('❌ خطا در ذخیره')}finally{btn.disabled=false}
  loadStatus(false);
}
async function logout(){
  try{await fetch('/api/logout',{method:'POST'})}catch(e){}
  location.href='/';
}
loadStatus(false);
</script></body></html>`;
}

// ---------- مسیرها ----------
export default {
  async scheduled(c, env, ctx) {
    ctx.waitUntil(run(env).then(r => console.log("RUN:", r, "✅")).catch(async e => {
      console.log("ERR:", e.message);
      await env.CACHE.put("mm_lasterr", e.message + " @ " + new Date().toISOString(), { expirationTtl: 604800 }).catch(() => {});
      await notifyAdmin(env, "❌ ربات نقشه بازار (خودکار)\n\n" + e.message + "\n\n🕐 " + faNow());
    }));
  },
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/+/, "/");
    const html = { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" };

    if (path === "/" || path === "") {
      const key = url.searchParams.get("key");
      if (key != null) {
        if (key === env.RUN_KEY) {
          const sid = await createSession(env);
          return new Response(null, { status: 302, headers: { "location": "/", "set-cookie": sessionCookie(sid) } });
        }
        return new Response(loginHTML(true), { headers: html });
      }
      if (await checkSession(env, req)) return new Response(panelHTML(), { headers: html });
      return new Response(loginHTML(false), { headers: html });
    }

    if (path === "/api/logout" && req.method === "POST") {
      const sid = getCookie(req, "sid");
      if (sid) await env.CACHE.delete("mm_sess:" + sid);
      return new Response(JSON.stringify({ ok: true }), { headers: { "set-cookie": clearCookie(), "content-type": "application/json" } });
    }

    if (path === "/api/ping" && req.method === "POST") {
      if (!(await checkSession(env, req))) return new Response(JSON.stringify({ auth: false }), { status: 401 });
      return new Response(JSON.stringify({ ok: true }));
    }

    if (path === "/api/status") {
      if (!(await checkSession(env, req))) return new Response(JSON.stringify({ auth: false }), { status: 401 });
      const S = await getSettings(env);
      return new Response(JSON.stringify({
        auth: true,
        last: await env.CACHE.get("mm_last") || null,
        last_err: await env.CACHE.get("mm_lasterr") || null,
        interval: S.interval, mh_only: S.mhOnly,
        market_open: marketOpenTehran(),
      }), { headers: { "content-type": "application/json; charset=utf-8" } });
    }

    if (path === "/api/run" && req.method === "POST") {
      if (!(await checkSession(env, req))) return new Response(JSON.stringify({ ok: false, message: "سشن منقضی شده" }), { status: 401 });
      const force = url.searchParams.get("force") === "1";
      await notifyAdmin(env, "⏳ در حال گرفتن و برش عکس نقشه… (تا ۹۰ ثانیه — ممکن است چند تلاش لازم باشد)");
      ctx.waitUntil(run(env, true, force).then(r => console.log("RUN:", r, "✅")).catch(async e => {
        console.log("ERR:", e.message);
        await env.CACHE.put("mm_lasterr", e.message + " @ " + new Date().toISOString(), { expirationTtl: 604800 }).catch(() => {});
        await notifyAdmin(env, "❌ ربات نقشه بازار (اجرا دستی)\n\n" + e.message + "\n\n🕐 " + faNow());
      }));
      return new Response(JSON.stringify({ ok: true, message: "✅ در حال گرفتن و برش عکس… تا ۹۰ ثانیه صبر کنید" }), { headers: { "content-type": "application/json; charset=utf-8" } });
    }

    if (path === "/api/settings" && req.method === "POST") {
      if (!(await checkSession(env, req))) return new Response(JSON.stringify({ ok: false }), { status: 401 });
      try {
        const b = await req.json();
        if (b.interval >= 5 && b.interval <= 720) await env.CACHE.put("mm_INTERVAL", String(b.interval), { expirationTtl: 31536000 });
        await env.CACHE.put("mm_MH_ONLY", b.mh_only ? "1" : "0", { expirationTtl: 31536000 });
        return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
      } catch { return new Response(JSON.stringify({ ok: false }), { status: 400 }); }
    }

    return new Response(loginHTML(false), { headers: html });
  },
};
