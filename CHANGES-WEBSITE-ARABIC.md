# Arabic Pack — the public website now speaks Arabic

> Owner request: *"Add some Arabic to the public website."*
> Date: 2026-09-09

The site already had a few Arabic accents (hero name, footer name, one
timetable link). This pack carries Arabic through the WHOLE public page -
always as a graceful second line under the English, in the manuscript
**Amiri** face and the site's gold/jade palette. Nothing functional was
touched: same ids, same form fields, same `js/website.js` behaviour.

## What was added

| Where | Arabic |
|---|---|
| Sticky header brand | مدرسة أمين اللّه للعلوم العربيّة الإسلاميّة under the school name (hidden on phones with the English sub-line, keeping the compact header) |
| Hero, above the title | بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ (the Basmalah opens the page, as on the school letterhead) |
| About | أهلاً وسهلاً بكم في مدرستنا (beside the existing Basmalah flair) |
| Why Parents Choose Us | لماذا يختارنا الأولياء؟ |
| Programs | برامجنا التعليمية - and every stage card now carries its Arabic stage name: التحضيري · الابتدائي · الإعدادي · الثانوي · تحفيظ القرآن الكريم |
| Notice Board | لوحة الإعلانات |
| Honour Roll | نجومنا المتألقون |
| Admission steps | خطوات التسجيل - and each step: أرسل الاستفسار · نتواصل معك · تُفعَّل البوابة |
| Portal Login | بوابة الدخول - and each role: الإدارة · المُعلِّم · الطالب · وليُّ الأمر |
| Admission panel | سجِّل طفلك اليوم + أو تفضّل بالاتصال بنا مباشرة in the contact card |
| Footer | شعارنا: العلمُ والعبادة (the motto closes the page) |

Every Arabic element carries `lang="ar" dir="rtl"`. The nav link
الجدول الدراسي from the earlier pack is untouched.

## Files

| File | Change |
|---|---|
| `index.html` | The Arabic lines above - additive only. |
| `css/website.css` | One new namespaced block (`.wb2-ar`, `.wb2-hero-bismillah`, `.wb2-ar-sub`, `.wb2-prog-ar`, `.wb2-step-ar`, `.wb2-role-ar`, `.wb2-contact-ar`, `.wb2-foot-motto`) + `object-fit:contain` on the header/hero/footer crests. |

## Logo fix (same pack)

The crest is **776 × 802** (not square). The header (46×46), hero (104×104)
and footer (64×64) boxes were squashing it by ~3%. All three now use
`object-fit:contain`, so the seal is always shown whole and round.
