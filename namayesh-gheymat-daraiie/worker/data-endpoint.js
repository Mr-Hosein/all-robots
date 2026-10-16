// ─────────────────────────────────────────────────────────────────────────────
// پچ ورکر: اضافه‌کردن خروجی JSON برای ساخت عکس توسط GitHub Actions
//
// سه تغییر کوچک توی worker فعلی لازمه (بقیه‌ی کد دست‌نخورده می‌مونه):
//
// ۱) توی fetch(request, env, ctx)، درست بعد از بلوکِ favicon و قبل از «خروج از سشن»، این رو بذار:
//
//      if (url.searchParams.get('data') === '1') {
//        if (!env.DATA_API_KEY || request.headers.get('X-Api-Key') !== env.DATA_API_KEY) {
//          return new Response('forbidden', { status: 403 });
//        }
//        return await handleDataRequest(env);
//      }
//
// ۲) توی تابع getTehranWeather، خطِ return رو این‌طوری کن (فقط code اضافه شده):
//
//      return { temperature: Math.round(current.temperature_2m), emoji, text, code: current.weather_code };
//
// ۳) تابع زیر رو ته فایل worker اضافه کن.
//
// بعدش توی داشبورد Cloudflare → Worker → Settings → Variables and Secrets،
// یه Secret با اسم DATA_API_KEY بساز (یه رشته‌ی طولانی و تصادفی؛ همون رو توی GitHub Secrets هم می‌ذاری).
//
// و برای اینکه پیام متنی تکراری نره، Cron Trigger ورکر رو حذف یا خاموش کن.
// ─────────────────────────────────────────────────────────────────────────────

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
