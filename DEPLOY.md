# Deploy Təlimatı — GitHub → Vercel

## Bəli, düz başa düşmüsən:
- **Localhost** — sadəcə burada test üçündür, production-da işləmir
- **Vercel** — sənə domen verir (`qaqa-search-api.vercel.app`), API orada işləyəcək
- **Heç bir API key lazım deyil** — sistem tam keyless-dir

---

## Addım 1: GitHub-a push et

Bu qovluğu (`search-api/`) GitHub-da yeni repo aç və push et:

```bash
cd search-api
git init
git add .
git commit -m "Qaqa Search API - keyless LLM search"
git branch -M main
git remote add origin https://github.com/SENIN-USERNAME/qaqa-search-api.git
git push -u origin main
```

> `.gitignore` hazırdır — `node_modules`, `.next`, `.env` GitHub-a getmir. Vercel özü `npm install` edir.

## Addım 2: Vercel-də import et

1. [vercel.com](https://vercel.com)-a daxil ol
2. **Add New → Project**
3. **Import Git Repository** → `qaqa-search-api`-ni seç
4. Framework avtomatik **Next.js** tanınacaq (vercel.json hazırdır)
5. **Deploy** düyməsinə bas

Vercel özü edəcək: `npm install` → `npm run build` → deploy. ~2 dəqiqə çəkir.

## Addım 3: Domeni al

Deploy-dan sonra Vercel sənə domen verir:
```
https://qaqa-search-api.vercel.app
```

## Addım 4: Test et

```bash
# Health check
curl https://qaqa-search-api.vercel.app/api/health

# Axtarış testi
curl -X POST https://qaqa-search-api.vercel.app/api/search \
  -H "Content-Type: application/json" \
  -d '{"query":"LLM","max_results":5}'
```

Cavabda `results` massivi və `meta.providers_used` görünməlidir.

## Addım 5: LLM-ə qoş

- Tool schema: `lib/tool-schema.json` (`qaqa_search` aləti)
- Nümunə kod: `examples/llm-integration.js`
- LLM sorğu göndərir → API JSON qaytarır → LLM cavab verir, mənbələri [1] [2] nömrələyir

---

## Optional: SearXNG (VPS) — sonra əlavə edə bilərsən

Sistem SearXNG-siz də tam işləyir (8 keyless provayder). Əgər VPS alsan:

1. `searxng/README.md`-dəki addımları izlə
2. Vercel → Settings → Environment Variables → əlavə et:
   ```
   SEARXNG_URL=https://search.SENIN-DOMENIN.com
   ```
3. Redeploy et

## Optional: Upstash Redis (cache üçün)

Serverless-də yaddaş itir, ona görə qalıcı cache üçün Upstash Redis (pulsuz):
1. [upstash.com](https://upstash.com)-da pulsuz baza aç
2. Vercel env-ə əlavə et:
   ```
   UPSTASH_REDIS_REST_URL=...
   UPSTASH_REDIS_REST_TOKEN=...
   ```
3. Olmasa da sistem işləyir (in-memory cache)

---

## Tez-tez verilən suallar

**Vercel-də "Function Timeout" xətası?**
Search API ~2-3 saniyə çəkir, Vercel Hobby plan 10s limit verir — kifayətdir.

**Provayderlər Vercel IP-dən bloklansa?**
8 provayder var, biri bloklansa digərləri işləyir. Vote sistemi ən etibarlı nəticələri seçir.

**API key lazımdırmı?**
Xeyr. Heç bir key yoxdur — prinsip budur. Tavily keyless rəsmi açarsız rejimdir.
