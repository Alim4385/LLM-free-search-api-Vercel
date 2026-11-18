# Kitabxana təklifləri — yoxlama nəticəsi (v104)

7 kitabxana təklif olunmuşdu. Hamısı real kodda və canlı ölçmələrlə yoxlanıldı.
Xülasə: **0-ı quraşdırılmadı**, çünki 5-i artıq mövcud kodun etdiyi işi təkrarlayır,
2-si isə real problemi həll etmir. Amma yoxlama zamanı **4 real səhv** tapıldı və düzəldildi.

| kitabxana | iddia | real vəziyyət | qərar |
|---|---|---|---|
| `p-timeout` | "custom timeout var, AbortController yoxdur" | **YANLIŞ** — `lib/search.js:fetchTimeout()` artıq `AbortSignal.timeout()` + `AbortSignal.any()` işlədir; `lib/extract.js` də eyni | ❌ lazım deyil |
| `p-map` | "sərhədsiz paralel fetch Vercel-i çökdürür" | **YANLIŞ** — paralellik artıq sərhədlidir: `toFetch = filtered.slice(0, maxResults + 2)` (maks. 10), hər fetch 1.5 s timeout + `readCapped()` ilə 2 MB limit, üstəlik 1.2 s ümumi büdcə. `p-map` yalnız paralelliyi AZALDARDı → latency artardı | ❌ zərərli |
| `opossum` / `cockatiel` | "öz circuit breaker-in sənaye standartı ilə əvəzlənsin" | `lib/circuit.js` (112 sətir) provayder-üzrə threshold + cooldown + `/tmp` faylına persist (engines endpointi üçün körpü) edir. `opossum` bu konfiqi və fayl körpüsünü vermir | ❌ funksiya itkisi |
| `sanitize-html` | "readability-dən sonra HTML qalır, LLM çox token görür" | **YANLIŞ** — çıxış HTML deyil: `lib/extract.js:322-325` bütün tag-ları silir, sonra `cleanContent()` mətn qaytarır. Endpoint heç vaxt HTML qaytarmır | ❌ no-op |
| `zod` | "əl ilə yazılmış if/else-ləri əvəz edir" | `lib/pipeline/params.js` 60 sətir + 7 unit test. `zod` +13 KB (gzip) və cold-start; qazanc yoxdur | ❌ yük artımı |
| `mathjs` | "riyaziyyat regex-lərini əvəz edir, vahid çevirmələrini bir sətirdə həll edir" | `mathjs` **AZ dilini başa düşmür** — "12 vurulsun 3" və ya "200-ün 15 faizi" ifadələrini parse edə bilmir, yəni ön emal yenə lazımdır. Üstəlik ~500 KB | ❌ problemi həll etmir (aşağıya bax) |
| `fuse.js` | "fuzzy matching stemming-i gücləndirir" | AZ stemming + "neçə ≠ necə" invariantı sərt token uyğunluğuna dayanır; fuzzy bu invariantı poza bilər | ❌ risk |

## Yoxlama zamanı tapılan real səhvlər (düzəldildi)

1. **`math.js` şifahi əməliyyatları tanımırdı** — "12 vurulsun 3", "50 plus 50", "10 çıx 4" → `hit:false`.
   İndi rəqəm+əməliyyat sözü sıra ilə yığılır (`vur/vurulsun/çarp`, `böl/bölünsün`, `topla/üstəgəl/plus`, `çıx/minus`).
2. **"16-nın kökü"** (kvadrat sözü olmadan) və **"2 üstü 10"** tanınmırdı → əlavə edildi.
3. **Temperatur çevirməsi sınıq idi** — `farengeyt` yazılışı alias siyahısında yox idi, ona görə
   "30 dərəcə Selsi neçə Farengeyt" → `hit:false`. Əlavə: nəticə 2 onluğa yuvarlaqlaşdırılır
   ("37,777778 °C" → "37,78 °C").
4. **v101 anchor qapısı struktur cavabı silə bilirdi** — "12 vurulsun 3" sorğusunda `strongAnchor`
   "12vurulsun" kimi saxta anchor görür və riyaziyyat cavabını atırdı (`anchor_empty`).
   Düzəliş: (a) boşluqla ayrılmış anchor yalnız BÖYÜK hərfli marka üçün ("iPhone 15" ✓, "12 vurulsun" ✗);
   (b) anchor qapısı struktur cavabları (hesablama/vahid/fakt/ölçü) heç vaxt atmır.

## Yekun

- `npm test`: **530 keçdi, 0 uğursuz**.
- Endpoint yoxlaması: `12 vurulsun 3` → "12 × 3 = 36", `16-nın kökü` → "√16 = 4",
  `2 üstü 10` → "2^10 = 1024", `30 dərəcə Selsi neçə Farengeyt` → "30 °C = 86 °F".
- Nəticə: kod həcmi artmadı, asılılıq artmadı, 6 yeni test əlavə olundu.
