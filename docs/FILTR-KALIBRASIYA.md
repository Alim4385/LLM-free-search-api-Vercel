# Filtr kalibrasiyası (Vikipediya etalonu)

Məqsəd: filtrin **doğru nəticəni atmasını** (false negative) və **zibili saxlamasını**
(false positive) əl ilə yoxlamaq əvəzinə avtomatik ölçmək.

```bash
node eval/filter-calib.mjs            # 14 sual, canlı axtarış + Vikipediya etalonu
node eval/filter-calib.mjs --json     # eval/calib-report.json yazır
```

## Etiketləmə qaydaları (3 siqnal)

1. **Cavab siqnalı** — etalon məqalədəki rəqəm/tarix nəticədə *sualın adı ilə bitişik*
   görünürsə ("64 rayon") → relevant. Tək rəqəmin təsadüfən görünməsi sayılmır.
2. **Leksik örtüşmə** — nəticə mətni ilə etalon mətnin termin kəsişməsi ≥ 0.20.
3. **How-to qaydası** — "necə hazırlanır" sualında baş söz + hazırlanma siqnalı.

Entity yoxlaması: sualın ən uzun sözünün 5 hərflik gövdəsi ("Azərbaycan/Azerbaijan" → `azerb`)
nəticədə olmalıdır — yoxsa "How many regions does China have" Azərbaycan sualına cavab sayılır.

## Ölçülən nəticələr

| tarix | versiya | Precision | Recall | TP | FN | FP |
|---|---|---|---|---|---|---|
| v94 (baza) | FV 192 | 88.9 % | 59.3 % | 48 | 33 | 6 |
| v95 | FV 193 | 88.1 % | 61.9 % | 52 | 32 | 7 |

v95-də dəyişənlər: (1) `minHits` — 3 anlayışlı sualda əsas mövzu tutulubsa nəticə sıfırlanmır;
(2) "X nədir" sualında əsas mövzu = ilk fərqləndirici söz (söz sırası), ən uzun söz deyil;
(3) boş snippet + güclü bal (>3) olan nəticə atılmır — məzmun ekstraksiyada çəkilir.
Nəticə: recall +2.6 pp, precision −0.8 pp (hədlər daxilində), TP 48 → 52.

FN-in böyük hissəsi iki qrupdur: (a) **junk domen** (news.google/facebook — qəsdən atılır),
(b) **boş snippet** (v95-də düzəldildi). Qalan "FN" etiket səhvidir (mövzusuz səhifələr).
