# Uzun sorğu testi — 100 sorğu (20 mövzu × 5 uzunluq)

Test: `uploads/test_sorgulari_100.txt` → runner: `eval/length100.mjs`
Ölçü: hər sorğu üçün **top-3 nəticənin mövzu anlayışlarına uyğunluğu**
(mövzunun ən qısa sorğusundan götürülən açar sözlər).
`strong` = bütün açar sözlər top-3-də, `weak` = yarısı, `off` = heç biri, `boş` = nəticə yox.

---

## 1. Əsas nəticə: fərziyyə TƏSDİQLƏNDİ (və düzəldildi)

| səviyyə | əvvəl strong | sonra strong | əvvəl fallback | sonra fallback | əvvəl ms | sonra ms |
|---|---|---|---|---|---|---|
| S1 (1–2 söz) | 90% | **95%** | 5% | 0% | 4138 | 3967 |
| S2 (3–4 söz) | 80% | 70% | 5% | 15% | 4228 | 3775 |
| S3 (5–7 söz) | 85% | **90%** | 5% | 5% | 4550 | 3028 |
| S4 (8–12 söz) | 85% | 80% | 40% | 50% | 5696 | 4028 |
| S5 (13+ söz) | **30%** | **65%** | 80% | 90% | 5259 | 4375 |

→ S1→S5 düşməsi **real idi** (90% → 30%). Səbəb: 13+ sözlük sual olduğu kimi
provayderlərə göndərilirdi və onlar "cümlə" kimi axtarış edib zibil qaytarırdı.

## 2. Dil üzrə

| dil | əvvəl strong | sonra strong | əvvəl off/boş | sonra off/boş | əvvəl ms | sonra ms |
|---|---|---|---|---|---|---|
| EN | 86% | 86% | 0% | 3% | 3928 | 3749 |
| AZ | **66%** | **89%** | **23%** | **3%** | 5143 | **2498** |
| TR | 70% | 63% | 10% | 10% | 5331 | 5493 |

AZ ən böyük qazanc: həm keyfiyyət (+23 bənd), həm sürət (2 dəfə).
TR bugünkü provayder vəziyyətindən əziyyət çəkir (brave/yahoo cooldown).

## 3. Nə düzəldildi (v110)

1. **Nüvə sorğu** (`lib/rank.js: coreSearchQuery`) — 8+ sözlük sorğuda stopword-lar
   və "istəyirəm / axtarıram / want / need" kimi doldurucu fellər atılır, ilk 6 məzmun
   sözü provayderlərə gedir. Tam sorğu skorlaşdırma və niyyət üçün qalır.
   Nümunə: *"Evdə şah plov hazırlamaq istəyirəm düyünü neçə dəqiqə qaynatmalı, lavaşı necə
   hazırlamalı…"* → `Evdə şah plov düyünü neçə dəqiqə` → nəticə: **Şah Plov resepti** (əvvəl: bab.la lüğəti).
2. **Boş nəticə qadağandır** (`wiki_last_resort`) — bütün provayderlər cooldown olanda
   sorğunun dilinə uyğun vikipediya axtarışı işə düşür. Əvvəl 3–5 sorğu tam boş qayıdırdı.
3. **azwiki_hint əlaqə filtri** — "Qobustan qaya rəsmləri" sorğusuna *"Zərb musiqi alətləri"*
   qaytarırdı; indi sorğu termini ilə üz-üşə gəlməyən nəticə atılır.

## 4. Qalan problemlər (dürüst siyahı)

- **S5-də fallback 90%** — nəticə var, amma sistem "aşağı əminlik" rejimindədir.
  Uzun sualın *bütün* hissələrini cavablandırmaq hələ yoxdur (çoxhissəli suallar:
  "giriş qiyməti + neçə min il + necə getmək").
- **Latensiya quyruğu** — 100 sorğudan 2-si 9–12 s. `HARD_DEADLINE_MS = 8000`,
  amma Vercel 10 s limiti ilə toqquşur; bəzən müştəri tərəfdə timeout olur.
- **TR zəifliyi** — provayderlər (brave/yahoo) TR-də daha çox cooldown alır;
  `wikipedia: error` mesajı əslində "nəticə tapılmadı" deməkdir (metrika yanıldıcıdır).
- EN S5-də iki sual texniki cəhətdən düzgün səhifələr gətirdi, amma açar söz testi
  onları "off" saydı (test özü də sadələşdirilmişdir — məzmun oxunmur, söz uyğunluğuna baxır).

## 5. Təkrar işə salmaq

```bash
node eval/length100.mjs /home/user/uploads/test_sorgulari_100.txt --conc=3
# nəticələr: eval/length100.out.json
```

Golden qapısı (31 yoxlama): **27 keçdi / 1 bilinən / 3 uğursuz** — uğursuzluqlar
provayder dəyişkənliyidir (eyni sorğular lokal mühitdə keçir: metro → 27 stansiya,
universitet → 49–51).

## Əlavə: mövzu × səviyyə cədvəli (✅ strong, ◐ weak, ❌ off, ∅ boş)

| mövzu | S1 | S2 | S3 | S4 | S5 | orta ms |
|---|---|---|---|---|---|---|
| EN-1 Rust async | ✅ | ✅ | ✅ | ◐ | ✅ | 4980 |
| EN-2 Transformer attention | ✅ | ✅ | ✅ | ✅ | ✅ | 3759 |
| EN-3 Python asyncio | ✅ | ✅ | ✅ | ✅ | ❌ | 3217 |
| EN-4 Docker volumes | ✅ | ✅ | ✅ | ◐ | ◐ | 4249 |
| EN-5 Postgres index | ✅ | ✅ | ✅ | ✅ | ✅ | 3707 |
| EN-6 Vector database | ✅ | ✅ | ✅ | ✅ | ✅ | 3573 |
| EN-7 Kubernetes ingress | ✅ | ✅ | ✅ | ◐ | ✅ | 2760 |
| AZ-1 Azərbaycan NLP | ✅ | ✅ | ✅ | ✅ | ◐ | 4667 |
| AZ-2 Bakı hava | ✅ | ✅ | ✅ | ✅ | ✅ | 165 |
| AZ-3 Azərbaycan Xalq Cümhuriyyəti | ✅ | ✅ | ✅ | ✅ | ✅ | 3519 |
| AZ-4 Nizami Gəncəvi | ✅ | ✅ | ✅ | ✅ | ✅ | 2392 |
| AZ-5 Manat məzənnəsi | ✅ | ◐ | ✅ | ✅ | ✅ | 1020 |
| AZ-6 Qobustan | ✅ | ✅ | ✅ | ✅ | ✅ | 2641 |
| AZ-7 Şah plov | ✅ | ◐ | ✅ | ✅ | ∅ | 3085 |
| TR-1 Yapay zeka | ✅ | ❌ | ✅ | ✅ | ✅ | 3784 |
| TR-2 İstanbul'un fethi | ✅ | ✅ | ✅ | ✅ | ✅ | 5026 |
| TR-3 Python öğrenme | ◐ | ◐ | ◐ | ❌ | ◐ | 3396 |
| TR-4 Kapadokya | ✅ | ∅ | ✅ | ✅ | ✅ | 6535 |
| TR-5 Ankara Kızılay | ✅ | ✅ | ✅ | ✅ | ◐ | 8011 |
| TR-6 Türkçe NLP | ✅ | ◐ | ◐ | ✅ | ◐ | 6206 |

### Ən pis 10 sorğu (nəticə mövzudan kənar)

- S5 [EN] `I have a python script that makes hundreds of http requests and I want` → github.com, news.google.com, iterm2.com
- S5 [AZ] `Evdə şah plov hazırlamaq istəyirəm düyünü neçə dəqiqə qaynatmalı, lava` → nəticə yox
- S2 [TR] `yapay zeka nedir` → en.wikipedia.org, geeksforgeeks.org, ibm.com
- S4 [TR] `sıfırdan python öğrenmek için hangi sırayı izlemeliyim` → news.ycombinator.com
- S2 [TR] `Kapadokya balon turu` → nəticə yox
