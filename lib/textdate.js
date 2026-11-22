// Mətndən (snippet başlanğıcından) nəşr tarixi çıxarır — yalnız AÇIQ və GÜVƏNLİ hallarda.
// Məsələn İHA snippet-i: "21 Kasım 2026 Cumartesi - 19:40 Göçük altından ..."
// Qaydalar:
//  - tarix mətnin ƏVVƏLİNDƏ olmalıdır (ilk ~48 simvol): mətn içində keçən köhnə tarix ("2019-cu ildə")
//    nəşr tarixi sayılmır;
//  - gələcək tarix (sabaha qədər tolerans) və 400 gündən köhnə tarix qəbul edilmir;
//  - nəticə yalnız `published_at` boşdursa istifadə olunur və `date_source: "snippet"` ilə işarələnir.

const MONTHS = {
  // az
  yanvar: 1, fevral: 2, mart: 3, aprel: 4, may: 5, iyun: 6, iyul: 7, avqust: 8, sentyabr: 9, oktyabr: 10, noyabr: 11, dekabr: 12,
  // tr (ascii-ləşdirilmiş formada da tanınır)
  ocak: 1, subat: 2, şubat: 2, nisan: 4, mayis: 5, mayıs: 5, haziran: 6, temmuz: 7, agustos: 8, ağustos: 8,
  eylul: 9, eylül: 9, ekim: 10, kasim: 11, kasım: 11, aralik: 12, aralık: 12,
  // en
  january: 1, february: 2, march: 3, april: 4, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  // ru (genitiv)
  января: 1, февраля: 2, марта: 3, апреля: 4, мая: 5, июня: 6, июля: 7, августа: 8, сентября: 9, октября: 10, ноября: 11, декабря: 12
};

const NAMES = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|");
// "21 Kasım 2026" | "21 noyabr 2026" | "21 ноября 2026" | "21 November 2026"
const DMY_NAME = new RegExp(`(?:^|[^\\p{L}\\p{N}])(\\d{1,2})\\s+(${NAMES})\\.?,?\\s+(20\\d{2})(?![\\p{L}\\p{N}])`, "iu");
// "November 21, 2026"
const MDY_NAME = new RegExp(`(?:^|[^\\p{L}\\p{N}])(${NAMES})\\.?\\s+(\\d{1,2}),?\\s+(20\\d{2})(?![\\p{L}\\p{N}])`, "iu");
// "21.11.2026" | "21/11/2026"
const DMY_NUM = /(?:^|[^\d])(\d{1,2})[./](\d{1,2})[./](20\d{2})(?!\d)/;
// "2026-11-21" | "2026/3/21"
const ISO = /(?:^|[^\d])(20\d{2})[-/](\d{1,2})[-/](\d{1,2})(?!\d)/;

function build(y, m, d, now) {
  y = Number(y); m = Number(m); d = Number(d);
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const ts = Date.UTC(y, m - 1, d, 12, 0, 0);
  const dt = new Date(ts);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null; // 31 fevral və s.
  if (ts > now + 86_400_000) return null;                    // gələcək
  if (now - ts > 400 * 86_400_000) return null;              // çox köhnə
  return new Date(ts).toISOString();
}

export function extractLeadDate(text, now = Date.now(), maxLead = 16) {
  const head = String(text || "").trim().slice(0, maxLead + 24); // +24: tarixin özü sərhədi keçə bilər
  if (!head) return null;
  const tryMatch = (re, fn) => {
    const m = re.exec(head);
    if (!m) return null;
    // tarix yalnız mətnin başlanğıcında sayılır: ondan əvvəl HEÇ BİR hərf ola bilməz
    // ("Bu hadisə 21 Kasım 2026 ..." → rədd; "22 saat önce · ..." kimi nisbi vaxtlar ayrıca məsələdir)
    const start = m.index + (/^[^\p{L}\p{N}]/u.test(m[0]) ? 1 : 0);
    if (start > maxLead) return null;
    if (/\p{L}/u.test(head.slice(0, start))) return null;
    return fn(m);
  };
  return (
    tryMatch(DMY_NAME, m => build(m[3], MONTHS[m[2].toLowerCase()], m[1], now)) ||
    tryMatch(MDY_NAME, m => build(m[3], MONTHS[m[1].toLowerCase()], m[2], now)) ||
    tryMatch(ISO, m => build(m[1], m[2], m[3], now)) ||
    tryMatch(DMY_NUM, m => build(m[3], m[2], m[1], now))
  );
}

// v119: provayderin verdiyi tarix (məs. Bing RSS pubDate = yenidən indekslənmə vaxtı ola bilər) ilə
// snippet başlanğıcındakı AÇIQ tarix ("25 июля 2026 г. · ...") ziddiyyət təşkil edirsə, snippet tarixi seçilir.
// Səhifənin öz meta/JSON-LD tarixi (pageDate) varsa ona toxunulmur — o, ən etibarlı mənbədir.
export function reconcilePubDate({ direct = null, pageDate = null, snippet = "", now = Date.now(), toleranceDays = 2 } = {}) {
  const textDate = extractLeadDate(snippet, now);
  if (!textDate) return { pubAt: direct || null, source: null, overridden: null };
  if (!direct) return { pubAt: textDate, source: "snippet", overridden: null };
  if (pageDate) return { pubAt: direct, source: null, overridden: null };
  const diff = Math.abs(Date.parse(direct) - Date.parse(textDate));
  if (Number.isFinite(diff) && diff > toleranceDays * 86_400_000) {
    return { pubAt: textDate, source: "snippet", overridden: direct };
  }
  return { pubAt: direct, source: null, overridden: null };
}
