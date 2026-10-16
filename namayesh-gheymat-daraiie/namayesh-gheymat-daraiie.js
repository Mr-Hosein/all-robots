export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/favicon.ico') {
      return new Response(null, { status: 204 });
    }

       if (url.searchParams.get('data') === '1') {
     if (!env.DATA_API_KEY || request.headers.get('X-Api-Key') !== env.DATA_API_KEY) {
       return new Response('forbidden', { status: 403 });
     }
     return await handleDataRequest(env);
   }

    // ── خروج از سشن ──
    if (url.searchParams.get('logout') === '1') {
      return new Response(null, {
        status: 302,
        headers: {
          'Location': url.pathname,
          'Set-Cookie': `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Max-Age=0; SameSite=Strict`,
        },
      });
    }

    // ── بررسی لاگین ──
    const sessionToken = getCookie(request, SESSION_COOKIE_NAME);
    const hasValidSession = await isValidSessionToken(sessionToken, env);

    if (!hasValidSession) {
      if (request.method === 'POST') {
        const formData = await request.formData();
        const username = formData.get('username');
        const password = formData.get('password');

        if (username === env.LOGIN_USERNAME && password === env.LOGIN_PASSWORD) {
          const newToken = await makeSessionToken(env);
          return new Response(null, {
            status: 302,
            headers: {
              'Location': url.pathname,
              'Set-Cookie': `${SESSION_COOKIE_NAME}=${newToken}; Path=/; HttpOnly; Max-Age=${SESSION_DURATION_SECONDS}; SameSite=Strict`,
            },
          });
        }

        return new Response(loginPageHtml('نام کاربری یا رمز عبور اشتباه است.'), {
          status: 401,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }

      return new Response(loginPageHtml(null), {
        status: 401,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    // ── لاگین معتبره ──

    // ذخیره‌ی یوزرنیم کانال (برای نمایش پایین پیام) از طریق پنل
    if (url.searchParams.get('saveFooter') === '1' && request.method === 'POST') {
      let body = null;
      try {
        body = await request.json();
      } catch (error) {
        body = null;
      }
      const newUsername = body && typeof body.username === 'string' ? body.username.trim() : '';
      await setFooterUsername(env, newUsername);
      const refreshedTokenForSave = await makeSessionToken(env);
      const saveResponse = new Response('ذخیره شد.');
      saveResponse.headers.append(
        'Set-Cookie',
        `${SESSION_COOKIE_NAME}=${refreshedTokenForSave}; Path=/; HttpOnly; Max-Age=${SESSION_DURATION_SECONDS}; SameSite=Strict`
      );
      return saveResponse;
    }

    const refreshedToken = await makeSessionToken(env);
    // اگه آدرس ?send=1 داشته باشه، یه اجرای واقعی (با پین/آنپین) برای تست انجام می‌ده
    const isTestSend = url.searchParams.get('send') === '1';
    // اگه آدرس ?preview=1 داشته باشه، پیام رو واقعاً می‌فرسته ولی پین/آنپین نمی‌کنه
    const isTestPreview = url.searchParams.get('preview') === '1';
    const response = isTestPreview
      ? await sendCombinedMessage(env, { pin: false })
      : isTestSend
      ? await sendCombinedMessage(env, { pin: true })
      : await handleStatusView(env);
    const newResponse = new Response(response.body, response);
    newResponse.headers.append(
      'Set-Cookie',
      `${SESSION_COOKIE_NAME}=${refreshedToken}; Path=/; HttpOnly; Max-Age=${SESSION_DURATION_SECONDS}; SameSite=Strict`
    );
    return newResponse;
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(sendCombinedMessage(env, { pin: false }));
  },
};

// ─────────────────────────────────────────────
// تبدیل تاریخ میلادی به شمسی (جلالی)
// ─────────────────────────────────────────────
function gregorianToJalali(gy, gm, gd) {
  const g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  let jy = gy <= 1600 ? 0 : 979;
  gy -= gy <= 1600 ? 621 : 1600;
  const gy2 = gm > 2 ? gy + 1 : gy;
  let days =
    365 * gy +
    Math.floor((gy2 + 3) / 4) -
    Math.floor((gy2 + 99) / 100) +
    Math.floor((gy2 + 399) / 400) -
    80 +
    gd +
    g_d_m[gm - 1];
  jy += 33 * Math.floor(days / 12053);
  days %= 12053;
  jy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) {
    jy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }
  let jm, jd;
  if (days < 186) {
    jm = 1 + Math.floor(days / 31);
    jd = 1 + (days % 31);
  } else {
    jm = 7 + Math.floor((days - 186) / 30);
    jd = 1 + ((days - 186) % 30);
  }
  return [jy, jm, jd];
}

// ─────────────────────────────────────────────
// تبدیل تاریخ میلادی به قمری (هجری، الگوریتم تقویم مدنی/کویتی)
// ─────────────────────────────────────────────
function gregorianToHijri(gy, gm, gd) {
  let jd =
    Math.floor((1461 * (gy + 4800 + Math.floor((gm - 14) / 12))) / 4) +
    Math.floor((367 * (gm - 2 - 12 * Math.floor((gm - 14) / 12))) / 12) -
    Math.floor((3 * Math.floor((gy + 4900 + Math.floor((gm - 14) / 12)) / 100)) / 4) +
    gd -
    32075;

  // الگوریتم محاسباتی (کویتی) نسبت به تقویم رسمیِ مبتنی بر رصد هلال در ایران
  // معمولاً ۱ روز جلوتره؛ این آفست همون اختلاف رو جبران می‌کنه
  jd -= 1;

  let l = jd - 1948440 + 10632;
  const n = Math.floor((l - 1) / 10631);
  l = l - 10631 * n + 354;
  const j =
    Math.floor((10985 - l) / 5316) * Math.floor((50 * l) / 17719) +
    Math.floor(l / 5670) * Math.floor((43 * l) / 15238);
  l =
    l -
    Math.floor((30 - j) / 15) * Math.floor((17719 * j) / 50) -
    Math.floor(j / 16) * Math.floor((15238 * j) / 43) +
    29;
  const hm = Math.floor((24 * l) / 709);
  const hd = l - Math.floor((709 * hm) / 24);
  const hy = 30 * n + j - 30;
  return [hy, hm, hd];
}

const CLOCK_EMOJIS = [
  '🕛', '🕧', '🕐', '🕜', '🕑', '🕝', '🕒', '🕞', '🕓', '🕟', '🕔', '🕠',
  '🕕', '🕡', '🕖', '🕢', '🕗', '🕣', '🕘', '🕤', '🕙', '🕥', '🕚', '🕦',
];

function getClockEmoji(hour24, minute) {
  const hour12 = hour24 % 12;
  const halfIndex = minute >= 15 && minute < 45 ? 1 : 0;
  // هر ساعت دو حالت داره (کامل و نیم)، بعد از ساعت 12 دوباره میچرخه
  const idx = hour12 * 2 + halfIndex;
  return CLOCK_EMOJIS[idx];
}

const PERSIAN_MONTHS = [
  'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'اَمرداد', 'شهریور',
  'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند',
];
const HIJRI_MONTHS = [
  'محرم', 'صفر', 'ربیع‌الاول', 'ربیع‌الثانی', 'جمادی‌الاول', 'جمادی‌الثانی',
  'رجب', 'شعبان', 'رمضان', 'شوال', 'ذوالقعده', 'ذوالحجه',
];
const GREGORIAN_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function stripDiacritics(text) {
  return text.replace(/[\u064B-\u0652\u0670]/g, '');
}

// ─────────────────────────────────────────────
// گرفتن تاریخ شمسی/قمریِ رسمی از time.ir (بر پایه‌ی رصد واقعی، نه فقط محاسبه)
// ─────────────────────────────────────────────
function convertArabicIndicDigits(str) {
  const arabicIndic = '٠١٢٣٤٥٦٧٨٩';
  return str.replace(/[٠-٩]/g, (d) => arabicIndic.indexOf(d).toString());
}

function extractTimeIrDates(html) {
  try {
    const shamsiMatch = html.match(/تاریخ خورشیدی[\s\S]{0,200}?(\d{4})\/(\d{2})\/(\d{2})/);
    const hijriMatchRaw = html.match(/تاریخ قمری[\s\S]{0,200}?([٠-٩]{4})\/([٠-٩]{2})\/([٠-٩]{2})/);

    if (!shamsiMatch || !hijriMatchRaw) return null;

    return {
      shamsi: {
        year: parseInt(shamsiMatch[1], 10),
        month: parseInt(shamsiMatch[2], 10),
        day: parseInt(shamsiMatch[3], 10),
      },
      hijri: {
        year: parseInt(convertArabicIndicDigits(hijriMatchRaw[1]), 10),
        month: parseInt(convertArabicIndicDigits(hijriMatchRaw[2]), 10),
        day: parseInt(convertArabicIndicDigits(hijriMatchRaw[3]), 10),
      },
    };
  } catch (error) {
    return null;
  }
}

// ─────────────────────────────────────────────
// برج فلکی از time.ir + معادل «صورت فلکی» واقعی (یه برج عقب‌تر، به‌خاطر تقدیم اعتدالین)
// ─────────────────────────────────────────────
const ZODIAC_SIGNS_FA = ['حمل', 'ثور', 'جوزا', 'سرطان', 'اسد', 'سنبله', 'میزان', 'عقرب', 'قوس', 'جدی', 'دلو', 'حوت'];
const ZODIAC_EN_NAMES = {
  حمل: 'Aries',
  ثور: 'Taurus',
  جوزا: 'Gemini',
  سرطان: 'Cancer',
  اسد: 'Leo',
  سنبله: 'Virgo',
  میزان: 'Libra',
  عقرب: 'Scorpio',
  قوس: 'Sagittarius',
  جدی: 'Capricorn',
  دلو: 'Aquarius',
  حوت: 'Pisces',
};

function extractTimeIrZodiac(html) {
  const signsPattern = ZODIAC_SIGNS_FA.join('|');
  const regex = new RegExp(`برج فلکی[\\s\\S]{0,400}?>(${signsPattern})<`);
  const match = html.match(regex);
  return match ? match[1] : null;
}

function getPreviousZodiacEnglishName(persianSignName) {
  const idx = ZODIAC_SIGNS_FA.indexOf(persianSignName);
  if (idx === -1) return null;
  const prevSign = ZODIAC_SIGNS_FA[(idx - 1 + 12) % 12];
  return ZODIAC_EN_NAMES[prevSign];
}

// ─────────────────────────────────────────────
// مناسبت‌های امروز، از فایل occasions.json روی گیت‌هاب کاربر
// (مستقل از time.ir؛ حتی اگه time.ir در دسترس نباشه، این جدا کار می‌کنه)
// ─────────────────────────────────────────────
async function fetchTodayEventsFromGithub(jd, persianMonthName, hd, hijriMonthName, gd, gregorianMonthName) {
  try {
    const response = await fetchWithTimeout(
      'https://raw.githubusercontent.com/hoseinbalckhat/occasionstelegrambot/refs/heads/main/occasions.json',
      { headers: COMMON_HEADERS },
      20000
    );
    if (!response.ok) {
      return { events: [], error: `HTTP ${response.status}` };
    }
    const eventsList = await response.json();
    const todayEvents = [];

    for (const ev of eventsList) {
      const type = ev.date && ev.date.type;
      const [dayStr, monthStr] = (ev.date && ev.date.date) || [];
      if (!dayStr || !monthStr) continue;
      const day = parseInt(dayStr, 10);
      const monthNorm = stripDiacritics(monthStr).trim();

      if (type === 'shamsi' && day === jd && stripDiacritics(persianMonthName) === monthNorm) {
        todayEvents.push(ev.event_name);
      } else if (type === 'hijri' && day === hd && stripDiacritics(hijriMonthName) === monthNorm) {
        todayEvents.push(ev.event_name);
      } else if (type === 'gregorian' && day === gd && monthStr.trim().toLowerCase() === gregorianMonthName.toLowerCase()) {
        todayEvents.push(ev.event_name);
      }
    }

    return { events: todayEvents, error: null };
  } catch (error) {
    const isTimeout = error && error.name === 'AbortError';
    return {
      events: [],
      error: isTimeout ? 'تایم‌اوت پس از 20 ثانیه' : `خطا: ${error && error.message}`,
    };
  }
}

function getTehranNow() {
  // ایران از ۱۴۰۱ دیگر ساعت تابستانی نداره، همیشه UTC+3:30
  const now = new Date();
  const tehranMs = now.getTime() + (3 * 60 + 30) * 60 * 1000;
  return new Date(tehranMs);
}

async function getTodayOccasions(env) {
  const tehranNow = getTehranNow();
  const gy = tehranNow.getUTCFullYear();
  const gm = tehranNow.getUTCMonth() + 1;
  const gd = tehranNow.getUTCDate();

  let jy, jm, jd, hy, hm, hd;
  let usedTimeIr = false;
  let zodiacPreviousEnglish = null;
  let todayEvents = [];
  let error = null;

  try {
    const response = await fetchWithTimeout(
      'https://www.time.ir',
      {
        headers: {
          ...COMMON_HEADERS,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Encoding': 'gzip, deflate, br',
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
          'Upgrade-Insecure-Requests': '1',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1',
          Referer: 'https://www.google.com/',
        },
      },
      20000
    );
    if (response.ok) {
      const html = await response.text();
      const timeIrDates = extractTimeIrDates(html);
      if (timeIrDates) {
        jy = timeIrDates.shamsi.year;
        jm = timeIrDates.shamsi.month;
        jd = timeIrDates.shamsi.day;
        hy = timeIrDates.hijri.year;
        hm = timeIrDates.hijri.month;
        hd = timeIrDates.hijri.day;
        usedTimeIr = true;
      } else {
        error = `دریافت موفق بود (HTTP 200، حجم صفحه ${html.length} بایت) ولی الگوی «تاریخ خورشیدی» توی HTML پیدا نشد`;
      }
      const zodiacFa = extractTimeIrZodiac(html);
      if (zodiacFa) {
        zodiacPreviousEnglish = getPreviousZodiacEnglishName(zodiacFa);
      }
    } else {
      error = `HTTP ${response.status} ${response.statusText || ''}`.trim();
    }
  } catch (error_) {
    const isTimeout = error_ && error_.name === 'AbortError';
    error = isTimeout ? 'تایم‌اوت پس از 20 ثانیه (سایت جواب نداد)' : `خطای شبکه: ${error_ && error_.message}`;
  }

  if (!usedTimeIr) {
    await alertAdmin(
      env,
      `ℹ️ نتونستم تاریخ رو از time.ir بگیرم (${error || 'دلیل نامشخص'})؛ از محاسبه‌ی محلی (که ممکنه با تاریخ قمریِ رسمی ۱ روز فرق داشته باشه) استفاده شد.`
    );
    [jy, jm, jd] = gregorianToJalali(gy, gm, gd);
    [hy, hm, hd] = gregorianToHijri(gy, gm, gd);
  }

  const persianMonthName = PERSIAN_MONTHS[jm - 1];
  const hijriMonthName = HIJRI_MONTHS[hm - 1];
  const gregorianMonthName = GREGORIAN_MONTHS[gm - 1];

  // مناسبت‌های امروز، مستقل از موفقیت/شکست time.ir، از گیت‌هاب گرفته می‌شن
  const githubResult = await fetchTodayEventsFromGithub(jd, persianMonthName, hd, hijriMonthName, gd, gregorianMonthName);
  if (githubResult.error) {
    await alertAdmin(env, `🔴 خطا در دریافت مناسبت‌های روزانه از گیت‌هاب:\n${githubResult.error}`);
  }
  todayEvents = githubResult.events;

  const dates = {
    shamsi: { day: jd, month: jm, year: jy, monthName: persianMonthName },
    hijri: { day: hd, month: hm, year: hy, monthName: hijriMonthName },
    gregorian: { day: gd, month: gm, year: gy, monthName: gregorianMonthName },
  };

  return { dates, todayEvents, error, zodiacPreviousEnglish };
}

// ─────────────────────────────────────────────
// آب‌وهوای تهران (از Open-Meteo، رایگان و بدون نیاز به کلید)
// ─────────────────────────────────────────────
const WEATHER_CODE_MAP = {
  0: { emoji: '☀️', text: 'آفتابی' },
  1: { emoji: '🌤️', text: 'کمی ابری' },
  2: { emoji: '⛅', text: 'نیمه‌ابری' },
  3: { emoji: '☁️', text: 'ابری' },
  45: { emoji: '🌫️', text: 'مه‌آلود' },
  48: { emoji: '🌫️', text: 'مه‌آلود (یخ‌زده)' },
  51: { emoji: '🌦️', text: 'نم‌نم باران سبک' },
  53: { emoji: '🌦️', text: 'نم‌نم باران' },
  55: { emoji: '🌦️', text: 'نم‌نم باران شدید' },
  56: { emoji: '🌧️', text: 'باران یخ‌زده سبک' },
  57: { emoji: '🌧️', text: 'باران یخ‌زده' },
  61: { emoji: '🌧️', text: 'باران سبک' },
  63: { emoji: '🌧️', text: 'باران' },
  65: { emoji: '🌧️', text: 'باران شدید' },
  66: { emoji: '🌧️', text: 'باران یخ‌زده سبک' },
  67: { emoji: '🌧️', text: 'باران یخ‌زده شدید' },
  71: { emoji: '❄️', text: 'برف سبک' },
  73: { emoji: '❄️', text: 'برف' },
  75: { emoji: '❄️', text: 'برف شدید' },
  77: { emoji: '❄️', text: 'دانه‌های برف' },
  80: { emoji: '🌦️', text: 'رگبار سبک' },
  81: { emoji: '🌦️', text: 'رگبار' },
  82: { emoji: '⛈️', text: 'رگبار شدید' },
  85: { emoji: '🌨️', text: 'رگبار برف سبک' },
  86: { emoji: '🌨️', text: 'رگبار برف شدید' },
  95: { emoji: '⛈️', text: 'رعدوبرق' },
  96: { emoji: '⛈️', text: 'رعدوبرق با تگرگ سبک' },
  99: { emoji: '⛈️', text: 'رعدوبرق با تگرگ شدید' },
};

function describeWeatherCode(code) {
  return WEATHER_CODE_MAP[code] || { emoji: '🌡️', text: 'نامشخص' };
}

async function getTehranWeather() {
  try {
    const url =
      'https://api.open-meteo.com/v1/forecast?latitude=35.6892&longitude=51.389&current=temperature_2m,weather_code&timezone=Asia%2FTehran';
    const response = await fetchWithTimeout(url, {}, 15000);
    if (!response.ok) return null;
    const data = await response.json();
    const current = data && data.current;
    if (!current || typeof current.temperature_2m !== 'number') return null;
    const { emoji, text } = describeWeatherCode(current.weather_code);
       return { temperature: Math.round(current.temperature_2m), emoji, text, code: current.weather_code };
  } catch (error) {
    return null;
  }
}

// ─────────────────────────────────────────────
// قمر در عقرب (برج و صورت فلکی) — سال ۱۴۰۵ شمسی
// این جدول از تقویم نجومی گرفته شده و باید هرساله دستی آپدیت بشه
// (برای سال‌های بعد از ۱۴۰۵ اطلاعاتی نداریم و چیزی نمایش داده نمی‌شه)
// ─────────────────────────────────────────────
const SCORPIO_ZODIAC_PERIODS_1405 = [
  { start: { m: 1, d: 14 }, end: { m: 1, d: 17 } },
  { start: { m: 2, d: 10 }, end: { m: 2, d: 13 } },
  { start: { m: 3, d: 7 }, end: { m: 3, d: 9 } },
  { start: { m: 4, d: 3 }, end: { m: 4, d: 5 } },
  { start: { m: 4, d: 30 }, end: { m: 5, d: 2 } },
  { start: { m: 5, d: 27 }, end: { m: 5, d: 29 } },
  { start: { m: 6, d: 23 }, end: { m: 6, d: 25 } },
  { start: { m: 7, d: 19 }, end: { m: 7, d: 22 } },
  { start: { m: 8, d: 17 }, end: { m: 8, d: 19 } },
  { start: { m: 9, d: 14 }, end: { m: 9, d: 16 } },
  { start: { m: 10, d: 11 }, end: { m: 10, d: 13 } },
  { start: { m: 11, d: 8 }, end: { m: 11, d: 11 } },
  { start: { m: 12, d: 6 }, end: { m: 12, d: 8 } },
];

const SCORPIO_CONSTELLATION_PERIODS_1405 = [
  { start: { m: 1, d: 17 }, end: { m: 1, d: 19 } },
  { start: { m: 2, d: 13 }, end: { m: 2, d: 15 } },
  { start: { m: 3, d: 9 }, end: { m: 3, d: 11 } },
  { start: { m: 4, d: 6 }, end: { m: 4, d: 8 } },
  { start: { m: 5, d: 2 }, end: { m: 5, d: 4 } },
  { start: { m: 5, d: 29 }, end: { m: 5, d: 31 } },
  { start: { m: 6, d: 26 }, end: { m: 6, d: 28 } },
  { start: { m: 7, d: 22 }, end: { m: 7, d: 24 } },
  { start: { m: 8, d: 19 }, end: { m: 8, d: 21 } },
  { start: { m: 9, d: 17 }, end: { m: 9, d: 19 } },
  { start: { m: 10, d: 14 }, end: { m: 10, d: 16 } },
  { start: { m: 11, d: 11 }, end: { m: 11, d: 13 } },
  { start: { m: 12, d: 8 }, end: { m: 12, d: 10 } },
];

function isShamsiDateInRange(m, d, range) {
  // چون بازه‌ها همیشه در یک ماه یا بین دو ماه پشت‌سرهمن، مقایسه‌ی (ماه*100+روز) کافیه
  const value = m * 100 + d;
  const startValue = range.start.m * 100 + range.start.d;
  const endValue = range.end.m * 100 + range.end.d;
  return value >= startValue && value <= endValue;
}

function findScorpioMoonInfo(shamsiYear, shamsiMonth, shamsiDay) {
  if (shamsiYear !== 1405) return null; // فعلاً فقط برای سال ۱۴۰۵ داده داریم

  const zodiacRange = SCORPIO_ZODIAC_PERIODS_1405.find((r) => isShamsiDateInRange(shamsiMonth, shamsiDay, r));
  const constellationRange = SCORPIO_CONSTELLATION_PERIODS_1405.find((r) =>
    isShamsiDateInRange(shamsiMonth, shamsiDay, r)
  );

  if (!zodiacRange && !constellationRange) return null;

  const formatRange = (range) =>
    `${range.start.d} ${PERSIAN_MONTHS[range.start.m - 1]} ${shamsiYear} تا ${range.end.d} ${
      PERSIAN_MONTHS[range.end.m - 1]
    } ${shamsiYear}`;

  return {
    inZodiac: zodiacRange ? formatRange(zodiacRange) : null,
    inConstellation: constellationRange ? formatRange(constellationRange) : null,
  };
}

// ─────────────────────────────────────────────
// تنظیمات عمومی (غیر حساس)
// ─────────────────────────────────────────────
const TG_CHANNEL = -1002621107529; // NabzBazarPlus — با chat_id ثابت، دیگه با تغییر یوزرنیم خراب نمی‌شه
const ADMIN_CHAT_ID = '6715599428';
const SESSION_DURATION_SECONDS = 120; // 2 دقیقه
const SESSION_COOKIE_NAME = 'gheymat_session';
const FOOTER_USERNAME_KV_KEY = 'channel_footer_username';

// نکته: مقادیر زیر دیگه توی کد نیستن، بلکه از Cloudflare Secrets خونده می‌شن:
//   env.LOGIN_USERNAME   → نام کاربری ورود به صفحه
//   env.LOGIN_PASSWORD   → رمز عبور ورود به صفحه
//   env.SESSION_SECRET   → کلید امضای سشن (هر رشته‌ی دلخواه و پیچیده)
//   env.TG_BOT_TOKEN     → توکن ربات تلگرام

async function getFooterUsername(env) {
  try {
    if (!env.gheymat_link) return null;
    const value = await env.gheymat_link.get(FOOTER_USERNAME_KV_KEY);
    return value || null;
  } catch (error) {
    return null;
  }
}

async function setFooterUsername(env, value) {
  try {
    if (!env.gheymat_link) return false;
    await env.gheymat_link.put(FOOTER_USERNAME_KV_KEY, value);
    return true;
  } catch (error) {
    return false;
  }
}

// ─────────────────────────────────────────────
// توابع سشن و لاگین
// ─────────────────────────────────────────────
async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function makeSessionToken(env) {
  const expiresAt = Date.now() + SESSION_DURATION_SECONDS * 1000;
  const signature = await sha256Hex(`${expiresAt}:${env.SESSION_SECRET}`);
  return `${expiresAt}.${signature}`;
}

async function isValidSessionToken(token, env) {
  if (!token) return false;
  const [expiresAtStr, signature] = token.split('.');
  if (!expiresAtStr || !signature) return false;
  const expiresAt = parseInt(expiresAtStr, 10);
  if (isNaN(expiresAt) || Date.now() > expiresAt) return false;
  const expectedSignature = await sha256Hex(`${expiresAt}:${env.SESSION_SECRET}`);
  return signature === expectedSignature;
}

function getCookie(request, name) {
  const cookieHeader = request.headers.get('Cookie') || '';
  const match = cookieHeader.match(new RegExp(`${name}=([^;]+)`));
  return match ? match[1] : null;
}

function loginPageHtml(errorMessage) {
  return `<!DOCTYPE html>
<html dir="rtl" lang="fa">
<head>
  <meta charset="utf-8">
  <title>ورود</title>
  <style>
    body { font-family: sans-serif; background: #1a1a2e; color: #eee; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    form { background: #16213e; padding: 2rem; border-radius: 10px; width: 300px; }
    input { width: 100%; padding: 0.6rem; margin: 0.5rem 0; border-radius: 5px; border: none; box-sizing: border-box; }
    button { width: 100%; padding: 0.6rem; background: #0f3460; color: white; border: none; border-radius: 5px; cursor: pointer; margin-top: 0.5rem; }
    .error { color: #ff6b6b; margin-top: 0.5rem; }
  </style>
</head>
<body>
  <form method="POST">
    <h3>ورود</h3>
    <input type="text" name="username" placeholder="نام کاربری" required>
    <input type="password" name="password" placeholder="رمز عبور" required>
    <button type="submit">ورود</button>
    ${errorMessage ? `<div class="error">${errorMessage}</div>` : ''}
  </form>
</body>
</html>`;
}

// ─────────────────────────────────────────────
// توابع استخراج قیمت از هر سایت
// ─────────────────────────────────────────────
const COMMON_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept-Language': 'fa-IR,fa;q=0.9',
};

function extractTgjuPrice(html) {
  const match = html.match(/class="price" data-col="info\.last_trade\.PDrCotVal">([\d,\.]+)</);
  return match ? parseFloat(match[1].replace(/,/g, '')) : null;
}

function extractArzdigitalUsdPrice(html) {
  const match = html.match(/"price":([\d.]+),"priceIrt":([\d.]+)/);
  return match ? parseFloat(match[1]) : null; // قیمت دلاری
}

function extractFarazXauusdPrice(responseText) {
  try {
    const data = JSON.parse(responseText);
    const entry = data && data.FXCM_XAUUSD;
    return entry && typeof entry.price === 'number' ? entry.price : null;
  } catch (error) {
    return null;
  }
}

// سازنده‌ی تابع استخراج برای هر نماد دیگه‌ی faraz.io با همین ساختار پاسخ
function extractFarazPrice(symbolName) {
  return (responseText) => {
    try {
      const data = JSON.parse(responseText);
      const entry = data && data[symbolName];
      return entry && typeof entry.price === 'number' ? entry.price : null;
    } catch (error) {
      return null;
    }
  };
}

// ─────────────────────────────────────────────
// منابع هر قیمت، به ترتیب اولویت
// ─────────────────────────────────────────────
const SOURCES = {
  btc: [
    {
      name: 'tgju.org',
      url: 'https://www.tgju.org/profile/crypto-bitcoin',
      extract: extractTgjuPrice,
    },
    {
      name: 'arzdigital.com',
      url: 'https://arzdigital.com/coins/bitcoin/',
      extract: extractArzdigitalUsdPrice,
    },
  ],
  xau: [
    {
      name: 'faraz.io',
      url: 'https://faraz.io/api/public/market/get-data?symbolNames=%5B%22FXCM_XAUUSD%22%5D&cache=true',
      extract: extractFarazXauusdPrice,
    },
    {
      name: 'tgju.org',
      url: 'https://www.tgju.org/profile/ons',
      extract: extractTgjuPrice,
    },
  ],
  tetherToman: [
    {
      name: 'faraz.io',
      url: 'https://faraz.io/api/public/market/get-data?symbolNames=%5B%22USDTIRT%22%5D&cache=false',
      extract: extractFarazPrice('USDTIRT'),
    },
  ],
  derham: [
    {
      name: 'faraz.io',
      url: 'https://faraz.io/api/public/market/get-data?symbolNames=%5B%22derham%22%5D&cache=false',
      extract: extractFarazPrice('derham'),
    },
  ],
  brentOil: [
    {
      name: 'faraz.io',
      url: 'https://faraz.io/api/public/market/get-data?symbolNames=%5B%22BCO_USD%22%5D&cache=false',
      extract: extractFarazPrice('BCO_USD'),
    },
  ],
  coinNew: [
    {
      name: 'faraz.io',
      url: 'https://faraz.io/api/public/market/get-data?symbolNames=%5B%22sekkeNewEstjt%22%5D&cache=false',
      extract: extractFarazPrice('sekkeNewEstjt'),
    },
  ],
  halfCoin: [
    {
      name: 'faraz.io',
      url: 'https://faraz.io/api/public/market/get-data?symbolNames=%5B%22nimSekkeEstjt%22%5D&cache=false',
      extract: extractFarazPrice('nimSekkeEstjt'),
    },
  ],
  quarterCoin: [
    {
      name: 'faraz.io',
      url: 'https://faraz.io/api/public/market/get-data?symbolNames=%5B%22robSekkeEstjt%22%5D&cache=false',
      extract: extractFarazPrice('robSekkeEstjt'),
    },
  ],
  eur: [
    {
      name: 'tgju.org',
      url: 'https://www.tgju.org/profile/price_eur',
      extract: (html) => {
        const rial = extractTgjuPrice(html);
        return rial ? rial / 10 : null;
      },
    },
  ],
  ethUsd: [
    {
      name: 'faraz.io',
      url: 'https://faraz.io/api/public/market/get-data?symbolNames=%5B%22ETHUSD%22%5D&cache=false',
      extract: extractFarazPrice('ETHUSD'),
    },
  ],
  gold18Gram: [
    {
      name: 'faraz.io',
      url: 'https://faraz.io/api/public/market/get-data?symbolNames=%5B%22geramTalaHejdah%22%5D&cache=false',
      extract: extractFarazPrice('geramTalaHejdah'),
    },
  ],
  bnbTether: [
    {
      name: 'faraz.io',
      url: 'https://faraz.io/api/public/market/get-data?symbolNames=%5B%22BNBUSDT%22%5D&cache=false',
      extract: extractFarazPrice('BNBUSDT'),
    },
  ],
  silverGramWorld: [
    {
      name: 'faraz.io',
      url: 'https://faraz.io/api/public/market/get-data?symbolNames=%5B%22geramNoghreJahani%22%5D&cache=true',
      extract: extractFarazPrice('geramNoghreJahani'),
    },
  ],
  meltedGoldToman: [
    {
      name: 'faraz.io',
      url: 'https://faraz.io/api/public/market/get-data?symbolNames=%5B%22abshodeJahaniOtagh%22%5D&cache=true',
      extract: extractFarazPrice('abshodeJahaniOtagh'),
    },
  ],
  usdHarat: [
    {
      name: 'faraz.io',
      url: 'https://faraz.io/api/public/market/get-data?symbolNames=%5B%22haratFardayi%22%5D&cache=true',
      extract: extractFarazPrice('haratFardayi'),
    },
  ],
  bourseIndex: [
    {
      name: 'faraz.io',
      url: 'https://faraz.io/api/public/market/get-data?symbolNames=%5B%22x32097828799138957%22%5D&cache=true',
      extract: extractFarazPrice('x32097828799138957'),
    },
  ],
  fraBourseIndex: [
    {
      name: 'faraz.io',
      url: 'https://faraz.io/api/public/market/get-data?symbolNames=%5B%22x43685683301327984%22%5D&cache=true',
      extract: extractFarazPrice('x43685683301327984'),
    },
  ],
  hamvazneIndex: [
    {
      name: 'faraz.io',
      url: 'https://faraz.io/api/public/market/get-data?symbolNames=%5B%22x67130298613737946%22%5D&cache=true',
      extract: extractFarazPrice('x67130298613737946'),
    },
  ],
};

const TYPE_LABELS = {
  btc: 'BTC',
  xau: 'انس طلا',
  silverGramWorld: 'نقره جهانی',
  meltedGoldToman: 'طلای آب شده جهانی',
  usdHarat: 'دلار',
  tetherToman: 'تتر',
  derham: 'درهم امارات',
  brentOil: 'نفت برنت',
  coinNew: 'سکه تمام (طرح جدید)',
  halfCoin: 'نیم سکه',
  quarterCoin: 'ربع سکه',
  eur: 'یورو',
  ethUsd: 'ETH',
  gold18Gram: 'طلای ۱۸ عیار',
  bnbTether: 'BNB',
  bourseIndex: 'شاخص کل بورس',
  fraBourseIndex: 'شاخص کل فرابورس',
  hamvazneIndex: 'شاخص کل هم‌وزن',
};

// ─────────────────────────────────────────────
// توابع کمکی تلگرام
// ─────────────────────────────────────────────
async function sendTelegramMessage(env, chatId, text, parseMode) {
  const url = `https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendMessage`;
  try {
    const body = { chat_id: chatId, text };
    if (parseMode) body.parse_mode = parseMode;
    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, 10000);
    if (!response.ok) {
      console.error(`Failed to send Telegram message to ${chatId}:`, await response.text());
      return null;
    }
    const data = await response.json();
    return data && data.result ? data.result.message_id : null;
  } catch (error) {
    console.error(`Error sending Telegram message to ${chatId}:`, error && error.message);
    return null;
  }
}

async function unpinTelegramMessage(env, chatId, messageId) {
  if (!messageId) return;
  const url = `https://api.telegram.org/bot${env.TG_BOT_TOKEN}/unpinChatMessage`;
  try {
    await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, message_id: messageId }),
    }, 10000);
    // اگه پیام قبلاً پین نبوده یا از قبل آنپین شده، تلگرام خطا می‌ده که مهم نیست، نادیده می‌گیریم
  } catch (error) {
    console.error('Error unpinning previous message:', error && error.message);
  }
}

// فقط آخرین پیامی که خودِ ربات پین کرده رو جایگزین می‌کنه؛ اگه کاربر دستی چیزی پین کرده باشه دست‌نخورده می‌مونه
async function pinOnlyLatest(env, chatId, newMessageId) {
  if (!newMessageId) return;
  const PIN_KV_KEY = 'last_bot_pinned_message_id';

  try {
    if (env.gheymat_link) {
      const previousId = await env.gheymat_link.get(PIN_KV_KEY);
      if (previousId) {
        await unpinTelegramMessage(env, chatId, parseInt(previousId, 10));
      }
    }
  } catch (error) {
    console.error('Error reading previous pinned message id:', error && error.message);
  }

  await pinTelegramMessage(env, chatId, newMessageId);

  try {
    if (env.gheymat_link) {
      await env.gheymat_link.put(PIN_KV_KEY, newMessageId.toString());
    }
  } catch (error) {
    console.error('Error saving new pinned message id:', error && error.message);
  }
}

async function pinTelegramMessage(env, chatId, messageId) {
  if (!messageId) return;
  const url = `https://api.telegram.org/bot${env.TG_BOT_TOKEN}/pinChatMessage`;
  try {
    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        disable_notification: true,
      }),
    }, 10000);
    if (!response.ok) {
      const errText = await response.text();
      console.error('Failed to pin message:', errText);
      await alertAdmin(
        env,
        `⚠️ نتونستم پیام رو سنجاق کنم.\nمطمئن بشید ربات توی کانال دسترسی «Pin Messages» داره.\n\nجزئیات: ${errText}`
      );
    }
  } catch (error) {
    console.error('Error pinning message:', error && error.message);
  }
}

async function alertAdmin(env, message) {
  console.error('ADMIN ALERT:', message);
  await sendTelegramMessage(env, ADMIN_CHAT_ID, message);
}

// ─────────────────────────────────────────────
// fetch با سقف زمانی؛ اگه سایت مقصد کند/بی‌پاسخ باشه، به‌جای معطلی
// بی‌نهایت، بعد از timeoutMs میلی‌ثانیه با خطا شکست می‌خوره
// ─────────────────────────────────────────────
async function fetchWithTimeout(url, options, timeoutMs = 10000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

// ─────────────────────────────────────────────
// گرفتن یک مقدار با تلاش روی منابع پشتیبان به ترتیب
// ─────────────────────────────────────────────
async function fetchWithFallback(env, type) {
  const sourceList = SOURCES[type];
  const failedSources = [];
  const label = TYPE_LABELS[type];

  for (let i = 0; i < sourceList.length; i++) {
    const source = sourceList[i];
    try {
      const response = await fetchWithTimeout(source.url, { headers: COMMON_HEADERS }, 20000);
      if (!response.ok) {
        failedSources.push(`${source.name} (HTTP ${response.status})`);
        continue;
      }
      const html = await response.text();
      const value = source.extract(html);
      if (value === null || isNaN(value)) {
        failedSources.push(`${source.name} (الگو پیدا نشد - احتمالاً ساختار سایت عوض شده)`);
        continue;
      }

      if (i > 0) {
        await alertAdmin(
          env,
          `ℹ️ قیمت "${label}" این بار از منبع پشتیبان "${source.name}" دریافت شد،\nچون منبع اصلی (${failedSources.join(', ')}) جواب نداد.`
        );
      }

      return { value, sourceName: source.name };
    } catch (error) {
      const isTimeout = error && error.name === 'AbortError';
      failedSources.push(`${source.name} (${isTimeout ? 'تایم‌اوت پس از 20 ثانیه' : `خطا: ${error && error.message}`})`);
    }
  }

  await alertAdmin(
    env,
    `🔴 دریافت قیمت "${label}" از همه‌ی ${sourceList.length} منبع شکست خورد:\n${failedSources.join('\n')}`
  );
  return null;
}

async function getLastPriceFromKV(env, key) {
  try {
    if (!env.gheymat_link) {
      console.error(`KV binding missing when reading ${key}`);
      await alertAdmin(
        env,
        `🔴 KV binding "gheymat_link" در دسترس نیست (هنگام خواندن ${key}).\nبه همین دلیل فلش‌های روند (🟢🔴) کار نمی‌کنن.`
      );
      return null;
    }
    const lastPrice = await env.gheymat_link.get(key);
    console.log(`KV READ ${key}:`, lastPrice);
    return lastPrice ? parseFloat(lastPrice) : null;
  } catch (error) {
    console.error(`Error reading ${key} from KV:`, error && error.message);
    return null;
  }
}

async function savePriceToKV(env, key, price) {
  try {
    if (!env.gheymat_link) {
      console.error(`KV binding missing when saving ${key}`);
      return;
    }
    await env.gheymat_link.put(key, price.toString());
    console.log(`KV WRITE ${key}:`, price.toString());
  } catch (error) {
    console.error(`Error saving ${key} to KV:`, error && error.message);
  }
}

// ─────────────────────────────────────────────
// محاسبه‌ی قیمت‌ها (بدون ارسال به هیچ‌جا - فقط محاسبه)
// ─────────────────────────────────────────────
async function computePrices(env) {
  const btcResult = await fetchWithFallback(env, 'btc');
  const xauResult = await fetchWithFallback(env, 'xau');
  const silverResult = await fetchWithFallback(env, 'silverGramWorld');
  const meltedGoldResult = await fetchWithFallback(env, 'meltedGoldToman');
  const haratUsdResult = await fetchWithFallback(env, 'usdHarat');
  const tetherTomanResult = await fetchWithFallback(env, 'tetherToman');
  const derhamResult = await fetchWithFallback(env, 'derham');
  const brentOilResult = await fetchWithFallback(env, 'brentOil');
  const coinNewResult = await fetchWithFallback(env, 'coinNew');
  const halfCoinResult = await fetchWithFallback(env, 'halfCoin');
  const quarterCoinResult = await fetchWithFallback(env, 'quarterCoin');
  const eurResult = await fetchWithFallback(env, 'eur');
  const ethUsdResult = await fetchWithFallback(env, 'ethUsd');
  const gold18GramResult = await fetchWithFallback(env, 'gold18Gram');
  const bnbTetherResult = await fetchWithFallback(env, 'bnbTether');
  const bourseIndexResult = await fetchWithFallback(env, 'bourseIndex');
  const fraBourseIndexResult = await fetchWithFallback(env, 'fraBourseIndex');
  const hamvazneIndexResult = await fetchWithFallback(env, 'hamvazneIndex');

  const items = [
    { key: 'USDTIRT', value: haratUsdResult ? haratUsdResult.value : null, title: 'دلار', unit: 'تومان', icon: '🇺🇸' },
    { key: 'TETHERTOMAN', value: tetherTomanResult ? tetherTomanResult.value : null, title: 'تتر', unit: 'تومان', icon: '💵' },
    { key: 'DERHAM', value: derhamResult ? derhamResult.value : null, title: 'درهم امارات', unit: 'تومان', icon: '🇦🇪' },
    { key: 'EUR', value: eurResult ? eurResult.value : null, title: 'یورو', unit: 'تومان', icon: '🇪🇺' },
    { key: 'XAUUSD', value: xauResult ? xauResult.value : null, title: 'انس طلا', unit: 'دلار', icon: '💰' },
    { key: 'XAGGRAMUSD', value: silverResult ? silverResult.value : null, title: 'نقره جهانی', unit: 'دلار', icon: '💰' },
    { key: 'MELTEDGOLD', value: meltedGoldResult ? meltedGoldResult.value : null, title: 'طلای آب شده جهانی', unit: 'تومان', icon: '💫' },
    { key: 'GOLD18GRAM', value: gold18GramResult ? gold18GramResult.value : null, title: 'طلای ۱۸ عیار (هر گرم)', unit: 'تومان', icon: '💫' },
    { key: 'COINNEW', value: coinNewResult ? coinNewResult.value : null, title: 'سکه تمام (طرح جدید)', unit: 'تومان', icon: '🌕' },
    { key: 'HALFCOIN', value: halfCoinResult ? halfCoinResult.value : null, title: 'نیم سکه', unit: 'تومان', icon: '🌕' },
    { key: 'QUARTERCOIN', value: quarterCoinResult ? quarterCoinResult.value : null, title: 'ربع سکه', unit: 'تومان', icon: '🌕' },
    { key: 'BTCUSDT', value: btcResult ? btcResult.value : null, title: 'BTC', unit: 'دلار', icon: '💲', ltrLine: true },
    { key: 'ETHUSD', value: ethUsdResult ? ethUsdResult.value : null, title: 'ETH', unit: 'دلار', icon: '💲', ltrLine: true },
    { key: 'BNBUSDT', value: bnbTetherResult ? bnbTetherResult.value : null, title: 'BNB', unit: 'دلار', icon: '💲', ltrLine: true },
    { key: 'BRENTOIL', value: brentOilResult ? brentOilResult.value : null, title: 'نفت برنت', unit: 'دلار', icon: '🛢' },
    { key: 'BOURSEIDX', value: bourseIndexResult ? bourseIndexResult.value : null, title: 'شاخص کل بورس', unit: 'واحد', icon: '📊' },
    { key: 'FRABOURSEIDX', value: fraBourseIndexResult ? fraBourseIndexResult.value : null, title: 'شاخص کل فرابورس', unit: 'واحد', icon: '📊' },
    { key: 'HAMVAZNEIDX', value: hamvazneIndexResult ? hamvazneIndexResult.value : null, title: 'شاخص کل هم‌وزن', unit: 'واحد', icon: '📊' },
  ];

  return items;
}

// ─────────────────────────────────────────────
// چیدمانِ بخش قیمت‌ها: هر بلوک یه گروهه، با یه سربرگ اختیاری.
// اگه کلیدی این‌بار قیمتش در دسترس نبود، کلاً از پیام حذف می‌شه (بدون جای خالی).
// ─────────────────────────────────────────────
const MESSAGE_LAYOUT = [
  { header: '🔹بازار ارز', keys: ['USDTIRT', 'TETHERTOMAN', 'EUR', 'DERHAM', 'BRENTOIL'] },
  { header: '🔹بازار طلا', keys: ['XAUUSD', 'XAGGRAMUSD', 'MELTEDGOLD', 'GOLD18GRAM', 'COINNEW', 'HALFCOIN', 'QUARTERCOIN'] },
  { header: '🔹بازار رمز ارز', keys: ['BTCUSDT', 'ETHUSD', 'BNBUSDT'] },
  { header: '🔹بازار بورس', keys: ['BOURSEIDX', 'FRABOURSEIDX', 'HAMVAZNEIDX'] },
];

function buildPriceMessage(itemDataByKey) {
  const blockTexts = [];

  for (const block of MESSAGE_LAYOUT) {
    const lines = [];
    for (const key of block.keys) {
      const item = itemDataByKey[key];
      if (!item) continue;
      const formattedNumber = new Intl.NumberFormat('en-US').format(item.value);
      const content = `${item.title}: ${formattedNumber} ${item.unit}`;
      const lineText = `${item.trend}${item.icon} ${content}`;
      // برای عنوان‌های لاتین (BTC, ETH, BNB) کل خط رو چپ‌چین می‌کنیم (نه فقط ترتیب داخلیش)
      lines.push(item.ltrLine ? `\u200E${lineText}` : lineText);
    }

    if (lines.length === 0) continue;

    const blockText = block.header ? `${block.header}\n${lines.join('\n')}` : lines.join('\n');
    blockTexts.push(blockText);
  }

  return blockTexts.join('\n\n🔸🔸🔸🔸\n');
}

// ─────────────────────────────────────────────
// ساخت متن کامل پیام ترکیبی: تاریخ+ساعت، آب‌وهوا، مناسبت‌ها، قیمت‌ها،
// قمر در عقرب، و فوتر یوزرنیم کانال — همه در یک پیام
// ─────────────────────────────────────────────
// یه خط که با ایموجی/آیکون شروع بشه، جهت مشخصی نداره و تلگرام ممکنه
// چپ‌چینش کنه. اضافه‌کردن RLM (U+200F) به اول هر خطِ غیرخالی، همه‌چی رو
// راست‌به‌چپ نگه می‌داره.
function applyRtlMarks(text) {
  return text
    .split('\n')
    .map((line) => {
      if (line.length === 0) return line;
      if (/^🔸+$/.test(line)) return line; // خط جداکننده‌ی خالص؛ بدون علامت نامرئی
      if (line.startsWith('\u200F') || line.startsWith('\u200E')) return line;
      return '\u200F' + line;
    })
    .join('\n');
}

// ─────────────────────────────────────────────
// اول و آخر ماه قمری فعلی (بر پایه‌ی همون الگوریتم محاسباتی جدول‌بندی‌شده،
// چون time.ir فقط تاریخ «امروز» رو می‌ده، نه مرزهای ماه رو)
// ─────────────────────────────────────────────
function getHijriMonthBoundaries(gy, gm, gd, currentHijriDay) {
  const todayUtc = new Date(Date.UTC(gy, gm - 1, gd));

  const startDate = new Date(todayUtc);
  startDate.setUTCDate(startDate.getUTCDate() - (currentHijriDay - 1));

  const [targetHy, targetHm] = gregorianToHijri(gy, gm, gd);

  let endDate = new Date(todayUtc);
  while (true) {
    const nextDate = new Date(endDate);
    nextDate.setUTCDate(nextDate.getUTCDate() + 1);
    const [nhy, nhm] = gregorianToHijri(nextDate.getUTCFullYear(), nextDate.getUTCMonth() + 1, nextDate.getUTCDate());
    if (nhy !== targetHy || nhm !== targetHm) break;
    endDate = nextDate;
  }

  return { startDate, endDate };
}

function formatShamsiFromGregorianDate(dateObj) {
  const [jy, jm, jd] = gregorianToJalali(dateObj.getUTCFullYear(), dateObj.getUTCMonth() + 1, dateObj.getUTCDate());
  return `${jd} ${PERSIAN_MONTHS[jm - 1]}`;
}

async function buildCombinedMessage(env) {
  const { dates, todayEvents, zodiacPreviousEnglish } = await getTodayOccasions(env);

  const weekDays = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه'];
  const tehranNow = getTehranNow();
  const weekDayName = weekDays[tehranNow.getUTCDay()];
  const hour24 = tehranNow.getUTCHours();
  const minute = tehranNow.getUTCMinutes();
  const clockEmoji = getClockEmoji(hour24, minute);
  const timeStr = `${hour24.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;

  const lines = [];
  lines.push('✍️ قیمت بروز و لحظه ای👇');
  lines.push('.');
  lines.push(
    `📅<b>${weekDayName}، ${dates.shamsi.day} ${dates.shamsi.monthName} ${dates.shamsi.year}</b> ${clockEmoji} ${timeStr}`
  );
  lines.push(`🌙${dates.hijri.day} ${dates.hijri.monthName} ${dates.hijri.year} هجری قمری`);
  lines.push(`\u200F🌍${dates.gregorian.day} ${dates.gregorian.monthName} ${dates.gregorian.year} میلادی\u200F`);

  const weather = await getTehranWeather();
  if (weather) {
    lines.push('');
    lines.push(`${weather.emoji} آب‌وهوای تهران: ${weather.temperature}° ${weather.text}`);
  }

  if (todayEvents && todayEvents.length > 0) {
    lines.push('');
    lines.push('📌 <b>مناسبت‌های امروز</b>');
    todayEvents.forEach((name) => lines.push(`▫️ ${name}`));
  }

  // قیمت‌ها
  const items = await computePrices(env);
  const itemDataByKey = {};
  for (const { key, value, title, unit, icon, ltrLine } of items) {
    if (value === null) continue;

    const lastPrice = await getLastPriceFromKV(env, key);
    let trend = '';
    if (lastPrice !== null) {
      trend = value > lastPrice ? '🟢' : value < lastPrice ? '🔴' : '⚪️';
    }

    await savePriceToKV(env, key, value);

    itemDataByKey[key] = { title, unit, value, trend, icon, ltrLine };
  }
  const priceText = buildPriceMessage(itemDataByKey);
  if (priceText) {
    lines.push('');
    lines.push('🔸🔸🔸🔸');
    lines.push(priceText);
  }

  // ⭐️ صورت فلکی: همیشه همه‌ی ۵ خط نشون داده می‌شه، فقط اونی که صدق نکنه جلوش خالی می‌مونه
  const moonInfo = findScorpioMoonInfo(dates.shamsi.year, dates.shamsi.month, dates.shamsi.day);
  const isFullMoonNight = dates.hijri.day === 14;
  const { endDate: hijriMonthEnd } = getHijriMonthBoundaries(
    dates.gregorian.year,
    dates.gregorian.month,
    dates.gregorian.day,
    dates.hijri.day
  );
  const isFirstDayOfHijriMonth = dates.hijri.day === 1;
  const todayUtcDateForHijri = new Date(Date.UTC(dates.gregorian.year, dates.gregorian.month - 1, dates.gregorian.day));
  const isLastDayOfHijriMonth = hijriMonthEnd.getTime() === todayUtcDateForHijri.getTime();

  let monthEdgeValue = '';
  if (isFirstDayOfHijriMonth) {
    monthEdgeValue = 'اول ماه قمری';
  } else if (isLastDayOfHijriMonth) {
    monthEdgeValue = 'آخر ماه قمری';
  }

  lines.push('');
  lines.push('🔸🔸🔸🔸');
  lines.push(`⭐️صورت فلکی: ${zodiacPreviousEnglish ? `برج ${zodiacPreviousEnglish}` : ''}`);
  lines.push(`🌑♏️قمر در صورت فلکی عقرب: ${moonInfo && moonInfo.inConstellation ? moonInfo.inConstellation : ''}`);
  lines.push(`🌑♏️قمر در برج عقرب: ${moonInfo && moonInfo.inZodiac ? moonInfo.inZodiac : ''}`);
  lines.push(`🌙 اول یا آخر ماه قمری: ${monthEdgeValue}`);
  lines.push(`🌝ماه شب 14: ${isFullMoonNight ? 'ماه شب 14' : ''}`);

  // فوتر: یوزرنیم کانال (از تنظیمات پنل)
  const footerUsername = await getFooterUsername(env);
  if (footerUsername) {
    lines.push('');
    lines.push(`\u200E🆔 ${footerUsername}`);
  }

  lines.push('.');

  return applyRtlMarks(lines.join('\n'));
}

// ─────────────────────────────────────────────
// اجرای واقعی: ساخت پیام ترکیبی + ذخیره روند در KV + ارسال به کانال + پین
// (این تابع رو هم کرون هر ۳۰ دقیقه صدا می‌زنه، هم دکمه‌های تست پنل)
// ─────────────────────────────────────────────
async function sendCombinedMessage(env, options = {}) {
  const { pin = false } = options;
  const messageText = await buildCombinedMessage(env);
  const messageId = await sendTelegramMessage(env, TG_CHANNEL, messageText, 'HTML');

  if (pin) {
    await pinOnlyLatest(env, TG_CHANNEL, messageId);
  }

  return new Response(
    messageId
      ? pin
        ? 'پیام ترکیبی ارسال و پین شد.'
        : 'پیام ترکیبی ارسال شد (حالت تست — پین نشد).'
      : 'ارسال پیام به کانال شکست خورد. ادمین مطلع شد.'
  );
}

// ─────────────────────────────────────────────
// صفحه‌ی نمایش وضعیت برای بازدید دستی از پنل (چیزی به کانال ارسال نمی‌شه)
// ─────────────────────────────────────────────
async function handleStatusView(env) {
  const items = await computePrices(env);
  const currentFooterUsername = (await getFooterUsername(env)) || '';

  const rows = items
    .map(({ key, value, title, unit }) => {
      const display = value === null ? '❌ دریافت نشد' : `${new Intl.NumberFormat('en-US').format(value)} ${unit}`;
      return `<tr><td>${title} (${key})</td><td>${display}</td></tr>`;
    })
    .join('');

  const html = `<!DOCTYPE html>
<html dir="rtl" lang="fa">
<head>
  <meta charset="utf-8">
  <title>وضعیت ربات قیمت</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: sans-serif; background: #1a1a2e; color: #eee; padding: 2rem; }
    .topbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
    table { border-collapse: collapse; width: 100%; max-width: 500px; }
    td { padding: 0.6rem; border-bottom: 1px solid #333; }
    h3 { margin: 0; }
    p { color: #aaa; }
    .btn-row { display: flex; gap: 0.8rem; margin-top: 1.5rem; flex-wrap: wrap; }
    .test-btn, .logout-btn, .save-btn {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.7rem 1.5rem;
      color: white;
      text-decoration: none;
      border-radius: 8px;
      font-weight: bold;
      border: none;
      cursor: pointer;
      font-size: 0.95rem;
      transition: transform 0.15s ease, box-shadow 0.15s ease;
    }
    .test-btn { background: linear-gradient(135deg, #e94560, #c73650); }
    .test-btn:hover { transform: translateY(-2px); box-shadow: 0 4px 14px rgba(233,69,96,0.4); }
    .logout-btn { background: linear-gradient(135deg, #ff3b3b, #a80000); }
    .logout-btn:hover { transform: translateY(-2px); box-shadow: 0 4px 14px rgba(255,59,59,0.5); }
    .save-btn { background: linear-gradient(135deg, #2ecc71, #27ae60); }
    .save-btn:hover { transform: translateY(-2px); box-shadow: 0 4px 14px rgba(46,204,113,0.4); }
    .test-btn, .save-btn { border: none; cursor: pointer; font-family: inherit; }

    .settings-box { background: #16213e; border-radius: 10px; padding: 1.2rem; margin-top: 1.5rem; max-width: 500px; }
    .settings-box label { display: block; margin-bottom: 0.5rem; color: #aaa; }
    .settings-row { display: flex; gap: 0.6rem; }
    .settings-row input {
      flex: 1;
      padding: 0.6rem;
      border-radius: 6px;
      border: 1px solid #333;
      background: #1a1a2e;
      color: #eee;
      font-family: inherit;
      direction: ltr;
      text-align: left;
    }

    #popup-container { position: fixed; top: 1.5rem; left: 50%; transform: translateX(-50%); z-index: 1000; }
    .popup-toast {
      position: relative;
      background: #16213e;
      border: 1px solid #2a5f9e;
      border-radius: 10px;
      padding: 1rem 2.5rem 1rem 1.2rem;
      max-width: 420px;
      box-shadow: 0 6px 24px rgba(0,0,0,0.5);
      animation: popup-in 0.2s ease;
    }
    .popup-toast.popup-error { border-color: #ff3b3b; }
    .popup-text { white-space: pre-wrap; word-break: break-word; font-size: 0.9rem; }
    .popup-close {
      position: absolute;
      top: 0.5rem;
      left: 0.7rem;
      cursor: pointer;
      color: #aaa;
      font-size: 1rem;
    }
    .popup-close:hover { color: #fff; }
    @keyframes popup-in { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: translateY(0); } }
  </style>
</head>
<body>
  <div class="topbar">
    <h3>وضعیت فعلی منابع قیمت</h3>
    <a class="logout-btn" href="?logout=1">🚪 خروج</a>
  </div>
  <p>این صفحه فقط برای بررسی وضعیته. ارسالِ خودکارِ هر ۳۰ دقیقه هیچ‌وقت پیام رو پین نمی‌کنه؛ پین‌کردن فقط از طریق دکمه‌ی «📌 ارسال به کانال و پین کردن» زیر همین صفحه انجام می‌شه.</p>
  <p>⏱ سشن شما بعد از ۲ دقیقه بی‌فعالیتی خودکار منقضی می‌شه.</p>
  <table>${rows}</table>

  <div class="settings-box">
    <label for="footerUsernameInput">یوزرنیم کانال (پایین پیام نمایش داده می‌شه، مثلاً @NabzBazarPlus)</label>
    <div class="settings-row">
      <input type="text" id="footerUsernameInput" value="${currentFooterUsername.replace(/"/g, '&quot;')}" placeholder="@یوزرنیم_کانال">
      <button class="save-btn" onclick="saveFooterUsername()">💾 ذخیره</button>
    </div>
  </div>

  <div class="btn-row">
    <button class="test-btn" onclick="runTest('send')">📌 ارسال به کانال و پین کردن (فقط با این دکمه پین می‌شه)</button>
    <button class="test-btn" style="background: linear-gradient(135deg, #4a90d9, #2a5f9e);" onclick="runTest('preview')">🚀 ارسال بدون پین (دقیقاً کاری که هر ۳۰ دقیقه خودکار انجام می‌شه)</button>
  </div>

  <div id="popup-container"></div>

  <script>
    function runTest(type) {
      if (!confirm('این یه پیام واقعی به کانال می‌فرسته. مطمئنید؟')) return;
      showPopup('در حال ارسال...', false);
      fetch('?' + type + '=1')
        .then((res) => {
          if (res.status === 401) {
            throw new Error('SESSION_EXPIRED');
          }
          return res.text();
        })
        .then((text) => showPopup(text, false))
        .catch((err) => {
          if (err && err.message === 'SESSION_EXPIRED') {
            showPopup('⏱ سشن شما منقضی شده. لطفاً صفحه رو رفرش کن، دوباره وارد شو و سریع‌تر (کمتر از ۲ دقیقه) دکمه رو بزن.', true);
          } else {
            showPopup('خطا: ' + err, true);
          }
        });
    }

    function saveFooterUsername() {
      const value = document.getElementById('footerUsernameInput').value.trim();
      showPopup('در حال ذخیره...', false);
      fetch('?saveFooter=1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: value }),
      })
        .then((res) => {
          if (res.status === 401) {
            throw new Error('SESSION_EXPIRED');
          }
          return res.text();
        })
        .then((text) => showPopup(text, false))
        .catch((err) => {
          if (err && err.message === 'SESSION_EXPIRED') {
            showPopup('⏱ سشن شما منقضی شده. لطفاً صفحه رو رفرش کن و دوباره وارد شو.', true);
          } else {
            showPopup('خطا: ' + err, true);
          }
        });
    }

    function showPopup(message, isError) {
      const container = document.getElementById('popup-container');
      container.innerHTML = '';
      const popup = document.createElement('div');
      popup.className = 'popup-toast' + (isError ? ' popup-error' : '');
      popup.innerHTML =
        '<span class="popup-close" onclick="this.parentElement.remove()">✕</span>' +
        '<div class="popup-text"></div>';
      popup.querySelector('.popup-text').textContent = message;
      container.appendChild(popup);
      setTimeout(() => {
        if (popup.parentElement) popup.remove();
      }, 10000);
    }
  </script>
</body>
</html>`;


  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}


async function handleDataRequest(env) {
  const { dates, todayEvents, zodiacPreviousEnglish } = await getTodayOccasions(env);

  const weekDays = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه'];
  const tehranNow = getTehranNow();
  const time = `${String(tehranNow.getUTCHours()).padStart(2, '0')}:${String(tehranNow.getUTCMinutes()).padStart(2, '0')}`;

  const weather = await getTehranWeather();

  // قیمت‌ها + روند (نسبت به آخرین اجرا؛ همون منطق KV قبلی)
  const items = {};
  for (const { key, value } of await computePrices(env)) {
    if (value === null) continue;
    const last = await getLastPriceFromKV(env, key);
    const trend = last === null ? 'flat' : value > last ? 'up' : value < last ? 'down' : 'flat';
    if (last !== value) await savePriceToKV(env, key, value); // نوشتن بی‌مورد توی KV رو کم می‌کنه
    items[key] = { value, trend };
  }

  // قمر در عقرب، اول/آخر ماه قمری، شب ۱۴
  const moon = findScorpioMoonInfo(dates.shamsi.year, dates.shamsi.month, dates.shamsi.day);
  const { endDate: hijriMonthEnd } = getHijriMonthBoundaries(
    dates.gregorian.year,
    dates.gregorian.month,
    dates.gregorian.day,
    dates.hijri.day
  );
  const todayUtc = new Date(Date.UTC(dates.gregorian.year, dates.gregorian.month - 1, dates.gregorian.day));
  let monthEdge = '';
  if (dates.hijri.day === 1) monthEdge = 'اول ماه قمری';
  else if (hijriMonthEnd.getTime() === todayUtc.getTime()) monthEdge = 'آخر ماه قمری';

  const body = {
    weekDay: weekDays[tehranNow.getUTCDay()],
    time,
    dates,
    weather,
    events: todayEvents || [],
    zodiac: zodiacPreviousEnglish || null,
    moon: moon || { inConstellation: null, inZodiac: null },
    monthEdge,
    isFullMoonNight: dates.hijri.day === 14,
    items,
  };

  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

// ── برای اضافه‌کردن پوند، WTI، گاز طبیعی و نقره ۹۲۵ بعداً ──
// ۱) توی SOURCES یه منبع با همون ساختار بقیه اضافه کن (مثلاً gbp, wti, naturalGas, silver925)
// ۲) توی computePrices یه خط fetchWithFallback بذار و یه آیتم با key این‌ها به لیست items اضافه کن:
//      GBP، WTI، GAS، SILVER925
// عکس خودش جای اون ردیف‌ها رو پر می‌کنه؛ تا وقتی نباشن «—» نشون داده می‌شه.
