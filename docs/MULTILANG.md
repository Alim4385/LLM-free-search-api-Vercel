# Çoxdilli axtarış eksperimenti (v105)

Sual: "Sistem ingiliscə axtarır — TR/RU və başqa dilləri də əlavə etsək nəticə yaxşılaşar?"

## 1. Ölçmə: TR/RU axtarış nə qədər YENİ nəticə gətirir?

`eval/multilang.mjs`, 10 AZ sorğu (rəqəm, say, tarix, coğrafiya, anlayış):

| metrik | nəticə |
|---|---|
| AZ qolu (AZ+EN, hazırkı sistem) | 24 nəticə/sorğu, 80 "faydalı" |
| TR+RU qolları əlavə etdi | +293 nəticə, +140 yeni host |
| onlardan FAYDALI (gözlənilən açar söz var) | **+27** |
| latency | TR ~2.2 s, RU ~1.9 s (paralel getsə də hər biri ayrı fan-out) |

➡️ Həcm böyük (+29 nəticə/sorğu), **fayda kiçik** (+27/10 sorğu ≈ 2.7).

## 2. Ölçmə: tərcümə ilə vikipediya körpüsü

AZ sorğunu TR/RU-ya tərcümə edib həmin dilli vikipediyada axtarmaq (10 sorğu):

| vəziyyət | nəticə | faydalı |
|---|---|---|
| AZ sorğu ilə tr.wikipedia | 7 | 2 |
| **TR-yə tərcümə edilmiş sorğu ilə tr.wikipedia** | **50** | **26** |
| RU-ya tərcümə ilə ru.wikipedia | 50 | 10 |

➡️ Tərcümə şərtdir (tərcüməsiz TR/RU axtarışı demək olar ki, boş qaytarır).
TR korpusu AZ mövzularında həqiqətən zəngindir: `Hocalı Katliamı`, `Şeki`, `Azerbaycan'daki üniversiteler listesi` (içində **51** — həmin sualın cavabı).

## 3. A/B: sistemin son cavabı dəyişirmi?

`AZ_BRIDGE=0/1`, 10 sorğu, növbəli (interleaved) ölçmə:

| metrik | OFF | ON |
|---|---|---|
| düzgün cavab tapıldı | 7/10 | **7/10** |
| nəticə sayı | 23 | 21 |
| orta latency | 4489 ms | 4434 ms |
| körpü nə vaxt işə düşdü | — | 3/10 |

➡️ Cavab sayı dəyişmir, latency dəyişmir. Körpü yalnız nəticə çox az olanda işə düşür.

## 4. Nəticə və qərar

1. **Körpü kodu saxlanıldı, default SÖNÜK** (`AZ_BRIDGE=1` ilə açılır). Səbəb: qazanc
   cavab səviyyəsində görünmədi, əvəzində hər sorğuya əlavə Wikimedia API çağırışı gəlir və
   prod-da `wikipedia: error` (429) hallarını artırır — bu isə əvvəl işləyən sualları sındırır.
2. **Wikimedia API keşi (10 dəq)** qaldı — bu, 429 yükünü real azaldır (v105.5).
3. **Ən böyük problem dil deyil, çıxarışdır (extraction):** tr.wikipedia səhifəsində "51"
   rəqəmi var, amma (a) səhifə mətnini götürmək lazımdır (API `explaintext` ~300 ms),
   (b) say çıxarışı "51 üniversite" kimi TR ismi tanımalıdır. Növbəti addım budur:
   körpü səhifələrinin MƏTNİNİ API-dən götürüb say/ölçü/tarix çıxarışına vermək.
4. Provayder hovuzu genişlənəndə (brave/yahoo limiti açılanda) çoxdilli fan-out yenidən ölçülməlidir —
   `eval/multilang.mjs` hazırdır, keş sayəsində təkrar ölçmə sürətlidir.

## 5. Golden qapısı (canlı, v105.6 / FV 213)

`26 keçdi / 1 bilinən / 3 uğursuz`. Uğursuzluqlar: `GPT-5` (prod-da wikipedia 429 →
tarix mətni gəlmir), `minimum əmək haqqı` və `HTTP-vs-HTTPS` (mənbə hostu). Gün ərzində
provayderlər dəyişdiyi üçün qapı 26–29 arasında oynayır.
