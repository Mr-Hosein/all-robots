// ===== forexfactory.com → جدول فارسی → عکس → تلگرام هر ۳۰ دقیقه + پنل با سشن امن =====
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36";
const FONT_R = "https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/fonts/webfonts/Vazirmatn-Regular.woff2";
const FONT_B = "https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/fonts/webfonts/Vazirmatn-Bold.woff2";
const SESS_TTL = 120; // ثانیه

const DICT = {
  "Monetary Policy Meeting Minutes": "صورت‌جلسه نشست سیاست پولی",
  "SPPI": "شاخص قیمت خدمات تولیدکنندگان",
  "BRC Shop Price Index": "شاخص قیمت خرده‌فروشی BRC",
  "Household Spending": "هزینه‌های مصرفی خانوار",
  "Bank Holiday": "تعطیلی بانکی",
};
const NAMES = {
  ramsden: "رامسدن", bowman: "بوومن", cook: "کوک", barkin: "بارکین", lagarde: "لاگارد",
  bailey: "بیلی", powell: "پاول", waller: "والر", williams: "ویلیامز", schmid: "اشمید",
  hammack: "هاماک", goolsbee: "گولزبی", jefferson: "جفرسون", kugler: "کاگلر", logan: "لوگان",
  collins: "کالینز", musalem: "موصلیم", bostic: "بوستیک", daly: "دیلی", harker: "هارکر",
  kashkari: "کاشکاری", ueda: "اوئدا", schnabel: "شنابل", lane: "لین", maki: "ماکی", himino: "هیمینو",
};
const nm = s => NAMES[s.toLowerCase()] || s;
const SPEAK = [
  [/^MPC member (.+?) speaks$/i, n => `سخنرانی ${nm(n)}، عضو کمیته سیاست پولی (MPC)`],
  [/^FOMC member (.+?) speaks$/i, n => `سخنرانی ${nm(n)}، عضو کمیته بازار باز فدرال‌رزرو (FOMC)`],
  [/^ECB president (.+?) speaks$/i, n => `سخنرانی ${nm(n)}، رئیس بانک مرکزی اروپا (ECB)`],
  [/^ECB member (.+?) speaks$/i, n => `سخنرانی ${nm(n)}، عضو بانک مرکزی اروپا`],
  [/^BOE gov (.+?) speaks$/i, n => `سخنرانی ${nm(n)}، رئیس بانک انگلستان`],
  [/^BOE member (.+?) speaks$/i, n => `سخنرانی ${nm(n)}، عضو بانک انگلستان`],
  [/^BOJ (.+?) speaks$/i, n => `سخنرانی ${nm(n)}، بانک ژاپن`],
  [/^Fed chair (.+?) speaks$/i, n => `سخنرانی ${nm(n)}، رئیس فدرال‌رزرو`],
  [/^President (.+?) speaks$/i, n => `سخنرانی رئیس‌جمهور ${nm(n)}`],
  [/^(.+?) speaks$/i, n => `سخنرانی ${nm(n)}`],
];
const SUF = { "y/y": "س/س", "m/m": "م/م", "q/q": "ف/ف", "w/w": "ه/ه" };
const IMPACT = { High: "hi", Medium: "me", Low: "lo", Holiday: "ho" };

const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const V = x => (x == null || x === "" ? "—" : esc(x));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const faDigits = s => String(s).replace(/[0-9]/g, d => "۰۱۲۳۴۵۶۷۸۹"[d]);

// ---------- لاگ ----------
// فقط نام هاست را لاگ می‌کنیم تا skey (توکن) داخل لاگ‌ها نیفتد
const hostOf = u => { try { return new URL(u).hostname; } catch { return String(u).slice(0, 30); } };
const log = (tag, ...a) => console.log(`[${tag}]`, ...a);

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
  await env.CACHE.put("sess:" + sid, "1", { expirationTtl: SESS_TTL });
  return sid;
}
// سشن معتبر؟ (و تمدید به‌عنوان «فعالیت»)
async function checkSession(env, req) {
  const sid = getCookie(req, "sid");
  if (!sid) return false;
  if (!(await env.CACHE.get("sess:" + sid))) return false;
  await env.CACHE.put("sess:" + sid, "1", { expirationTtl: SESS_TTL }); // تمدید با فعالیت
  return true;
}
const sessionCookie = sid => `sid=${sid}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESS_TTL + 30}`;
const clearCookie = () => "sid=; Path=/; HttpOnly; Secure; Max-Age=0";

function fmts(tz) {
  return {
    day: new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }),
    timeStr: ts => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(ts),
    head: new Intl.DateTimeFormat("fa-IR", { timeZone: tz, weekday: "long", day: "numeric", month: "long" }),
    sub: new Intl.DateTimeFormat("fa-IR", { timeZone: tz, day: "numeric", month: "long" }),
  };
}
async function getSettings(env) {
  const [m, stz, nfa] = await Promise.all([env.CACHE.get("set_TZ_MODE"), env.CACHE.get("set_SITE_TZ"), env.CACHE.get("set_NUM_FA")]);
  return {
    mode: m || env.TZ_MODE || "site",
    siteTz: stz || env.SITE_TZ || "America/New_York",
    numFa: nfa == null ? env.NUM_FA !== "0" : nfa === "1",
  };
}

async function gtx(t) {
  try {
    const r = await fetch("https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=fa&dt=t&q=" + encodeURIComponent(t), { headers: { "User-Agent": UA } });
    if (r.ok) { const d = await r.json(); const o = (d[0] || []).map(x => x[0]).join("").trim(); if (o) return o; }
    else log("TRANS", "google status", r.status, "for:", t.slice(0, 40));
  } catch (e) { log("TRANS", "google error", e.message, "for:", t.slice(0, 40)); }
  try {
    const r = await fetch("https://api.mymemory.translated.net/get?q=" + encodeURIComponent(t) + "&langpair=en|fa", { signal: AbortSignal.timeout(6000) });
    if (r.ok) { const d = await r.json(); const o = ((d.responseData || {}).translatedText || "").trim(); if (o && !/MYMEMORY WARNING/i.test(o)) return o; else log("TRANS", "mymemory empty/warning for:", t.slice(0, 40)); }
    else log("TRANS", "mymemory status", r.status);
  } catch (e) { log("TRANS", "mymemory error", e.message); }
  return null;
}
async function faTitle(raw, env, T) {
  const t = (raw || "").trim();
  if (!t) return "—";
  if (T[t]) return T[t];
  let out = null, m;
  for (const [re, fa] of SPEAK) { if ((m = t.match(re))) { out = fa(m[1]); break; } }
  if (!out) {
    let suf = "", base = t;
    if ((m = t.match(/^(.*?)\s+(y\/y|m\/m|q\/q|w\/w)$/i))) { base = m[1]; suf = SUF[m[2].toLowerCase()]; }
    if (DICT[base]) out = DICT[base] + (suf ? " " + suf : "");
    else {
      if (!T[base]) { const o = await gtx(base); if (o) T[base] = o; }
      out = (T[base] || base) + (suf ? " " + suf : "");
    }
  }
  T[t] = out;
  return out;
}

async function fontB64(env, url, key) {
  const hit = await env.CACHE.get(key);
  if (hit) return hit;
  const r = await fetch(url);
  if (!r.ok) { log("FONT", "download failed", key, "status", r.status); return ""; }
  const buf = new Uint8Array(await r.arrayBuffer());
  let s = "";
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  const b64 = btoa(s);
  await env.CACHE.put(key, b64, { expirationTtl: 2592000 });
  log("FONT", "downloaded & cached", key, "bytes:", buf.length);
  return b64;
}

// ---------- بوم (همیشه ۱۰۰٪ قاب را پر می‌کند) ----------
function buildHTML(rows, fR, fB, dayFa, daySub) {
  const N = rows.length;
  const rowHtml = rows.map((r, i) => `
<tr>
  ${i === 0 ? `<td class="dt" rowspan="${N}"><b>${esc(dayFa)}</b><span class="ge">${esc(daySub)}</span></td>` : ""}
  <td class="t">${V(r.time)}</td>
  <td class="c"><span dir="ltr">${V(r.cur)}</span></td>
  <td><span class="imp ${r.cls}"></span></td>
  <td class="e">${V(r.title)}</td>
  <td class="n act" dir="ltr">${V(r.actual)}</td>
  <td class="n" dir="ltr">${V(r.forecast)}</td>
  <td class="n" dir="ltr">${V(r.previous)}</td>
</tr>`).join("");
  return `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8">
<style>
@font-face{font-family:V;src:url(data:font/woff2;base64,${fR}) format("woff2");font-weight:400}
@font-face{font-family:V;src:url(data:font/woff2;base64,${fB}) format("woff2");font-weight:700}
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:100%;height:100%;background:#fff}
body{display:flex;flex-direction:column;font-family:V,Tahoma,sans-serif;overflow:hidden}
.bar{flex:0 0 auto;background:linear-gradient(#3f5f96,#2e4a78);color:#fff;font-weight:700;font-size:clamp(16px,1.7vw,26px);padding:12px 24px}
.tw{flex:1 1 auto;display:flex;flex-direction:column;min-height:0}
table{width:100%;height:100%;border-collapse:collapse;table-layout:fixed}
th{background:#4867a3;color:#f2f5fb;font-size:clamp(12px,1.3vw,20px);padding:10px 6px;border-left:1px solid #3a5488}
td{font-size:clamp(13px,1.4vw,22px);padding:6px 8px;border-bottom:1px solid #e4e8ef;border-left:1px solid #eef1f6;text-align:center;color:#222;vertical-align:middle}
tr:nth-child(odd) td{background:#f7f9fc}
.dt{background:#fff !important;line-height:1.8}
.dt .ge{display:block;color:#888;font-size:.85em}
.t{color:#555}.c{font-weight:700}
.e{text-align:right;direction:rtl;unicode-bidi:plaintext;padding-left:14px}
.n{color:#333}.act{color:#0a8f3c;font-weight:700}
.imp{display:inline-block;width:clamp(14px,1.5vw,24px);height:clamp(14px,1.5vw,24px);border-radius:6px;vertical-align:middle}
.hi{background:#e03131}.me{background:#f08c00}.lo{background:#fcc419}.ho{background:#adb5bd}
.legend{flex:0 0 auto;display:flex;gap:34px;justify-content:center;padding:8px 0;font-size:clamp(11px,1.15vw,18px);color:#666;background:#fff}
.legend i{display:inline-block;width:.95em;height:.95em;border-radius:4px;margin-left:8px;vertical-align:-2px}
</style></head><body>
<div class="bar">📅 تقویم اقتصادی ${esc(dayFa)} — فارکس‌فکتوری</div>
<div class="tw">
<table>
<colgroup><col style="width:11%"><col style="width:7%"><col style="width:6%"><col style="width:5%"><col><col style="width:10%"><col style="width:10%"><col style="width:10%"></colgroup>
<tr><th>تاریخ</th><th>زمان</th><th>ارز</th><th>تأثیر</th><th>رویداد</th><th>فعلی</th><th>پیش‌بینی</th><th>قبلی</th></tr>
 ${rowHtml}
</table>
</div>
<div class="legend"><span><i class="hi"></i>مهم</span><span><i class="me"></i>متوسط</span><span><i class="lo"></i>کم</span><span><i class="ho"></i>تعطیلی</span></div>
</body></html>`;
}

// ---------- عکس‌گرفتن (با توکن چرخشی skey — بدون رمز خام در URL) ----------
async function shotTargets(base, H, bucket, runKey, quick) {
  const enc = encodeURIComponent;
  const skey = await sha256(runKey + ":" + bucket);
  const canvas = base + "/canvas?skey=" + skey + "&b=" + bucket + "&t=" + bucket;
  const micro = { url: "https://api.microlink.io/?url=" + enc(canvas) + "&screenshot=true&meta=false&embed=screenshot.url&viewport.width=1600&viewport.height=" + Math.max(600, H) + "&deviceScaleFactor=1", t: 12000 };
  const thum  = { url: "https://image.thum.io/get/width/1600/noanimate/jpg/" + canvas, t: 25000 };
  const msh   = { url: "https://s0.wp.com/mshots/v1/" + enc(canvas) + "?w=1600&h=" + Math.max(600, H), t: 9000 };
  return quick ? [micro, thum] : [msh, thum, micro];
}

// هر تلاش با نتیجه‌ی دقیق لاگ می‌شود: OK / NOT_IMAGE / TOO_SMALL / ERROR
async function grabShot(targets, tries, pause) {
  const stats = {}; // شمارش نتیجه‌ها به تفکیک سرویس
  const bump = (name, k) => { (stats[name] = stats[name] || {})[k] = (stats[name][k] || 0) + 1; };

  for (let i = 0; i < tries; i++) {
    for (const t of targets) {
      const name = hostOf(t.url);
      const t0 = Date.now();
      try {
        const r = await fetch(t.url, { redirect: "follow", signal: AbortSignal.timeout(t.t) });
        const ct = r.headers.get("content-type") || "";
        const ms = Date.now() - t0;

        // ---- همان خطی که پرسیدی: اگر جواب عکس نبود ----
        if (!ct.includes("image")) {
          let body = "";
          try { body = (await r.text()).replace(/\s+/g, " ").slice(0, 200); } catch {}
          console.log("NOT IMAGE", r.status, name);
          log("SHOT", `try ${i + 1}/${tries}`, name, "NOT_IMAGE", "status=" + r.status, "ct=" + ct, ms + "ms", "body=" + body);
          bump(name, "NOT_IMAGE_" + r.status);
          continue;
        }

        const buf = await r.arrayBuffer();
        if (buf.byteLength > 15000) {
          log("SHOT", `try ${i + 1}/${tries}`, name, "OK", "status=" + r.status, "bytes=" + buf.byteLength, ms + "ms");
          return buf;
        }
        // عکس خیلی کوچک = معمولاً عکس «در حال ساخت…» (placeholder)
        log("SHOT", `try ${i + 1}/${tries}`, name, "TOO_SMALL", "status=" + r.status, "bytes=" + buf.byteLength, "ct=" + ct, ms + "ms");
        bump(name, "TOO_SMALL");
      } catch (e) {
        log("SHOT", `try ${i + 1}/${tries}`, name, "ERROR", e.name + ": " + e.message, (Date.now() - t0) + "ms");
        bump(name, "ERROR_" + e.name);
      }
    }
    if (i < tries - 1) await sleep(pause);
  }
  log("SHOT", "ALL FAILED. summary =", JSON.stringify(stats));
  return null;
}

async function prewarm(urls) {
  for (const u of urls) {
    const name = hostOf(u), t0 = Date.now();
    try {
      const r = await fetch(u, { redirect: "follow", signal: AbortSignal.timeout(6000) });
      log("PREWARM", name, "status=" + r.status, "ct=" + (r.headers.get("content-type") || ""), (Date.now() - t0) + "ms");
    } catch (e) { log("PREWARM", name, "ERROR", e.message, (Date.now() - t0) + "ms"); }
  }
}

async function sendPhoto(env, chatId, buf, caption) {
  const fd = new FormData();
  fd.append("chat_id", chatId); fd.append("caption", caption);
  fd.append("photo", new Blob([buf], { type: "image/jpeg" }), "calendar.jpg");
  const resp = await fetch(`https://api.telegram.org/bot${env.TG_TOKEN}/sendPhoto`, { method: "POST", body: fd });
  const j = await resp.json().catch(() => ({}));
  log("TG", "sendPhoto http=" + resp.status, "ok=" + j.ok, "bytes=" + buf.byteLength, j.description || "");
  if (!j.ok) throw new Error("تلگرام: " + (j.description || "?"));
}
async function sendText(env, chatId, text) {
  try {
    const resp = await fetch(`https://api.telegram.org/bot${env.TG_TOKEN}/sendMessage`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    if (!resp.ok) log("TG", "sendText http=" + resp.status, (await resp.text()).slice(0, 150));
  } catch (e) { log("TG", "sendText ERROR", e.message); }
}

// ---------- روش ۱: مرورگر خود Cloudflare (REST API) — بدون سرویس ثالث ----------
async function cfScreenshot(env, snap) {
  const [fR, fB] = await Promise.all([fontB64(env, FONT_R, "fontR"), fontB64(env, FONT_B, "fontB")]);
  const html = buildHTML(snap.rows, fR, fB, snap.dayFa, snap.daySub);
  const body = JSON.stringify({
    html,
    viewport: { width: 1600, height: snap.H },
    screenshotOptions: { type: "jpeg", quality: 90 },
    gotoOptions: { waitUntil: "networkidle0", timeout: 30000 },
  });
  log("CF", "html bytes=" + html.length, "viewport=1600x" + snap.H);
  // مسیر جدید browser-run و مسیر قدیمی browser-rendering (هر کدام جواب داد)
  for (const p of ["browser-run", "browser-rendering"]) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const t0 = Date.now();
      try {
        const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/${p}/screenshot`, {
          method: "POST",
          headers: { "Authorization": "Bearer " + env.CF_API_TOKEN, "content-type": "application/json" },
          body, signal: AbortSignal.timeout(50000),
        });
        const ct = r.headers.get("content-type") || "";
        const ms = Date.now() - t0;
        if (ct.includes("image")) {
          const buf = await r.arrayBuffer();
          log("CF", p, "attempt " + attempt, "OK bytes=" + buf.byteLength, ms + "ms");
          if (buf.byteLength > 15000) return buf;
          break;
        }
        const txt = (await r.text()).replace(/\s+/g, " ").slice(0, 300);
        log("CF", p, "attempt " + attempt, "status=" + r.status, "ct=" + ct, ms + "ms", "body=" + txt);
        if (r.status === 429) { await sleep(11000); continue; } // پلن رایگان: هر ۱۰ ثانیه ۱ درخواست
        break; // 404 → مسیر بعدی؛ 401/403/400 → ادامه فایده ندارد
      } catch (e) { log("CF", p, "attempt " + attempt, "ERROR", e.name + ": " + e.message); break; }
    }
  }
  return null;
}

// ---------- اجرای workflow گیت‌هاب (cron دقیق Cloudflare فقط «ماشه» است) ----------
async function dispatchGithub(env) {
  const wf = env.GH_WORKFLOW || "calendar.yml";
  const r = await fetch(`https://api.github.com/repos/${env.GH_REPO}/actions/workflows/${wf}/dispatches`, {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + env.GH_TOKEN,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "ff-calendar-worker",
      "content-type": "application/json",
    },
    body: JSON.stringify({ ref: env.GH_REF || "main" }),
  });
  log("GH", "dispatch status=" + r.status);
  if (r.status !== 204) throw new Error("GitHub dispatch " + r.status + ": " + (await r.text()).slice(0, 200));
}

async function fetchFeed(env) {
  const fresh = await env.CACHE.get("feed", "json");
  if (fresh) { log("FEED", "using cached feed, events:", fresh.length); return fresh; }
  const ff = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";
  const sources = ["https://cdn-nfs.faireconomy.media/ff_calendar_thisweek.json", ff,
    "https://api.allorigins.win/raw?url=" + encodeURIComponent(ff),
    "https://api.codetabs.com/v1/proxy?quest=" + encodeURIComponent(ff),
    "https://corsproxy.io/?url=" + encodeURIComponent(ff)];
  for (const u of sources) {
    const name = hostOf(u), t0 = Date.now();
    try {
      const r = await fetch(u, { headers: { "User-Agent": UA, "Accept": "application/json" }, signal: AbortSignal.timeout(5000) });
      if (!r.ok) { log("FEED", name, "status=" + r.status, (Date.now() - t0) + "ms"); continue; }
      const d = await r.json();
      if (Array.isArray(d) && d.length) {
        log("FEED", name, "OK events=" + d.length, (Date.now() - t0) + "ms");
        await env.CACHE.put("feed", JSON.stringify(d), { expirationTtl: 1200 });
        await env.CACHE.put("feed_bak", JSON.stringify(d), { expirationTtl: 259200 });
        return d;
      }
      log("FEED", name, "empty/invalid json");
    } catch (e) { log("FEED", name, "ERROR", e.message, (Date.now() - t0) + "ms"); }
  }
  const bak = (await env.CACHE.get("feed_bak", "json")) || [];
  log("FEED", "all sources failed, using backup events=" + bak.length);
  return bak;
}

async function buildSnapshot(env) {
  const S = await getSettings(env);
  const tz = S.mode === "tehran" ? "Asia/Tehran" : S.siteTz;
  const F = fmts(tz);
  const now = new Date();

  const all = await fetchFeed(env);
  const today = F.day.format(now);
  const evs = all.map(e => ({ ...e, ts: new Date(e.date).getTime() }))
    .filter(e => isFinite(e.ts) && F.day.format(e.ts) === today)
    .sort((a, b) => a.ts - b.ts);
  log("SNAP", "mode=" + S.mode, "tz=" + tz, "today=" + today, "feed=" + all.length, "todayEvents=" + evs.length);

  const T = JSON.parse(await env.CACHE.get("tmap") || "{}");
  const titles = [...new Set(evs.map(e => (e.title || "").trim()).filter(Boolean))];
  for (let i = 0; i < titles.length; i += 5)
    await Promise.all(titles.slice(i, i + 5).map(t => faTitle(t, env, T)));
  if (titles.length) await env.CACHE.put("tmap", JSON.stringify(T), { expirationTtl: 2592000 });

  const fx = s => S.numFa ? faDigits(s) : s;
  const rows = evs.length ? evs.map(e => {
    const kk = (e.title || "").trim();
    return {
      time: e.impact === "Holiday" ? "تمام روز" : fx(F.timeStr(e.ts)),
      cur: e.country || "",
      cls: IMPACT[e.impact] || "lo",
      title: T[kk] || DICT[kk] || kk || "—",
      actual: e.actual ? fx(e.actual) : "",
      forecast: e.forecast ? fx(e.forecast) : "",
      previous: e.previous ? fx(e.previous) : "",
    };
  }) : [{ time: "—", cur: "", cls: "ho", title: "امروز رویدادی ثبت نشده است", actual: "", forecast: "", previous: "" }];

  const dayFa = F.head.format(now), daySub = F.sub.format(now);
  const H = Math.max(600, Math.min(220 + rows.length * 62 + 30, 6000));
  await env.CACHE.put("snap", JSON.stringify({ rows, H, dayFa, daySub }), { expirationTtl: 86400 });
  await env.CACHE.put("snap_built", new Date().toISOString(), { expirationTtl: 604800 });
  log("SNAP", "saved rows=" + rows.length, "H=" + H);
  return evs.length;
}

async function run(env, quick = false, force = false) {
  const t0 = Date.now();
  const bucket = Math.floor(Date.now() / 1800000);
  log("RUN", "start quick=" + quick, "force=" + force, "bucket=" + bucket);

  const hasCF = !!(env.CF_ACCOUNT_ID && env.CF_API_TOKEN);
  const hasExt = !!(env.CANVAS_URL && !env.CANVAS_URL.includes("REPLACE"));
  if (!hasCF && !hasExt) throw new Error("نه CF_ACCOUNT_ID/CF_API_TOKEN تنظیم شده نه CANVAS_URL");
  if (!env.RUN_KEY) throw new Error("متغیر RUN_KEY تنظیم نشده است");
  if (!env.TG_TOKEN) throw new Error("متغیر TG_TOKEN تنظیم نشده است");
  if (!env.CHAT_ID) throw new Error("متغیر CHAT_ID تنظیم نشده است");

  if (!force && (await env.CACHE.get("sent_" + bucket))) { log("RUN", "already sent in this bucket, skip"); return "already-sent"; }

  const count = await buildSnapshot(env);
  if (!count) {
    log("RUN", "no events today");
    const flag = "empty_" + new Date().toISOString().slice(0, 10);
    if (!(await env.CACHE.get(flag))) {
      await env.CACHE.put(flag, "1", { expirationTtl: 172800 });
      await sendText(env, env.ADMIN_CHAT_ID, "ℹ️ امروز رویدادی در تقویم نیست؛ عکس خالی به کانال ارسال نشد.");
    }
    await env.CACHE.put("last_ok", new Date().toISOString(), { expirationTtl: 604800 });
    return "empty-day";
  }

  const snap = JSON.parse(await env.CACHE.get("snap"));
  const caption = "📅 تقویم اقتصادی " + snap.dayFa + " — فارکس‌فکتوری";
  let shot = null, via = "";

  // حداکثر ۲ دور تلاش؛ هر دور: اول مرورگر Cloudflare، بعد سرویس‌های خارجی (حالت سبک)
  for (let round = 1; round <= 2 && !shot; round++) {
    log("RUN", "screenshot round " + round);
    if (hasCF) {
      shot = await cfScreenshot(env, snap);
      if (shot) { via = "cloudflare"; break; }
    } else if (round === 1) log("RUN", "CF_ACCOUNT_ID / CF_API_TOKEN not set → skipping Cloudflare browser");

    if (hasExt) {
      const base = env.CANVAS_URL.replace(/\/$/, "");
      const targets = await shotTargets(base, snap.H, bucket, env.RUN_KEY, true); // همیشه حالت سبک: کم‌ترین تعداد درخواست
      shot = await grabShot(targets, 2, 2000);
      if (shot) { via = "external"; break; }
    }
    if (round < 2) { log("RUN", "round failed, waiting 25s"); await sleep(25000); }
  }

  if (!shot) {
    log("RUN", "FAILED: no screenshot after", (Date.now() - t0) + "ms");
    throw new Error("هیچ سرویس عکسی جواب نداد — دفعه‌ی بعد (۳۰ دقیقه دیگر) دوباره تلاش می‌شود");
  }

  await sendPhoto(env, env.CHAT_ID, shot, caption);
  log("RUN", "photo sent via=" + via);
  await env.CACHE.put("sent_" + bucket, "1", { expirationTtl: 7200 });
  await env.CACHE.put("last_ok", new Date().toISOString(), { expirationTtl: 604800 });
  await env.CACHE.delete("last_err").catch(() => {});
  log("RUN", "SENT OK total", (Date.now() - t0) + "ms");
  return "sent";
}

// ---------- صفحات ----------
function loginHTML(err) {
  return `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ورود به پنل</title><link href="https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/Vazirmatn-font-face.css" rel="stylesheet">
<style>body{font-family:Vazirmatn,Tahoma,sans-serif;background:linear-gradient(135deg,#2e4a78,#4867a3);min-height:100vh;display:flex;align-items:center;justify-content:center;margin:0}
.box{background:#fff;border-radius:18px;padding:36px;width:min(380px,92vw);box-shadow:0 12px 40px rgba(0,0,0,.3);text-align:center}
h1{font-size:19px;color:#2e4a78;margin-bottom:8px}p{font-size:13px;color:#6b7280;margin-bottom:22px}
.err{background:#fee2e2;color:#b91c1c;border-radius:10px;padding:10px;font-size:13px;margin-bottom:14px}
input{font-family:inherit;width:100%;border:1px solid #d8dee8;border-radius:10px;padding:12px 14px;font-size:15px;text-align:center;margin-bottom:14px}
button{font-family:inherit;width:100%;border:0;border-radius:10px;background:#0a8f3c;color:#fff;padding:13px;font-size:15px;font-weight:700;cursor:pointer}</style></head>
<body><div class="box"><h1>📊 پنل ربات تقویم</h1><p>برای ورود، رمز پنل را وارد کنید</p>
 ${err ? '<div class="err">رمز اشتباه است</div>' : ""}
<form method="get" action="/"><input name="key" type="password" placeholder="رمز پنل" autofocus><button>ورود</button></form></div></body></html>`;
}

function panelHTML() {
  return `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>پنل ربات تقویم اقتصادی</title>
<link href="https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/Vazirmatn-font-face.css" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Vazirmatn,Tahoma,sans-serif;background:#eef2f7;min-height:100vh;color:#1f2937}
.wrap{max-width:1000px;margin:0 auto;padding:28px 18px 60px}
header{background:linear-gradient(135deg,#2e4a78,#4867a3);color:#fff;border-radius:18px;padding:24px 28px;box-shadow:0 8px 24px rgba(46,74,120,.25);display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
header h1{font-size:21px;font-weight:800}
.idle{background:rgba(255,255,255,.15);border-radius:10px;padding:7px 14px;font-size:12px;white-space:nowrap}
.out{background:#dc2626;color:#fff;border:0;border-radius:10px;padding:9px 18px;font-family:inherit;font-size:13px;font-weight:700;cursor:pointer}
.out:hover{background:#b91c1c}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px;margin-top:18px}
.card{background:#fff;border-radius:14px;padding:16px 18px;box-shadow:0 2px 10px rgba(0,0,0,.06)}
.card .lbl{font-size:12px;color:#6b7280;margin-bottom:8px}
.card .val{font-size:15px;font-weight:700;word-break:break-word}
.ok{color:#0a8f3c}.bad{color:#dc2626}.mut{color:#6b7280;font-weight:500}
.actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:18px}
button{font-family:inherit;border:0;border-radius:12px;padding:13px 22px;font-size:14px;font-weight:700;cursor:pointer;transition:.15s}
button:disabled{opacity:.55;cursor:wait}
.b-run{background:#0a8f3c;color:#fff}.b-view{background:#4867a3;color:#fff}.b-ref{background:#e5e9f0;color:#1f2937}
#msg{display:none;margin-top:14px;background:#fff;border-right:4px solid #4867a3;border-radius:10px;padding:13px 16px;font-size:13.5px;box-shadow:0 2px 8px rgba(0,0,0,.05)}
#viewBox{display:none;margin-top:18px;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,.06)}
#viewBox iframe{width:100%;height:75vh;border:0;display:block}
.settings{background:#fff;border-radius:14px;padding:22px;box-shadow:0 2px 10px rgba(0,0,0,.06);margin-top:18px}
.settings h2{font-size:16px;margin-bottom:16px;color:#2e4a78}
.frow{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 0;border-bottom:1px solid #f1f3f7;flex-wrap:wrap}
.frow:last-of-type{border-bottom:0}
.frow .t{font-size:14px;font-weight:600}.frow .d{font-size:12px;color:#6b7280;margin-top:4px}
input[type=text]{font-family:inherit;border:1px solid #d8dee8;border-radius:10px;padding:10px 14px;font-size:14px;width:230px;direction:ltr;text-align:left}
.seg{display:flex;background:#eef1f6;border-radius:10px;padding:4px}
.seg label{padding:8px 16px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;color:#6b7280}
.seg input{display:none}
.seg label:has(input:checked){background:#4867a3;color:#fff}
.switch{position:relative;width:46px;height:26px}
.switch input{display:none}
.switch i{position:absolute;inset:0;background:#d1d5db;border-radius:20px;transition:.2s;cursor:pointer}
.switch i:before{content:"";position:absolute;width:20px;height:20px;border-radius:50%;background:#fff;top:3px;right:3px;transition:.2s}
.switch input:checked+i{background:#0a8f3c}
.switch input:checked+i:before{right:23px}
.save{background:#2e4a78;color:#fff;margin-top:16px}
</style></head><body><div class="wrap">
<header>
  <div><h1>📊 پنل ربات تقویم اقتصادی</h1>
  <p style="opacity:.85;font-size:12.5px;margin-top:5px">منبع: فارکس‌فکتوری — ارسال خودکار هر ۳۰ دقیقه به کانال</p></div>
  <div style="display:flex;gap:10px;align-items:center">
    <span class="idle" id="idle">⏱ ۲:۰۰</span>
    <button class="out" onclick="logout()">خروج ⏻</button>
  </div>
</header>
<div class="grid">
  <div class="card"><div class="lbl">آخرین ارسال موفق</div><div class="val mut" id="s-ok">—</div></div>
  <div class="card"><div class="lbl">رویدادهای امروز</div><div class="val" id="s-ev">—</div></div>
  <div class="card"><div class="lbl">به‌روزرسانی جدول</div><div class="val mut" id="s-blt">—</div></div>
  <div class="card"><div class="lbl">آخرین خطا</div><div class="val mut" id="s-err">ندارد ✓</div></div>
</div>
<div class="actions">
  <button class="b-run" id="runBtn" onclick="doRun(this)">🚀 اجرای دستی (ارسال به کانال)</button>
  <button class="b-view" onclick="toggleView(this)">🖼 مشاهده جدول</button>
  <button class="b-ref" id="refBtn" onclick="refreshTable(this)">🔄 تازه‌سازی جدول</button>
</div>
<div id="msg"></div>
<div id="viewBox"><iframe id="viewFrame" src="about:blank"></iframe></div>
<div class="settings">
  <h2>⚙️ تنظیمات</h2>
  <div class="frow">
    <div><div class="t">گروه‌بندی روز و ساعت</div><div class="d">«مطابق سایت» = عین جدول Today فارکس‌فکتوری</div></div>
    <div class="seg">
      <label><input type="radio" name="tzm" value="site"><span>مطابق سایت</span></label>
      <label><input type="radio" name="tzm" value="tehran"><span>تهران</span></label>
    </div>
  </div>
  <div class="frow">
    <div><div class="t">منطقه زمانی «مطابق سایت»</div><div class="d">سایت تو UTC+4 است → Asia/Dubai</div></div>
    <input type="text" id="siteTz" placeholder="America/New_York">
  </div>
  <div class="frow">
    <div><div class="t">اعداد فارسی</div><div class="d">نمایش ارقام با ۰۱۲۳</div></div>
    <label class="switch"><input type="checkbox" id="numFa"><i></i></label>
  </div>
  <button class="save" onclick="saveSettings(this)">💾 ذخیره تنظیمات</button>
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
function toggleView(btn){
  var v=document.getElementById('viewBox');
  if(v.style.display==='block'){v.style.display='none';btn.textContent='🖼 مشاهده جدول';return}
  v.style.display='block';
  var f=document.getElementById('viewFrame');f.src='/canvas?_='+Date.now();
  btn.textContent='🔽 بستن جدول';
}
async function loadStatus(manual){
  try{
    var r=await fetch('/api/status');var d=await r.json();
    if(d.auth===false){location.href='/';return}
    var a=document.getElementById('s-ok');a.textContent=fd(d.last_ok);a.className='val '+(d.last_ok?'ok':'mut');
    document.getElementById('s-ev').textContent=d.events_today+' رویداد';
    var b=document.getElementById('s-blt');b.textContent=fd(d.table_built);b.className='val '+(d.table_built?'ok':'mut');
    var e=document.getElementById('s-err');e.textContent=d.last_err||'ندارد ✓';e.className='val '+(d.last_err?'bad':'mut');
    document.querySelector('input[name=tzm][value="'+d.tz_mode+'"]').checked=true;
    document.getElementById('siteTz').value=d.site_tz||'';
    document.getElementById('numFa').checked=!!d.num_fa;
    if(manual)msg('✅ وضعیت به‌روزرسانی شد');
  }catch(e){msg('❌ خطا در دریافت وضعیت')}
}
async function refreshTable(btn){
  btn.disabled=true;btn.textContent='⏳ در حال دریافت از سایت…';left=IDLE;
  try{
    var r=await fetch('/api/refresh',{method:'POST'});var d=await r.json();
    msg(d.ok?'✅ '+d.message:'❌ '+d.message);
    var f=document.getElementById('viewFrame');if(document.getElementById('viewBox').style.display==='block')f.src='/canvas?_='+Date.now();
  }catch(e){msg('❌ خطا در به‌روزرسانی')}
  finally{btn.disabled=false;btn.textContent='🔄 تازه‌سازی جدول'}
  loadStatus(false);
}
async function doRun(btn){
  btn.disabled=true;btn.textContent='⏳ در حال ساخت عکس و ارسال…';left=IDLE;
  try{
    var r=await fetch('/api/run?force=1',{method:'POST'});var d=await r.json();
    msg(d.message);
  }catch(e){msg('❌ خطا در اجرا')}
  finally{btn.disabled=false;btn.textContent='🚀 اجرای دستی (ارسال به کانال)'}
  setTimeout(function(){loadStatus(false)},2000);
}
async function saveSettings(btn){
  btn.disabled=true;left=IDLE;
  var t=document.querySelector('input[name=tzm]:checked');
  try{
    var r=await fetch('/api/settings',{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({tz_mode:t?t.value:'site',site_tz:document.getElementById('siteTz').value.trim(),num_fa:document.getElementById('numFa').checked})});
    var d=await r.json();msg(d.ok?'✅ ذخیره شد — یک دقیقه صبر کنید و «تازه‌سازی جدول» را بزنید':'❌ خطا در ذخیره');
  }catch(e){msg('❌ خطا در ذخیره')}finally{btn.disabled=false}
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
    log("CRON", "triggered", new Date().toISOString());
    // اگر GH_TOKEN و GH_REPO تنظیم باشد، ساخت و ارسال عکس را GitHub انجام می‌دهد
    if (env.GH_TOKEN && env.GH_REPO) {
      ctx.waitUntil(dispatchGithub(env).catch(async e => {
        log("CRON", "GitHub dispatch ERROR:", e.message);
        await env.CACHE.put("last_err", e.message + " @ " + new Date().toISOString(), { expirationTtl: 604800 }).catch(() => {});
        try { await sendText(env, env.ADMIN_CHAT_ID, "❌ اجرای GitHub شروع نشد: " + e.message); } catch {}
      }));
      return;
    }
    ctx.waitUntil(run(env, true).then(r => log("CRON", "result:", r, "✅")).catch(async e => {
      log("CRON", "ERROR:", e.message);
      await env.CACHE.put("last_err", e.message + " @ " + new Date().toISOString(), { expirationTtl: 604800 }).catch(() => {});
      try { await sendText(env, env.ADMIN_CHAT_ID, "❌ خطای ربات تقویم: " + e.message); } catch {}
    }));
  },
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/+/, "/");
    const html = { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" };
    const ua = (req.headers.get("user-agent") || "").slice(0, 60);

    // ---------- ورود / پنل ----------
    if (path === "/" || path === "") {
      const key = url.searchParams.get("key");
      if (key != null) {
        // تلاش برای ورود (چه از فرم، چه لینک قدیمی)
        if (key === env.RUN_KEY) {
          const sid = await createSession(env);
          log("AUTH", "login OK");
          return new Response(null, { status: 302, headers: { "location": "/", "set-cookie": sessionCookie(sid) } });
        }
        log("AUTH", "login WRONG password, ua=" + ua);
        return new Response(loginHTML(true), { headers: html });
      }
      if (await checkSession(env, req)) return new Response(panelHTML(), { headers: html });
      return new Response(loginHTML(false), { headers: html });
    }

    // ---------- خروج ----------
    if (path === "/api/logout" && req.method === "POST") {
      const sid = getCookie(req, "sid");
      if (sid) await env.CACHE.delete("sess:" + sid);
      return new Response(JSON.stringify({ ok: true }), { headers: { "set-cookie": clearCookie(), "content-type": "application/json" } });
    }

    // ---------- تمدید سشن با فعالیت ----------
    if (path === "/api/ping" && req.method === "POST") {
      if (!(await checkSession(env, req))) return new Response(JSON.stringify({ auth: false }), { status: 401 });
      return new Response(JSON.stringify({ ok: true }));
    }

    // ---------- بقیه‌ی API ها: فقط با سشن ----------
    const authed = await checkSession(env, req);

    if (path === "/api/status") {
      if (!authed) return new Response(JSON.stringify({ auth: false }), { status: 401 });
      const S = await getSettings(env);
      const tz = S.mode === "tehran" ? "Asia/Tehran" : S.siteTz;
      const F = fmts(tz);
      const all = (await env.CACHE.get("feed", "json")) || (await env.CACHE.get("feed_bak", "json")) || [];
      const n = all.map(e => new Date(e.date).getTime()).filter(ts => isFinite(ts) && F.day.format(ts) === F.day.format(new Date())).length;
      return new Response(JSON.stringify({
        auth: true,
        last_ok: await env.CACHE.get("last_ok") || null,
        last_err: await env.CACHE.get("last_err") || null,
        table_built: await env.CACHE.get("snap_built") || null,
        events_today: n,
        tz_mode: S.mode, site_tz: S.siteTz, num_fa: S.numFa,
      }), { headers: { "content-type": "application/json; charset=utf-8" } });
    }

    if (path === "/api/refresh" && req.method === "POST") {
      if (!authed) return new Response(JSON.stringify({ ok: false, message: "سشن منقضی شده" }), { status: 401 });
      try {
        const n = await buildSnapshot(env);
        return new Response(JSON.stringify({ ok: true, message: n ? "جدول به‌روزرسانی شد (" + n + " رویداد امروز)" : "جدول به‌روزرسانی شد — امروز رویدادی نیست" }), { headers: { "content-type": "application/json; charset=utf-8" } });
      } catch (e) {
        log("REFRESH", "ERROR", e.message);
        return new Response(JSON.stringify({ ok: false, message: e.message }), { headers: { "content-type": "application/json; charset=utf-8" } });
      }
    }

    if (path === "/api/run" && req.method === "POST") {
      if (!authed) return new Response(JSON.stringify({ ok: false, message: "سشن منقضی شده" }), { status: 401 });
      const force = url.searchParams.get("force") === "1";
      log("MANUAL", "run requested force=" + force);
      ctx.waitUntil(run(env, true, force).then(r => log("MANUAL", "result:", r, "✅")).catch(async e => {
        log("MANUAL", "ERROR:", e.message);
        await env.CACHE.put("last_err", e.message + " @ " + new Date().toISOString(), { expirationTtl: 604800 }).catch(() => {});
        try { await sendText(env, env.ADMIN_CHAT_ID, "ℹ️ اجرای دستی: " + e.message); } catch {}
      }));
      return new Response(JSON.stringify({ ok: true, message: "✅ در حال ساخت عکس… عکس تا ~۲۰ ثانیه دیگر به کانال می‌رود" }), { headers: { "content-type": "application/json; charset=utf-8" } });
    }

    if (path === "/api/settings" && req.method === "POST") {
      if (!authed) return new Response(JSON.stringify({ ok: false }), { status: 401 });
      try {
        const b = await req.json();
        if (b.tz_mode === "site" || b.tz_mode === "tehran") await env.CACHE.put("set_TZ_MODE", b.tz_mode, { expirationTtl: 31536000 });
        if (typeof b.site_tz === "string" && b.site_tz) await env.CACHE.put("set_SITE_TZ", b.site_tz, { expirationTtl: 31536000 });
        await env.CACHE.put("set_NUM_FA", b.num_fa ? "1" : "0", { expirationTtl: 31536000 });
        log("SETTINGS", "saved", JSON.stringify(b));
        return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
      } catch (e) { log("SETTINGS", "ERROR", e.message); return new Response(JSON.stringify({ ok: false }), { status: 400 }); }
    }

    // ---------- جدول: فقط سشن معتبر یا توکن چرخشیِ مخصوص سرویس عکس ----------
    if (path === "/canvas") {
      let ok = await checkSession(env, req);
      let how = ok ? "session" : "none";
      const skey = url.searchParams.get("skey"), b = parseInt(url.searchParams.get("b") || "0");
      if (!ok) {
        const bucket = Math.floor(Date.now() / 1800000);
        // بازه فعلی یا قبلی (برای تاخیر mshots)
        for (const bb of [bucket, bucket - 1]) {
          if (skey && b === bb && skey === (await sha256(env.RUN_KEY + ":" + bb))) { ok = true; how = "skey(b=" + bb + ")"; break; }
        }
      }
      // این لاگ نشان می‌دهد آیا سرویس‌های عکس‌گیری اصلاً به Worker شما رسیده‌اند یا نه
      if (skey) log("CANVAS", "hit from screenshot service:", ok ? "ALLOWED " + how : "DENIED", "b=" + b, "ua=" + ua);
      if (!ok) return new Response(loginHTML(false), { headers: html }); // رمز بخواه
      const snap = await env.CACHE.get("snap");
      if (!snap) { log("CANVAS", "no snapshot in KV"); return new Response("no snapshot yet", { status: 404 }); }
      const { rows, dayFa, daySub } = JSON.parse(snap);
      const [fR, fB] = await Promise.all([fontB64(env, FONT_R, "fontR"), fontB64(env, FONT_B, "fontB")]);
      const out = buildHTML(rows, fR, fB, dayFa, daySub);
      if (skey) log("CANVAS", "served html bytes=" + out.length, "fontR=" + fR.length, "fontB=" + fB.length);
      return new Response(out, { headers: html });
    }

    // هر آدرس دیگری → صفحه ورود
    return new Response(loginHTML(false), { headers: html });
  },
};
