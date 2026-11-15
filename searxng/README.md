# SearXNG Self-Hosted — VPS Quraşdırma Təlimatı

SearXNG 70+ axtarış mühərrikini birləşdirən **tam keyless** metasearch sistemidir.
Öz VPS-ində Docker ilə işləyir, **qaqa-search-api (Vercel)** onu HTTP ilə çağırır.

```
[LLM] → [Vercel: qaqa-search-api] → [VPS: SearXNG Docker] → 70+ mühərrik
                              ↘ [Tavily keyless, DDG, Bing, ...] (digər provayderlər)
```

## Niyə SearXNG?
- Heç bir API key, ödəniş yoxdur — tam pulsuz
- 70+ mühərrik bir sorğuda (Google, Bing, DDG, Brave, Wikipedia...)
- Öz IP-sindən sorğu göndərir → Vercel IP-sinin rate limitindən asılı deyilsən
- JSON API verir: `/search?q=...&format=json`

## Addım 1: Ən ucuz VPS al
| Provayder | Plan | Qiymət |
|---|---|---|
| Hetzner | CX22 (2 vCPU, 4GB RAM) | ~€4/ay |
| Contabo | VPS S | ~€5/ay |
| DigitalOcean | Basic Droplet | ~$6/ay |

Ubuntu 24.04 seç, SSH açarı ilə qoşul.

## Addım 2: Docker quraşdır
```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# Çıx və yenidən qoşul (qrup tətbiq olunsun)
```

## Addım 3: SearXNG-ni işə sal
```bash
# Bu qovluğu VPS-ə köçür (scp və ya git)
scp -r searxng/ root@VPS_IP:~/

ssh root@VPS_IP
cd ~/searxng

# secret_key-i dəyiş (settings.yml-də)
sed -i 's/DEGISDIRIBURAYA-OZUNUN-GIZLI-ACARINI-YAZ-1234567890/oz-gizli-acarin-12345/' searxng/settings.yml

docker compose up -d
docker compose logs -f  # "SearXNG ... started" görünənə qədər gözlə
```

## Addım 4: Test et
```bash
curl "http://localhost:8888/search?q=LLM&format=json" | head -c 500
# JSON nəticə gəlməlidir
```

## Addım 5: HTTPS əlavə et (tövsiyə olunur)
Vercel-dən HTTPS ilə çağırmaq üçün SearXNG-yə HTTPS lazımdır. Ən asan yol — Caddy:
```bash
# Caddy quraşdır
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy

# Caddyfile
echo 'search.SENIN-DOMENIN.com {
    reverse_proxy localhost:8888
}' | sudo tee /etc/caddy/Caddyfile
sudo systemctl restart caddy
# Caddy avtomatik Let's Encrypt sertifikatı alır (bir neçə dəqiqə çəkir)
```

## Addım 6: qaqa-search-api-yə qoş
Vercel layihə parametrlərində (Settings → Environment Variables) əlavə et:
```
SEARXNG_URL=https://search.SENIN-DOMENIN.com
```
Sonra redeploy et (`npx vercel --prod` və ya Vercel dashboard-dan).

## Addım 7: Yoxla
```bash
curl -X POST https://qaqa-search-api.vercel.app/api/search \
  -H "Content-Type: application/json" \
  -d '{"query":"LLM","max_results":5}'
# meta.providers_used içində "searxng" görünməlidir
```

## Qeyd
- SearXNG olmadan da sistem işləyir (8 keyless provayder). SearXNG əlavə etibarlılıq və 70+ mühərrik diversifikasiyası verir.
- VPS IP-si də rate limit yeyə bilər, amma SearXNG özü mühərrikləri növbələşdirir → daha etibarlıdır.
- Heç bir API key heç yerdə yoxdur — prinsip qorunur.
