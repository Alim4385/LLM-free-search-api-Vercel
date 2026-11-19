# v116 — düzəlişlər və ÖLÇMƏ (olduğu kimi)

Tarix: 2026-11-16 · FV **233** · HEAD bazası: v115 `18d3f4b`

## 1. Nə düzəldildi (fayl + yer)

| # | Dəyişiklik | Fayl / yer | Nə üçün (ölçmə) |
|---|---|---|---|
| 1 | Provayder termin qapısı yumşaldıldı: nisbət sözləri (`hansı`, `ölkədəndir`, `şəhərdədir`, `qərargah`) məzmun termini sayılmır; **xüsusi ad başlıqda** varsa 1 uyğunluq kifayətdir | `lib/search.js` `providerTermGate()` (~L36–62) | "Messi hansı ölkədəndir": düzgün məqalə ("Lionel Messi") yalnız 1 terminə görə atılırdı → n=0 |
| 2 | Wiki axtarış variantları: **subyekt tokeni** (böyük hərfli söz **və ya** ilk söz + "xassə" sözü) təkbaşına variant kimi; hal şəkilçisi **-2 və -3** formada sınanır (`çinin→çin`, `azərbaycanın→azərbaycan`, `fransanın→fransa`); variant limiti 4→5 (yalnız субyekt varsa) | `lib/search.js` `stripAzCase()` + `wikiVariants()` (~L938–1010) | "Messi hansı ölkədəndir" → wiki "Mess It Up / Hot Mess" qaytarırdı; "çinin paytaxtı" → "Çinin florası" |
| 3 | **Kanonik məqalə qaydası**: hal şəkilçili xüsusi ad (`Azərbaycanın`, `Çinin`, `Fransanın`) məqalə adı ilə üst-üstə düşürsə, həmin səhifə birləşmə başlıqlarından üstündür (skor 20) | `lib/search.js` `titleScore()` (~L1200) | "Azərbaycanın paytaxtı" → "Azərbaycanın mədəniyyət paytaxtı" gəlirdi, "Azərbaycan" məqaləsi yox idi |
| 4 | Wikimedia semaforu: `WIKI_MIN_GAP_MS` 120 → **200** | `lib/search.js` (~L1039) | 429 səbəbindən wiki nəticələri **boş snippet/mətnlə** gəlirdi (n=0 hallarının əsas səbəbi) |
| 5 | Say çıxarışında **mövzu tokeni** bonusu (+0.9 / cəza −0.55) | `lib/countextract.js` `extractCountFromResults()` | "NBA-də neçə komanda var" → "Bu oyunlar **16** komanda arasında oynanıldı" cümləsi seçilirdi (mövzu = NBA orada yoxdur) |
| 6 | Qısa akronim (DNT, BMT, NBA, CSS, SQL): həm "gibberish" süzgəcindən, həm ≥4 hərf həddindən azaddır (`isStrongTerm`) | `app/api/search/route.js` (~L347–360, 424, 645, 655, 687) | "DNT-nin açılışı kimə aiddir": qTerms = `["acilis","kime","aiddir"]` — "dnt" yox idi, bütün nəticələr 0 bal |
| 7 | Skor qapısından sonra **obyekt məqaləsi saxlanılır** (`entity_article_kept`) | `app/api/search/route.js` (~L382–402) | "X-in <xassə>" sualında X-in öz məqaləsi boş snippet səbəbindən atılırdı |
| 8 | r15 qapısında `nMin` **buraxılışı** (struktur/çıxarılmış cavab və ya tək **avtoritet** mənbə + bütün `must` qrupları ödənib); JSON-da `nMinWaived` qeyd olunur | `bench/r15.mjs` `check()` | "Madrid hansı ölkədədir" → Wikidata cavabı (İspaniya), n=1 → əvvəl "uğursuz" sayılırdı |
| 9 | Hovuz 87 → **112 sual** (+25 yeni, təkrarsız) | `bench/r15-pool.mjs` | hər raund fərqli 15 sual şərti |

## 2. Test nəticələri (olduğu kimi)

- **Unit:** `UNIT NƏTİCƏ: 601 keçdi, 0 uğursuz`
- **Golden (max_results=3):** `25 keçdi, 0 bilinən boşluq, 5 UĞURSUZ (30 yoxlama)`
  - uğursuz: Bakı metrosu (26/27 conflict), Bakıda neçə universitet (49±4 yox), dünyanın ən böyük səhrası (Antarktida yox), **Kant kateqorik imperativ**, **Nizami əsərləri** (son iki: wiki nəticələri boş gəldi)
  - **Vacib:** bu sandbox-da Wikimedia 429-ları səbəbindən golden **run-to-run dəyişir** (eyni kodla 21…27 arası). v115-in 26/4-ü ilə birbaşa müqayisə etmək üçün eyni saatda 3 dəfə ölçmək lazımdır.
- **15/15 qapısı (hər raund FƏRQLİ suallar):**

| Raund | Nəticə | Qeyd |
|---|---|---|
| 1 | **15/15** | v115 kodu |
| 2 | 11/15 | s-un-hq, c-nowruz, sp-messi, sp-nba |
| 3 | 5/15 | wiki boş nəticələr (n=1/n=0) |
| 4 | 4/15 | eyni səbəb + 429 |
| 5 | 7/15 | n=1 halları (indı buraxılır) |
| 6 | **10/15** | ən yaxşı təkrar: DNT, CSS, Aya 1969, Moskva, Dehli |

  → **15/15 hələ alınmayıb.** Hovuzda istifadə olunmamış 22 sual qalıb; hovuz 25 yeni sualla genişləndirildi.

## 3. Açıq problemlər (bilinən, sənədləşdirilmiş)

1. **Skorun sıfırlanması:** DNT / CSS / "Aya ilk dəfə" sorğularında `scored` massivində **bütün** nəticələr `score: 0` görünür, halbuki eyni obyekt üçün `scoreResult()` modul səviyyəsində 5.2–7.2 qaytarır (pool: az.wikipedia "CSS", snippet 157 simvol). Nəticə: hamısı 1.5 həddindən düşür → n=0. Növbəti sessiyada `scored`-in hansı mərhələdə yenidən qurulduğu izlənməlidir (namizəd: `results` massivinin özünün `score: 0` daşıması və `{...r}` ilə üzərinə yazılması).
2. **Anchor tərcüməsi zibili:** "Çinin paytaxtı hansı şəhərdir" → `anchor_query = "cinin capital hansi city"`; hal şəkilçisi tərcüməyə düşür və `wiki_last_resort` mərhələsini zəhərləyir.
3. **"necə" → "sayı" çevrilməsi:** "CSS-də rəng **necə** təyin olunur" → `normQuery = "CSS-də rəng təyin olunur **sayı**"` — how-to sualı say sualına çevrilir.
4. Bakı metrosu 26 vs 27 (mənbələr arası real ziddiyyət → `conflict`), Bakı universitet sayı (stat.gov.az gəlmir), Antarktida (ensiklopedik cavab gəlmir) — v115-dən bəri açıq.

## 4. Deploy

Push/deploy bu mühitdə mümkün deyil (etimad yoxdur) — dəyişikliklər yalnız lokal `main` üzərindədir.
