# ربات عکس قیمت‌ها (NabzBazarPlus)

هر ۳۰ دقیقه GitHub Actions این کارها رو انجام می‌ده:
1. داده‌ها (قیمت‌ها، تاریخ، آب‌وهوا، مناسبت‌ها، صورت فلکی) رو از ورکر Cloudflare می‌گیره
2. روی قالب `assets/template.png` (همون طرح خودت، بدون متن) مقدارها رو می‌نویسه
3. عکس رو با `sendPhoto` توی کانال می‌فرسته

## راه‌اندازی

### ۱) ورکر Cloudflare
فایل `worker/data-endpoint.js` رو باز کن و سه تغییر داخلش رو توی ورکر انجام بده. بعد:
- Settings → Variables and Secrets → یه Secret به اسم `DATA_API_KEY` بساز (یه رشته‌ی طولانی و تصادفی)
- Cron Trigger ورکر رو خاموش کن تا پیام متنی تکراری نره

### ۲) ریپوی گیت‌هاب
همه‌ی فایل‌های این پوشه رو توی ریپو بریز. بعد Settings → Secrets and variables → Actions:

| Secret | مقدار |
|---|---|
| `DATA_URL` | آدرس ورکر، مثلاً `https://xxxx.workers.dev/` |
| `DATA_KEY` | همون مقدار `DATA_API_KEY` |
| `TG_BOT_TOKEN` | توکن ربات |
| `TG_CHAT_ID` | `-1002621107529` |
| `ADMIN_CHAT_ID` | (اختیاری) آی‌دی ادمین برای گزارش خطا |

توکن رو هیچ‌وقت توی کد ننویس؛ ریپو عمومیه.

### ۳) تست
تب Actions ← `price-image` ← Run workflow. اگه موفق بود عکس توی کانال میاد.

## تست محلی (بدون ارسال)
```
npm install
node src/main.mjs --sample     # خروجی: out/preview.jpg
```

## اضافه‌کردن ردیف‌های خالی
پوند، WTI، گاز طبیعی و نقره ۹۲۵ تا وقتی ورکر کلیدهای `GBP`، `WTI`، `GAS`، `SILVER925` رو برنگردونه «—» نشون داده می‌شن.

## تغییر طرح
اگه عکس مرجع (`assets/reference.png`) عوض شد: `python3 scripts/build_template.py` رو اجرا کن و مختصات ردیف‌ها رو توی `scripts/build_template.py` و `src/render.mjs` تنظیم کن.

## نکته‌ها
- زمان‌بندی گیت‌هاب ممکنه چند دقیقه دیر یا گاهی جا بندازه؛ دقیقاً ثانیه‌ای نیست.
- توی ریپوی عمومی اگه ۶۰ روز هیچ فعالیتی نباشه، گیت‌هاب زمان‌بندی رو خودکار خاموش می‌کنه. از تب Actions دوباره روشنش کن.
