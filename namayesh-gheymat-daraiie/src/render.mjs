// Renders the price picture: assets/template.png (artwork, no live text) + live values on top.
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = resolve(ROOT, 'assets');

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fmt = (n) => new Intl.NumberFormat('en-US').format(n);

// ── layout: which key sits in which row of the template ─────────────────────────
// numRight = x of the number's right edge, arrowX = centre of the trend arrow, maxW = widest allowed number
const SECTIONS = [
  {
    keys: ['USDTIRT', 'EUR', 'GBP', 'DERHAM', 'TETHERTOMAN'],
    ys: [350, 406, 466, 527, 590],
    numRight: 375, arrowX: 465, maxW: 118, size: 27,
  },
  {
    keys: ['XAUUSD', 'GOLD18GRAM', 'XAGGRAMUSD', 'COINNEW', 'MELTEDGOLD', 'HALFCOIN', 'QUARTERCOIN'],
    ys: [351, 400, 449, 499, 549, 600, 650],
    numRight: 903, arrowX: 972, maxW: 140, size: 27,
    rightAt: { 0: 908, 2: 908 }, fifthMaxW: 130,
  },
  {
    keys: ['BRENTOIL', 'WTI', 'GAS'],
    ys: [761, 822, 882],
    numRight: 386, arrowX: 465, maxW: 100, size: 28,
  },
  {
    keys: ['BTCUSDT', 'ETHUSD', 'BNBUSDT'],
    ys: [814, 875, 935],
    numRight: 947, arrowX: 974, maxW: 142, size: 28,
  },
  {
    keys: ['BOURSEIDX', 'FRABOURSEIDX', 'HAMVAZNEIDX'],
    ys: [1114, 1158, 1205],
    numRight: 572, arrowX: 672, maxW: 170, size: 27,
  },
];

// ── weather icons (simple inline SVG, 40x40) ────────────────────────────────────
const CLOUD = '<path d="M12 30a7 7 0 0 1 1.2-13.9A9 9 0 0 1 30.6 15 6.5 6.5 0 0 1 31 30z" fill="url(#cg)" stroke="#bcd7ff" stroke-width="1"/>';
const SUN = (cx, cy, r) => {
  let rays = '';
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    rays += `<line x1="${cx + Math.cos(a) * (r + 3)}" y1="${cy + Math.sin(a) * (r + 3)}" x2="${cx + Math.cos(a) * (r + 7)}" y2="${cy + Math.sin(a) * (r + 7)}" stroke="#ffc933" stroke-width="2.4" stroke-linecap="round"/>`;
  }
  return `${rays}<circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#sg)"/>`;
};
const WEATHER_ICONS = {
  sun: SUN(20, 20, 8),
  partly: `${SUN(14, 14, 6)}<g transform="translate(2 4)">${CLOUD}</g>`,
  cloud: `<g transform="translate(0 2)">${CLOUD}</g>`,
  fog: `<g transform="translate(0 -3)">${CLOUD}</g><g stroke="#bcd7ff" stroke-width="2.4" stroke-linecap="round"><line x1="8" y1="31" x2="32" y2="31"/><line x1="12" y1="36" x2="34" y2="36"/></g>`,
  rain: `<g transform="translate(0 -4)">${CLOUD}</g><g stroke="#52b6ff" stroke-width="2.6" stroke-linecap="round"><line x1="13" y1="32" x2="11" y2="37"/><line x1="21" y1="32" x2="19" y2="37"/><line x1="29" y1="32" x2="27" y2="37"/></g>`,
  snow: `<g transform="translate(0 -4)">${CLOUD}</g><g fill="#fff"><circle cx="12" cy="34" r="2"/><circle cx="21" cy="36" r="2"/><circle cx="30" cy="34" r="2"/></g>`,
  storm: `<g transform="translate(0 -4)">${CLOUD}</g><path d="M22 28 l-6 9 h5 l-2 6 l8 -10 h-5 z" fill="#ffd23c"/>`,
};
function weatherIconKey(code) {
  if (code === 0) return 'sun';
  if (code === 1 || code === 2) return 'partly';
  if (code === 3) return 'cloud';
  if (code === 45 || code === 48) return 'fog';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'snow';
  if (code >= 95) return 'storm';
  if (code >= 51) return 'rain';
  return 'cloud';
}

function shortRange(range) {
  if (!range) return '';
  let s = range.replace(/\s\d{4}/g, '');
  const m = s.match(/^(\d+) (\S+) تا (\d+) (\S+)$/);
  if (m && m[2] === m[4]) s = `${m[1]} تا ${m[3]} ${m[2]}`;
  return s;
}

const arrowHtml = (trend, x, y) => {
  const cls = trend === 'up' ? 'up' : trend === 'down' ? 'down' : 'flat';
  return `<i class="arrow ${cls}" style="left:${x}px;top:${y}px"></i>`;
};

function numberCell(x, y, text, size, maxW, extraClass = '') {
  return `<span class="num ${extraClass}" data-maxw="${maxW}" style="right:${1024 - x}px;top:${y}px;font-size:${size}px">${esc(text)}</span>`;
}

export function buildHtml(data) {
  const items = data.items || {};
  const parts = [];

  for (const sec of SECTIONS) {
    sec.keys.forEach((key, i) => {
      const y = sec.ys[i];
      const item = items[key];
      const has = item && typeof item.value === 'number' && !Number.isNaN(item.value);
      let right = sec.numRight;
      if (sec.rightAt && sec.rightAt[i]) right = sec.rightAt[i];
      let maxW = sec.maxW;
      if (sec.fifthMaxW && i === 4) maxW = sec.fifthMaxW;
      parts.push(numberCell(right, y, has ? fmt(item.value) : '—', sec.size, maxW, has ? '' : 'dim'));
      if (has) parts.push(arrowHtml(item.trend, sec.arrowX, y));
    });
  }

  // ── date / time block (bottom right) ──
  const d = data.dates;
  const shamsi = `${data.weekDay} ${d.shamsi.day} ${d.shamsi.monthName} ${d.shamsi.year}`;
  const hijri = `${d.hijri.day} ${d.hijri.monthName} ${d.hijri.year}`;
  const greg = `${d.gregorian.day} ${d.gregorian.monthName} ${d.gregorian.year}`;
  parts.push(`<span class="txt big" data-maxw="190" style="right:${1024 - 931}px;top:1322px">${esc(shamsi)}</span>`);
  parts.push(`<span class="txt big" data-maxw="195" style="right:${1024 - 931}px;top:1352px">${esc(hijri)}</span>`);
  parts.push(`<span class="txt big ltr" data-maxw="195" style="right:${1024 - 931}px;top:1380px">${esc(greg)}</span>`);
  parts.push(`<span class="txt time ltr" data-maxw="75" style="right:${1024 - 692}px;top:1322px">${esc(data.time)}</span>`);

  // weather
  if (data.weather) {
    const w = data.weather;
    parts.push(
      `<span class="txt mid" data-maxw="250" style="right:${1024 - 931}px;top:1418px">آب‌وهوای تهران: <b class="ltr">${esc(w.temperature)}°</b> ${esc(w.text)}</span>`
    );
    const key = weatherIconKey(w.code);
    parts.push(
      `<svg class="wicon" style="left:936px;top:1399px" width="40" height="40" viewBox="0 0 40 40">
         <defs>
           <linearGradient id="cg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#9fc4f2"/></linearGradient>
           <radialGradient id="sg"><stop offset="0" stop-color="#fff3a0"/><stop offset="1" stop-color="#ffb300"/></radialGradient>
         </defs>${WEATHER_ICONS[key]}</svg>`
    );
  } else {
    parts.push(`<span class="txt mid dim" style="right:${1024 - 931}px;top:1418px">آب‌وهوای تهران: —</span>`);
  }

  // occasions
  parts.push(`<span class="txt mid" style="right:${1024 - 931}px;top:1455px">مناسبت‌های امروز:</span>`);
  const events = (data.events || []).filter(Boolean);
  parts.push(
    `<div class="events" style="right:${1024 - 931}px;top:1470px">${
      events.length ? esc(events.join(' • ')) : '<span class="dim">—</span>'
    }</div>`
  );

  // ── zodiac block (bottom left) ──
  const R = 468;
  const moon = data.moon || {};
  const edge = data.monthEdge || '';
  const rows = [
    { y: 1322, label: 'صورت فلکی: برج', value: data.zodiac || '', ltrValue: true, size: 18 },
    { y: 1354, label: 'قمر در صورت فلکی عقرب:', value: shortRange(moon.inConstellation) },
    { y: 1384, label: 'قمر در برج عقرب:', value: shortRange(moon.inZodiac) },
    { y: 1414, label: 'اول ماه قمری:', value: edge === 'اول ماه قمری' ? 'امروز' : '' },
    { y: 1445, label: 'آخر ماه قمری:', value: edge === 'آخر ماه قمری' ? 'امروز' : '' },
    { y: 1475, label: 'ماه شب 14:', value: data.isFullMoonNight ? 'امروز' : '' },
  ];
  for (const r of rows) {
    const val = r.value
      ? `<span class="val${r.ltrValue ? ' ltrv' : ''}">${esc(r.value)}</span>`
      : '<span class="val dim">—</span>';
    parts.push(
      `<span class="txt zrow" data-maxw="${R - 236}" style="right:${1024 - R}px;top:${r.y}px;font-size:${r.size || 16}px">${esc(r.label)} ${val}</span>`
    );
  }

  // footer: last update
  const stamp = `${d.shamsi.year}/${String(d.shamsi.month).padStart(2, '0')}/${String(d.shamsi.day).padStart(2, '0')}  ${data.time}`;
  parts.push(`<span class="txt upd ltr" data-maxw="170" style="left:221px;top:1279px;transform:translate(-50%,-50%)">${esc(stamp)}</span>`);

  return `<!doctype html>
<html lang="fa" dir="rtl"><head><meta charset="utf-8">
<style>
@font-face{font-family:V;src:url('fonts/Vazirmatn-Medium.woff2');font-weight:500}
@font-face{font-family:V;src:url('fonts/Vazirmatn-Bold.woff2');font-weight:700}
@font-face{font-family:V;src:url('fonts/Vazirmatn-ExtraBold.woff2');font-weight:800}
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:1024px;height:1536px;background:#050a14;overflow:hidden}
#bg{position:absolute;left:0;top:0;width:1024px;height:1536px}
.num,.txt,.events{position:absolute;font-family:V,sans-serif;color:#fff;white-space:nowrap;line-height:1;
  text-shadow:0 0 7px rgba(255,255,255,.22),0 2px 3px rgba(0,0,0,.85)}
.num{font-weight:800;transform:translateY(-50%);direction:ltr;text-align:right;letter-spacing:.2px}
.dim{color:#8a97ab !important;text-shadow:none}
.txt{font-weight:700;transform:translateY(-50%)}
.big{font-size:21px}
.mid{font-size:20px}
.time{font-size:24px;font-weight:800}
.upd{font-size:18px;font-weight:700;color:#fff}
.ltr{direction:ltr;unicode-bidi:isolate}
.zrow{font-size:16px}
.val{color:#ffd36b;margin-right:2px}
.val.ltrv{direction:ltr;unicode-bidi:isolate;font-weight:800}
.events{font-size:17px;font-weight:700;transform:none;white-space:normal;width:300px;line-height:1.15;text-align:right}
.arrow{position:absolute;display:block;width:27px;height:30px;transform:translate(-50%,-50%)}
.arrow.up{background:linear-gradient(180deg,#6fffd0,#0fa070);clip-path:polygon(50% 0,100% 100%,0 100%);filter:drop-shadow(0 0 4px rgba(40,230,160,.75))}
.arrow.down{background:linear-gradient(0deg,#ff8f8f,#c4202c);clip-path:polygon(0 0,100% 0,50% 100%);filter:drop-shadow(0 0 4px rgba(255,70,70,.7))}
.arrow.flat{width:24px;height:6px;border-radius:3px;background:linear-gradient(180deg,#d6dde8,#7d8899);filter:drop-shadow(0 0 3px rgba(190,205,225,.5))}
.wicon{position:absolute;filter:drop-shadow(0 0 4px rgba(150,200,255,.5))}
</style></head><body>
<img id="bg" src="template.png">
${parts.join('\n')}
<script>
document.fonts.ready.then(()=>{
  document.querySelectorAll('[data-maxw]').forEach(el=>{
    const max=parseFloat(el.dataset.maxw);
    let size=parseFloat(getComputedStyle(el).fontSize);
    let guard=40;
    while(el.getBoundingClientRect().width>max && size>11 && guard--){ size-=0.5; el.style.fontSize=size+'px'; }
  });
  const ev=document.querySelector('.events');
  if(ev){ let s=17,g=30; while(ev.getBoundingClientRect().height>32 && s>11 && g--){ s-=0.5; ev.style.fontSize=s+'px'; } }
  document.body.dataset.ready='1';
});
</script></body></html>`;
}

export async function renderImage(data, outPath, { scale = 1.25, quality = 94 } = {}) {
  const htmlPath = resolve(ASSETS, '_page.html');
  writeFileSync(htmlPath, buildHtml(data));
  mkdirSync(dirname(resolve(outPath)), { recursive: true });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1024, height: 1536 }, deviceScaleFactor: scale });
    await page.goto(pathToFileURL(htmlPath).href);
    await page.waitForSelector('body[data-ready="1"]', { timeout: 15000 });
    await page.screenshot({ path: outPath, type: 'jpeg', quality });
  } finally {
    await browser.close();
  }
  return outPath;
}
