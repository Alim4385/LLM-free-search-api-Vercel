# v129 — debug trace: "namizəd X niyə nəticədə yoxdur?" sualına bir sorğuda cavab

## Niyə
v118–v128 arası hər bag üçün dolayı sübutla təxmin etmək lazım gəldi (təzəlik filtri? straggler? gating?). Kod öz qərarlarını gizlədirdi: `meta.providers_used` tam siyahı deyildi, gec gələn provayder nəticəsi səssizcə atılırdı, namizədin hansı mərhələdə düşdüyü görünmürdü.

## Necə işlədilir
| Yol | İstifadə |
|-----|----------|
| **Sorğuya `#debug` əlavə et** | `последние новости России #debug` — MCP alətinin sxemi köhnə qalsa belə işləyir (etiket sorğudan çıxarılır, `response.query` təmizdir) |
| MCP `debug: true` | `web_search` sxeminə `debug` (boolean) əlavə olundu |
| REST | `POST {"query": "...", "debug": true}` və ya `GET /api/search?q=...&debug=1` |

Debug sorğuları keşi keçir.

## `meta.debug` strukturu
```
engine           { engine_version, commit }
lang             aşkarlanmış sorğu dili
terms            { query_terms, native_terms, anchor_query, rewritten_query, translate_input }
providers        { <ad>: { status, calls, n?, ms?, error?, cutoff_after_ms?, late? } }
stages           [ { stage, in, out, dropped, revived? } ... ]
candidates       [ { url, src, status: kept|dropped, rank?, score, final_score?, zero?, stage?, why?, revived? } ]  (≤90, kept əvvəl)
dropped_total, candidates_total
degraded_stages
```
Provayder `status`: `ok`, `empty`, `error` (+`error` mətni), `skipped_language`, `circuit_open`, `aborted`, **`cutoff`** (collect() gözləmədən davam etdi — nəticə atıldı; `cutoff_after_ms` göstərir).

Mərhələlər (sıra ilə): `raw_candidates` → `err_page_title` → `min_score_1.5` → `wikipedia_title_check` → `score_gates` → `near_duplicate` → `diversify_by_domain` → `native_quota_candidates` → `to_fetch_cut` → (fetch dövrü: `fetch_loop` — challenge / block / boilerplate / off-topic) → `freshness_filter` → `recency_intent_floor` → `junk_domain_drop` → `native_quota_final` → `final_limit`. Qalan: `unknown_cut`.

`zero` — `scoreResult`-un 0 verdiyi dəqiq səbəb: `junk_domain_or_auth_root`, `dictionary_page`, `casino_spam`, `website_query_no_site_signal`, `country_title_mismatch`, `no_query_term_hit`, `topical_term_missing_v128`, `historical_year_missing`, `concept_coverage_low`, `anchor_phrase_missing`, `min_term_hits_not_met`.

## Eyni dəyişikliklə gələn real düzəlişlər
1. `route.js`: `gate_relaxed` və `byRaw` yenidən qiymətləndirmələri `qTerms` əvəzinə `termsFor(r)` işlədir (v128-dəki yerli-termin düzəlişi bu yollara çatmırdı — eyni anchor-çirklənmə sinfi).
2. **GET `n` parametri oxunur.** MCP `max_results`-ı `n` kimi göndərirdi, GET isə yalnız `max_results`/`count`/`limit` oxuyurdu → MCP-dən gələn `max_results` həmişə 5 sayılırdı. İndi hörmət olunur.

## Məhdudiyyətlər
- Provayderin `late` (cutoff-dan sonra gələn) nəticəsi cavab göndərildikdən SONRA məlum olur → həmin sorğunun cavabında görünmür; yalnız `cutoff` görünür.
- Namizədlər URL ilə izlənir; `searchAll` daxilində (provayderlərarası) URL birləşməsi `raw_candidates`-dən əvvəl baş verir.
- `native` intentlər (hava, valyuta) pipeline-dan keçmir → trace boşdur.
- `score_gates` mərhələsi bir neçə ardıcıl filtri birləşdirir (səbəb `zero` sahəsindən oxunur).
- Debug cavabı böyükdür (≤90 namizəd); yalnız diaqnostika üçündür.

## Test
26 yeni test: trace vahid testləri, `scoreResult` explain, `#debug`/`debug=true`/MCP/GET `n`, və gecikən provayderin `cutoff` işarələnməsi (tam handler, stub şəbəkə). Cəmi 819 keçir.
