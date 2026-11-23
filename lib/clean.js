import { cleanNavigationAndRepeats } from "./text-noise.js";
// v12 + v15 + v16: Content hygiene, danışıq dili normallaşdırıcısı, AZ xəbər şablon təmizləyicisi,
// fonetik/IPA simvol təmizliyi ([bɑˈcɯ] ⓘ), təkrarlanan sətir filtri və reklam linki təmizliyi
import { tokenize, trigramSimilarity, trigrams, normalizeAz } from "./rank.js";

const WIKILINK_RE = /\[\[([^\|\]]*)(?:\|([^\]]+))?\]\]/g;
const CITATION_RE = /\[\d{1,4}\]/g;
const WIKI_INLINE_RE = /\[(?:edit|citation needed|update|yenilə|top|add|[vtbsb])\]/giu;

// v16: Wikipedia IPA fonetik transkripsiya simvolları ([bɑˈcɯ], /ˈbækuː/, ˈbækuː/, ⓘ) və boş qalan mötərizələr
const IPA_BRACKET_RE = /(\[[^\]\n]{1,35}[ˈˌɑæɒɔɕðɛɜɡɣɨɪɯɲŋɵɸʁɾʃθʊʌʒʔʕːˑ][^\]\n]{0,25}\]|\/[^/\n]{1,35}[ˈˌɑæɒɔɕðɛɜɡɣɨɪɯɲŋɵɸʁɾʃθʊʌʒʔʕːˑ][^/\n]{0,25}\/|(?:^|[\s(])[ˈˌɑæɒɔɕðɛɜɡɣɨɪɯɲŋɵɸʁɾʃθʊʌʒʔʕːˑa-z]{1,20}\/\s*;?\s*)/gu;
const AUDIO_ICON_RE = /[ⓘ🔊🔉🔈]/gu;
const BROKEN_PAREN_RE = /\(\s*(?:[A-ZƏÖÜĞÇŞİa-zəöüğçşı.\s]{1,25}:\s*[,;]\s*)+(?:[A-ZƏÖÜĞÇŞİa-zəöüğçşı.\s]{1,25}:\s*([^)]*?))?\)/gu;
const EMPTY_PAREN_RE = /\(\s*[,;:\s]*\)/g;
const DATELINE_RE = /^Bakı,\s*\d{1,2}\s+[a-zəöüğçşı]+,\s*AZƏRTAC\s*[.!-]?\s*/iu;
const INLINE_AGENCY_BOILER_RE = /(?:^|(?<=[.!?])\s*|\s+)[«"“„]?(?:AZƏRTAC|APA|Trend|Report(?:\.az)?|Oxu\.az|Qafqazinfo|Milli\.az)[»"”]?\s+(?:xəbər\s+verir\s+ki|məlumat\s+verir\s+ki|bildirir\s+ki)\s*,\s*/giu;
const BBC_META_NOISE_RE = /(?:Şəklin\s+mənbəyi,\s*[^\n]{1,40}?(?=Şəklin\s+alt|Müəllif,|Çap\s+edildi)|Şəklin\s+alt\s+yazısı,\s*[^\n]{1,160}?(?=Müəllif,|Çap\s+edildi)|Müəllif,\s*[^\n]{1,45}?Vəzifə,\s*BBC\s+[A-Za-zəöüğçşı]+|Müəllif,\s*BBC\s+News\s+Azərbaycanca|Çap\s+edildi\s*\d{1,2}\s*[A-Za-zəöüğçşı]+\s*\d{4}|Oxuma\s+vaxtı:\s*\d+\s*dəq|BBC\s+News\s+Azərbaycanca\s+Xidmətinin\s+hazırladığı[^.\n]*izləyin\.?\s*(?:Qoşulmaq\s+üçün\s+linkə\s+klikləyin\.?)?)/giu;

// Brave / axtarış mühərriki xəbərdarlıq və nisbi tarix önlükləri ("2 həftə öncə - AI can make mistakes...")
const SEARCH_ENGINE_NOISE_RE = /^(?:\d+\s+(?:saat|gün|həftə|ay|il|dəqiqə|hours?|days?|weeks?|months?|years?|minutes?)\s+(?:öncə|əvvəl|ago)\s*[-·–—]\s*)?(?:AI can make mistakes[^.]*\.\s*(?:\.{2,}\s*)?)?/iu;

const AD_PROMO_URL_RE = /https?:\/\/(?:[^\s/]*\.)?(?:doubleclick\.net|googlesyndication\.com|googleadservices\.com|adservice\.google\.[a-z.]+|bit\.ly|tinyurl\.com|cutt\.ly|clck\.ru|adf\.ly|t\.me\/(?:\+|joinchat)|wa\.me\/|chat\.whatsapp\.com)[^\s)]*/gi;
const TRACKING_QS_RE = /(https?:\/\/[^\s?#]+)\?(?:utm_[^&\s]+|fbclid=[^&\s]+|gclid=[^&\s]+|yclid=[^&\s]+|at_medium=[^&\s]+)(?:&[^\s)]*)?/gi;

const AZ_NEWS_LEAD_RE = /^(?:["«„]?\s*)?(?:Bakı,\s*\d{1,2}\s+[a-zəöüğçşı]+,\s*AZƏRTAC\s*[.!-]?\s*)?(?:[A-ZƏÖÜĞÇŞİa-zəöüğçşı0-9_-]+\.(?:az|com|ws|info|net|org|tv)\b[\s,:-]*)?(?:[A-ZƏÖÜĞÇŞİa-zəöüğçşı0-9."«»\s-]{2,45}?\bistinadən\s+)?(?:[A-ZƏÖÜĞÇŞİa-zəöüğçşı0-9_-]+\.(?:az|com|ws|info|net|org|tv)\s+)?(?:xəbər\s+verir\s+ki|məlumat\s+verir\s+ki|bildirir\s+ki)\s*[,:-]?\s*/iu;

const PROMO_LINE_RE = /(?:bizi\s+(?:telegram|instagram|facebook|tiktok|youtube|whatsapp)[-\sdaə]*\s*izləyin|(?:telegram|whatsapp)\s+kanalımız[aıdən\s]*(?:abunə|qoşulun|izləyin)|qoşulmaq\s+üçün\s+linkə\s+klikləyin|kanala\s+abunə\s+olun|həmçinin\s+oxuyun\s*:|oxşar\s+xəbərlər\s*:|daha\s+ətraflı\s+videoda|reklam\s+yerləşdirmək\s+üçün)/iu;

// v18: Diakritiksiz (ş, ə, ç, ğ, ö, ü yazılmayan) azərbaycanca yazılışın bərpası.
// DeepSeek-in təklif etdiyi SymSpell/SSAZ/embedding stack-i Vercel-də işləmir (Python + 120–470MB model),
// ona görə burada 0 asılılıqlı, kiçik lüğət + şəkilçi açma üsulu istifadə olunur.
const ASCII_AZ_STRONG = {
  // sual / qarışıq sözlər
  gozel: "gözəl", sheher: "şəhər", sheherler: "şəhərlər", sheheri: "şəhəri",
  seher: "şəhər", seherler: "şəhərlər", chox: "çox", cox: "çox", choxlu: "çoxlu",
  isdifade: "istifadə", istifade: "istifadə", isdifadesi: "istifadəsi", istifadesi: "istifadəsi",
  isdifadeci: "istifadəçi", istifadeci: "istifadəçi", edilen: "edilən", edilmis: "edilmiş",
  olunan: "olunan", hansi: "hansı", hansilar: "hansılar", hansilari: "hansıları",
  harda: "harada", haradan: "haradan", haqqinda: "haqqında", hakda: "haqqında", haqda: "haqqında",
  melumat: "məlumat", melumatlar: "məlumatlar", melumati: "məlumatı", melumatli: "məlumatlı",
  xeber: "xəbər", xeberler: "xəbərlər", xeberi: "xəbəri", yenilik: "yenilik", yenilikler: "yeniliklər",
  sayt: "sayt", saytlar: "saytlar", saytlari: "saytları", saytlarin: "saytların", saytlarinin: "saytlarının",
  sehife: "səhifə", sehifeler: "səhifələr", sehifesi: "səhifəsi",
  yaxsi: "yaxşı", yaxsisi: "yaxşısı", pis: "pis", boyuk: "böyük", kicik: "kiçik",
  qiymet: "qiymət", qiymeti: "qiyməti", qiymetler: "qiymətlər", ucuz: "ucuz", baha: "baha",
  olke: "ölkə", olkeler: "ölkələr", olkesi: "ölkəsi", olkede: "ölkədə", olkenin: "ölkənin",
  dunya: "dünya", dunyada: "dünyada", dunyanin: "dünyanın", xalq: "xalq", xalqlari: "xalqları",
  ehali: "əhali", ehalisi: "əhalisi", ahalisi: "əhalisi", paytaxt: "paytaxt", paytaxti: "paytaxtı",
  tarix: "tarix", tarixi: "tarixi", tarixde: "tarixdə", muellim: "müəllim", telebe: "tələbə",
  kitab: "kitab", kitablar: "kitablar", kitabi: "kitabı", mahni: "mahnı", mahnilar: "mahnılar",
  oyun: "oyun", oyunlar: "oyunlar", oyunu: "oyunu", film: "film", filmler: "filmlər", filmlər: "filmlər",
  sirket: "şirkət", sirketi: "şirkəti", dovlet: "dövlət", dovleti: "dövləti", devlet: "dövlət",
  xidmet: "xidmət", xidmeti: "xidməti", xidmetler: "xidmətlər", xidmetleri: "xidmətləri",
  versiya: "versiya", versiyasi: "versiyası", limit: "limit", limiti: "limiti",
  reytinq: "reytinq", reytinqi: "reytinqi", siyahi: "siyahı", siyahisi: "siyahısı",
  movzu: "mövzu", movzusu: "mövzusu", sual: "sual", cavab: "cavab", misal: "misal",
  azerbaycan: "Azərbaycan", azerbaycanda: "Azərbaycanda", azerbaycanin: "Azərbaycanın",
  azerbaycanli: "azərbaycanlı", bakida: "Bakıda", bakinin: "Bakının", baki: "Bakı",
  turkiye: "Türkiyə", turkiyede: "Türkiyədə", turkce: "türkcə", rusca: "rusca",
  ingilisce: "ingiliscə", azerbaycanca: "azərbaycanca", ingilis: "ingilis", rus: "rus",
  avropa: "Avropa", avropada: "Avropada", amerika: "Amerika", asiya: "Asiya",
  nece: "necə", necedir: "necədir", niye: "niyə", nedir: "nədir", neler: "nələr",
  hansilardi: "hansılardır", hansilardir: "hansılardır", hansidir: "hansıdır",
  ucundu: "üçündür", ucundur: "üçündür", lazimdi: "lazımdır", lazim: "lazım",
  meslehet: "məsləhət", meslehetler: "məsləhətlər",
  yemek: "yemək", yemekler: "yeməklər", yemeyi: "yeməyi", resept: "resept", reseptler: "reseptlər",
  tovsiye: "tövsiyə", tovsiyeler: "tövsiyələr", tovsiyesi: "tövsiyəsi",
  idman: "idman", idmanda: "idmanda", idmanci: "idmançı",
  gore: "görə", qeder: "qədər", evvel: "əvvəl", sonra: "sonra", bugun: "bugün",
  dunen: "dünən", sabah: "sabah", indi: "indi", hefte: "həftə", ay: "ay", gun: "gün",
  deqiqe: "dəqiqə", soz: "söz", sozler: "sözlər", sozluk: "sözlük", cumle: "cümlə",
  tercume: "tərcümə", tercemesi: "tərcüməsi", tercumeci: "tərcüməçi",
  isdifadeetme: "istifadəetmə", secim: "seçim", secimler: "seçimlər", netice: "nəticə",
  neticeler: "nəticələr", sebeb: "səbəb", sebebi: "səbəbi", coxusu: "çoxusu",
  muqayise: "müqayisə", ehtiyac: "ehtiyac", imkan: "imkan", imkanlari: "imkanları",
  axtaris: "axtarış", axtarmaq: "axtarmaq", tapmaq: "tapmaq", oxumaq: "oxumaq",
  yazmaq: "yazmaq", gondermek: "göndərmək", gonderen: "göndərən",
  muraciet: "müraciət", resmi: "rəsmi", resmî: "rəsmi", sened: "sənəd", senedler: "sənədlər",
  qanun: "qanun", qanunu: "qanunu", vergi: "vergi", vergisi: "vergisi", emek: "əmək",
  emekdas: "əməkdaş", isci: "işçi", isciler: "işçilər", ise: "işə", isi: "işi",
  elmi: "elmi", tehsil: "təhsil", tehsili: "təhsili", mekteb: "məktəb", mektebi: "məktəbi",
  hekim: "həkim", hekimler: "həkimlər", derman: "dərman", xestelik: "xəstəlik",
  xeberdarliq: "xəbərdarlıq", hesab: "hesab", hesabi: "hesabı", hesablar: "hesablar"
};
// Yalnız güclü AZ siqnalı olduqda bərpa olunan qısa/qarışıq sözlər (ingiliscə də ola bilər)
const ASCII_AZ_WEAK = {
  en: "ən", ve: "və", ne: "nə", bir: "bir", var: "var", yox: "yox", cox: "çox",
  oz: "öz", ozu: "özü", ucun: "üçün", da: "da", de: "də", ile: "ilə", her: "hər",
  il: "il", ilin: "ilin", iki: "iki", uc: "üç", dort: "dörd", bes: "beş",
  men: "mən", sen: "sən", biz: "biz", size: "sizə", bunu: "bunu", bele: "belə"
};
const AZ_SUFFIXES = [
  ["larindan", "lərindən"], ["lerinden", "lərindən"], ["larinin", "lərinin"], ["lerinin", "lərinin"],
  ["lardan", "lərdən"], ["lerden", "lərdən"], ["larin", "lərin"], ["lerin", "lərin"],
  ["lara", "lərə"], ["lere", "lərə"], ["larda", "lərdə"], ["lerde", "lərdə"],
  ["lar", "lər"], ["ler", "lər"], ["dan", "dən"], ["den", "dən"], ["da", "də"], ["de", "də"],
  ["nin", "nin"], ["nin", "nin"], ["in", "in"], ["un", "un"], ["un", "ün"], ["i", "i"], ["u", "u"]
];
const EN_STRONG_RE = /(?<![\p{L}])(?:the|what|which|how|why|when|where|who|best|top|is|are|was|were|can|does|do|for|and|with|from|about|new|news|free|online|download|review|reviews|price|buy|cheap|near|me|my|you|your|list|vs|site|sites|website|websites|movie|movies|game|games|weather|translate|translation)(?![\p{L}])/iu;

function matchCase(source, target) {
  if (!source || !target) return target;
  if (source === source.toUpperCase() && source.length > 1) return target.toUpperCase();
  const f = source[0];
  if (f === f.toUpperCase() && f !== f.toLowerCase()) return target[0].toUpperCase() + target.slice(1);
  return target;
}

// Diakritik/diqraf skeleti: "şəhər" → "seher", "yaxşı" → "yaxsi", "sheher" → "seher", "yaxshi" → "yaxsi"
function azSkeleton(w) {
  return w
    .toLowerCase()
    .normalize("NFC")
    .replace(/\u0307/g, "")
    .replace(/sh/g, "s").replace(/ch/g, "c").replace(/zh/g, "j")
    .replace(/[şs]/g, "s").replace(/[çc]/g, "c").replace(/[əea]/g, "e")
    .replace(/[ğg]/g, "g").replace(/[öo]/g, "o").replace(/[üu]/g, "u").replace(/[ıi]/g, "i");
}

const ASCII_AZ_INDEX = (() => {
  const idx = new Map();
  const put = (word) => { const k = azSkeleton(word); if (k.length >= 2 && !idx.has(k)) idx.set(k, word); };
  for (const [k, v] of Object.entries(ASCII_AZ_STRONG)) { idx.set(k, v); put(v); }
  for (const v of Object.values(ASCII_AZ_STRONG)) put(v);
  return idx;
})();

function restoreAsciiWord(lower) {
  if (ASCII_AZ_STRONG[lower]) return ASCII_AZ_STRONG[lower];
  const skel = ASCII_AZ_INDEX.get(azSkeleton(lower));
  if (skel && skel.toLowerCase() !== lower) return skel;
  if (skel && skel.toLowerCase() === lower) return null;
  if (lower.length >= 6) {
    for (const [sfx, repl] of AZ_SUFFIXES) {
      if (!lower.endsWith(sfx)) continue;
      const stem = lower.slice(0, lower.length - sfx.length);
      const baseHit = ASCII_AZ_STRONG[stem] || ASCII_AZ_INDEX.get(azSkeleton(stem));
      if (stem.length >= 4 && baseHit) {
        // səs uyğunluğu: "şəhər"+lər → şəhərlər, "Bakı"+da → Bakıda
        return baseHit + repl;
      }
    }
  }
  return null;
}

/**
 * v18: "qaqa gozel bir sheher harda var" → "qaqa gözəl bir şəhər harada var".
 * Yalnız kifayət qədər güclü AZ siqnalı olanda işə düşür ki, ingiliscə sorğular korlanmasın.
 */
export function restoreAsciiAz(query = "") {
  const s = String(query || "");
  if (!s.trim()) return { text: s, hits: 0, restored: false };
  const tokens = s.split(/(\s+)/);
  let strong = 0;
  let weak = 0;
  for (const t of tokens) {
    if (!t.trim()) continue;
    const key = t.toLowerCase().replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "");
    if (!key || /[əöüğçşı]/iu.test(key)) continue;
    if (ASCII_AZ_STRONG[key] || restoreAsciiWord(key)) strong++;
    else if (ASCII_AZ_WEAK[key]) weak++;
  }
  const enabled = strong >= 1 || (weak >= 2 && !EN_STRONG_RE.test(s));
  if (!enabled) return { text: s, hits: strong + weak, restored: false };
  const out = tokens.map(t => {
    if (!t.trim()) return t;
    // v19: artıq diakritikli yazılmış sözə toxunma! ("neçə" ≠ "necə", "gözəl" olduğu kimi qalır)
    if (/[əöüğçşı]/iu.test(t)) return t;
    const lead = t.match(/^[^\p{L}]*/u)?.[0] || "";
    const trail = t.match(/[^\p{L}]*$/u)?.[0] || "";
    const core = t.slice(lead.length, t.length - trail.length);
    if (!core) return t;
    const lower = core.toLowerCase();
    const hit = restoreAsciiWord(lower) || ASCII_AZ_WEAK[lower];
    if (!hit || hit === lower) return t;
    return lead + matchCase(core, hit) + trail;
  });
  return { text: out.join(""), hits: strong + weak, restored: true };
}

/**
 * v16: Danışıq/klaviatura yazılışlarını ədəbi Azərbaycan dilinə düzəldir ki,
 * həm tərcüməçi ("şəhərdi" -> keçmiş zaman "was" səhvi!), həm də axtarış motorları sualı düz başa düşsün.
 */
export function normalizeColloquialAz(query = "") {
  let s = String(query || "").trim();
  if (!s) return "";
  // v18: əvvəlcə diakritiksiz yazılışı bərpa et (sheher → şəhər), sonra danışıq qaydaları işləsin.
  // Qoruyucu: sırf türkcə siqnalı olan sorğunu ("en iyi filmler") azərbaycancaya çevirmə!
  const trOnly = TR_ASCII_RE.test(s) && !AZ_ASCII_RE.test(s) && !AZ_SPECIFIC_RE.test(s);
  if (!trOnly) s = restoreAsciiAz(s).text;
  const wb = (pat) => new RegExp(`(?<![\\p{L}])(?:${pat})(?![\\p{L}])`, "giu");
  s = s
    .replace(wb("isdifadə|isdifade|istifafə|istifafe"), "istifadə")
    .replace(wb("cox"), "çox")
    .replace(wb("coxlu"), "çoxlu")
    .replace(wb("hakda|haqda|hakkında|hakkinda"), "haqqında")
    .replace(wb("bidənə|bidene"), "bir dənə")
    .replace(wb("tərçümə|tərçemə|tərcemə|terçüme|terceme"), "tərcümə")
    .replace(wb("tərçüməçi|tərçeməçi"), "tərcüməçi")
    .replace(wb("lahiyə|lahiye|layihe"), "layihə")
    .replace(wb("lahiyələr|lahiyeler|layiheler"), "layihələr")
    .replace(wb("papuqay|papuqayi|papuqayı|papuqaylar|papuqayların|papuqaylarin"), "tutuquşu")
    .replace(wb("flim"), "film")
    .replace(wb("flimi"), "filmi")
    .replace(wb("flimlər"), "filmlər")
    .replace(wb("flimler"), "filmler")
    .replace(wb("mənçə"), "məncə")
    .replace(wb("nətiçə"), "nəticə")
    .replace(wb("ingilisçə"), "ingiliscə")
    .replace(wb("azərbaycança"), "azərbaycanca")
    .replace(wb("türkçə"), "türkcə")
    .replace(wb("rusça"), "rusca")
    .replace(wb("yutub"), "YouTube")
    .replace(wb("vatsap"), "WhatsApp")
    .replace(wb("instaqram"), "Instagram")
    .replace(wb("teleqram"), "Telegram")
    .replace(wb("səhərdi|şəhərdi"), "şəhərdir")
    .replace(wb("ölkədi"), "ölkədir")
    .replace(wb("dövlətdi"), "dövlətdir")
    .replace(wb("nədi"), "nədir")
    .replace(wb("nələrdi"), "nələrdir")
    .replace(wb("kimdi"), "kimdir")
    .replace(wb("kimlərdi"), "kimlərdir")
    .replace(wb("hardadı|haradadı"), "haradadır")
    .replace(wb("haralıdı"), "haralıdır")
    .replace(wb("hansıdı"), "hansıdır")
    .replace(wb("hansılardı"), "hansılardır")
    .replace(wb("üçündü|ucundu"), "üçündür")
    .replace(wb("lazımdı"), "lazımdır")
    .replace(wb("yaxşıdı"), "yaxşıdır")
    .replace(wb("pisdi"), "pisdir")
    .replace(wb("necədi"), "necədir")
    .replace(wb("neçədi"), "neçədir")
    .replace(wb("neçəyədi"), "neçəyədir");
  return s;
}

function letterCount(s) {
  let n = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) ||
        (c >= 0xc0 && c <= 0x24f) || (c >= 0x400 && c <= 0x4ff) ||
        (c >= 0x100 && c <= 0x17f) || (c >= 0x180 && c <= 0x24f)) n++;
  }
  return n;
}

const AZ_TR_BOILERPLATE = /^(Mənbələr|Mənbə|Mətnin mənbələri|İstinadlar|Bax:|Bax da|Bax\b|Görüntülər|Maraqlı faktlar|Xarici keçidlər|Kategoriyalar?|Related|References|Bibliography|See also|Further reading|External links|Notes|Table of contents|İçindəkilər|İçəridəkilər|Menu|Ana səhifə|Edit this page|Share|Reklamlar|Reklam|Cookie|Cookies|Abunə ol|Subscribe|Advertisement|Sponsored|Official website|Video service)\s*:?$/i;

function isWordSaladLine(s) {
  const words = s.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu);
  if (!words || words.length < 8) return false;
  const uniq = new Set(words);
  return uniq.size / words.length < 0.38;
}

function isJunkLine(s) {
  if (!s) return true;
  const n = s.length;
  if (n < 1) return true;
  if (/^[|\-=_*]{3,}$/.test(s)) return true;
  let pipes = 0;
  for (const ch of s) if (ch === "|") pipes++;
  if (pipes >= 3) return true;
  // v118: boşluqsuz birləşmiş BÖYÜK HƏRFLİ menyu ("GÜNDEMDÜNYABİGPARA ANASAYFABORSADÖVİZ...") —
  // 18+ ardıcıl böyük hərfdən ibarət 3 və ya daha çox söz real mətndə praktiki olaraq olmur.
  if (n >= 60 && (s.match(/\p{Lu}{18,}/gu) || []).length >= 3) return true;
  if (n >= 3 && n <= 25 && /^[\d\s/.:;\-–—()]+$/.test(s)) return true;
  if (n >= 5 && letterCount(s) / n < 0.2) return true;
  if (n < 60 && AZ_TR_BOILERPLATE.test(s)) return true;
  if (n < 160 && PROMO_LINE_RE.test(s)) return true;
  if (isWordSaladLine(s)) return true;
  if (s.startsWith("\u00A9") || s.startsWith("(c)")) return true;
  // v124: müəllif hüququ / istifadə qadağası bəyanatı ("... izin alınmadan, kaynak gösterilse dahi iktibas edilemez, kopyalanamaz")
  if (n < 600 && COPYRIGHT_NOTICE_RE.test(s)) return true;
  return false;
}

function stripNewsLeadIn(line) {
  let s = line.replace(SEARCH_ENGINE_NOISE_RE, "").replace(DATELINE_RE, "").trim();
  const stripped = s.replace(AZ_NEWS_LEAD_RE, "");
  if (stripped === s) return s;
  if (stripped.length < 15) return "";
  return stripped[0].toUpperCase() + stripped.slice(1);
}

// v124: hüquqi bəyanat sətirləri. "izin alınmadan" tək işlənəndə real xəbər ola bilər ("izin alınmadan inşaat yapıldı"),
// ona görə yalnız qadağa fellərinin (kopyalanamaz/yayınlanamaz…) yanında sayılır.
const COPYRIGHT_NOTICE_RE = new RegExp([
  "izin\\s+alınmadan[^.]{0,140}(?:kopyalanamaz|yayınlanamaz|kullanılamaz|çoğaltılamaz|iktibas\\s+edilemez)",
  "kaynak\\s+gösterilse\\s+dahi[^.]{0,80}(?:iktibas|kopyala|yayın)",
  "tüm\\s+hakları\\s+saklıdır", "hakları\\s+saklıdır",
  "все\\s+права\\s+защищены", "любое\\s+использование\\s+материалов", "перепечатка\\s+материалов",
  "bütün\\s+hüquqlar\\s+qorunur", "materiallardan\\s+istifadə\\s+zamanı[^.]{0,80}mənbə",
  "all\\s+rights\\s+reserved", "may\\s+not\\s+be\\s+reproduced"
].join("|"), "iu");

// v38: yalnız "Həmçinin bax / İstinadlar / Copyright" qalmış content faydalı deyil
const BOILER_ONLY_RE = /(?<![\p{L}])(həmçinin bax|hemcinin bax|istinadlar|mənbələr|xarici keçidlər|kateqoriyalar|see also|references|external links|copyright|©|bütün hüquqlar qorunur|all rights reserved)(?![\p{L}])/iu;
// v39.5: mətn "Həmçinin bax / © Copyright / İstinadlar" başlığından başlayırsa,
// həqiqi cümləyə qədər baş hissəni kəs (Vikipediya naviqasiya qutusu, sayt footer-i)
export function stripBoilerplateHead(text = "") {
  let t = String(text || "").trim();
  for (let k = 0; k < 3; k++) {
    const head = t.slice(0, 240);
    if (!isBoilerplateOnly(head)) break;
    // 240-dan sonrakı ilk cümlə sərhədini tap
    const rest = t.slice(240);
    const m = rest.match(/(?<=[.!?])\s+/);
    if (!m) { t = rest.trim(); break; }
    t = rest.slice(m.index + m[0].length).trim();
    if (t.length < 80) break;
  }
  return t;
}

export function isBoilerplateOnly(text = "") {
  const t = String(text || "").trim();
  if (t.length > 400) return false;
  const stripped = t.replace(BOILER_ONLY_RE, " ").replace(/[\s\p{P}\p{N}]+/gu, "");
  return stripped.length < 60; // boilerplate çıxandan sonra məna qalmır
}

export function cleanContent(text = "") {
  let t = cleanNavigationAndRepeats(String(text || ""));
  if (!t.trim()) return "";
  t = t.replace(WIKILINK_RE, (_, a, b) => (b || a || "").trim());
  t = t.replace(CITATION_RE, " ").replace(WIKI_INLINE_RE, " ");
  t = t.replace(IPA_BRACKET_RE, " ").replace(AUDIO_ICON_RE, " ");
  t = t.replace(BBC_META_NOISE_RE, " ").replace(INLINE_AGENCY_BOILER_RE, " ");
  t = t.replace(BROKEN_PAREN_RE, (_, inner) => inner && inner.trim() ? `(${inner.trim()})` : " ");
  t = t.replace(EMPTY_PAREN_RE, " ");
  t = t.replace(AD_PROMO_URL_RE, " ");
  t = t.replace(TRACKING_QS_RE, "$1");
  // v21.2: sətir daxilindəki simvol "zibili" (||| ~~~ === ...) tək-tək silinsin —
  // bütöv sətri atmayaq (içində real fakt "2,3 milyon" qalmalıdır). Kod (`a === b`) toxunulmaz.
  t = t.replace(/(?:^|(?<=\s))[|~=_*]{2,}(?=\s|$)/gm, " ").replace(/(?:^|(?<=\s))\.{3,}(?=\s|$)/gm, " ");
  const kept = [];
  let prev = null;
  const seenLongLines = new Set();
  for (const raw of t.split("\n")) {
    let ln = raw.trim().replace(/\s{2,}/g, " ").trim();
    ln = stripNewsLeadIn(ln).trim();
    // v20: reklam/promo cümləsi BÜTÜN sətri yox, yalnız özünü aparsın
    // ("...12 ölkənin nümayəndəsi iştirak edib. // Bizi Telegram kanalımızda izləyin." → xəbər qalsın)
    if (PROMO_LINE_RE.test(ln)) {
      const parts = ln.split(/(?<=[.!?…])\s+/).map(x => x.trim()).filter(Boolean);
      const survivors = parts.filter(x => !PROMO_LINE_RE.test(x) && !isJunkLine(x));
      if (!survivors.length) continue;
      ln = survivors.join(" ");
    }
    if (isJunkLine(ln)) continue;
    if (ln === prev) continue;
    if (ln.length >= 20) {
      const fp = ln.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
      if (fp.length >= 15) {
        if (seenLongLines.has(fp)) continue;
        seenLongLines.add(fp);
      }
    }
    prev = ln;
    kept.push(ln);
  }
  return kept.join("\n").replace(/ {2,}/g, " ").trim();
}

export function pickAnswer(text = "", query = "", maxChars = 320) {
  const t = cleanContent(text);
  if (!t) return "";
  const lines = t.split(/\n+/).map(s => s.trim()).filter(Boolean);
  let sents = [];
  for (const ln of lines) {
    sents.push(...ln.split(/(?<=[.!?…])\s+(?=[A-ZƏÖÜĞÇŞİ0-9"«(‘'])/).map(s => s.trim()));
  }
  sents = sents.filter(s => s.length >= 20 && s.length <= 600);
  if (!sents.length) return t.slice(0, maxChars);
  const qTerms = [...new Set(tokenize(query))];
  if (!qTerms.length) return sents[0].slice(0, maxChars);
  const qGrams = new Map(qTerms.map(qt => [qt, trigrams(qt)]));
  let best = null, bestScore = -1;
  for (const s of sents) {
    const sTerms = new Set(tokenize(s));
    let sc = 0;
    for (const qt of qTerms) {
      if (sTerms.has(qt)) { sc += 2; continue; }
      let fb = 0;
      const grams = qGrams.get(qt);
      for (const st of sTerms) {
        const sim = trigramSimilarity(qt, st, grams);
        if (sim > fb) fb = sim;
      }
      if (fb >= 0.7) sc += 1;
    }
    if (sc > bestScore) { bestScore = sc; best = s; }
  }
  if (!best || bestScore <= 0) {
    best = sents.reduce((a, b) => (a.length >= b.length ? a : b));
  }
  return best.slice(0, maxChars);
}

const AZ_CITIES = "bak[ıi]|susa|gence|sumqay[ıi]t|lenkeran|mingecevir|naxc[ıi]van|qebele|qusar|xacmaz|quba|salyan|agcabedi|berde|goycay|goycey|imisli|zerdab|haciqabul|agstafa|astara|ismayilli|goranboy|sabran|xocali|xocavend|serur|ordubad|culfa|babek|masalli|yardimli|celilabad|bilesuvar|neftcala|qazax|tovuz|gedebey|samux|qax|oyuq|zengilan|fuzuli|cebrayil|kelbecer|lacin|semkir|sederek|sirvan|xizi|naftalan|qobustan|zaqatala|balaken|agdas|beyleqan|daskesen|kurdemir|samaxi|yevlax|goygol|xankendi|siyezen|terter|qivraq"
const AZ_LEXICON = "mahni[\\p{L}]*|seyahet[\\p{L}]*|geyim[\\p{L}]*|saglamliq[\\p{L}]*|xestelik[\\p{L}]*|kitab[\\p{L}]*|mekteb[\\p{L}]*|muellim[\\p{L}]*|imtahan[\\p{L}]*|catdirilma[\\p{L}]*|sifaris[\\p{L}]*|endirim[\\p{L}]*|tehsil[\\p{L}]*|islek[\\p{L}]*|qiymet[\\p{L}]*|olcu[\\p{L}]*|reng[\\p{L}]*|sozluk[\\p{L}]*|stansiya[\\p{L}]*|metropoliten[\\p{L}]*|universitet[\\p{L}]*|kitabxana[\\p{L}]*|muzey[\\p{L}]*|nazirlik[\\p{L}]*|muessise[\\p{L}]*|telebe[\\p{L}]*";
// v45: söz sərhədi — "bakımı"(TR) Bakı deyil, "indirim"(TR) indi deyil.
// Şəhər yalnız AZ şəkilçiləri ilə uzana bilər.
const AZ_SHORT = "seki|quba|ucar|agsu|lerik|xizi|qax|sirvan|agdam|samux|qivraq";
const AZ_SUFFIX = "(?:lar|ler|lari|leri|da|de|dan|den|daki|deki|nin|nun|a|e|ya|ye|i|u|inda|inde|daki|deki|li|siz)?";
const AZ_WORDS = "haqq[ıi]nda|hakda|haqda|hans[ıi][\\p{L}]*|üçün|ucun|q[ıi]z[ıi]l|limiti|necə|nece|nədir|nedir|harada|harda|niyə|niye|sayt[\\p{L}]*|şəhər[\\p{L}]*|xəbər[\\p{L}]*|xeber[\\p{L}]*|yemək[\\p{L}]*|tər[cç][üu]mə|bu\\s+gün|son\\s+xəbər|manat";
const AZ_SPECIFIC_RE = new RegExp(`(?<![\\p{L}])(?:(?:${AZ_CITIES})${AZ_SUFFIX}|(?:${AZ_SHORT})(?:lar|ler|da|de|dan|den|daki|deki|nin|nun|ya|ye|inda|inde)|(?:${AZ_LEXICON})|(?:${AZ_WORDS}))(?![\\p{L}])|[qxQX]|ə`, "iu");
const TR_ASCII_RE = /\b(?:en\s+iyi|nasil|nerede|nereden|neden|hangi|hangisidir|hangileri|icin|filmler|flimler|diziler|dizi|izle|oyunlar|siteler|turkiye|haberler|haber|fiyat|fiyatlari|satilik|indir|yemek|tarif|kac|kactir)\b/i;
const AZ_ASCII_RE = /\b(?:bakida|baki|azerbaycan\w*|haqqinda|hakda|haqda|hansilardir|hansilardi|hansilar|hansi|mezennesi|limiti|qiymeti|necedir|nece|niye|nedir|kimdir|kimin|hara|haraya|lazimdi|varmi|xeberler|xeber|saytlar\w*|tercume|ucun|ucundur|ucundu|yaxsi|yemek\w*|idman\w*|reytingi|udubmu|uduzubmu|uduzdu|oyununu|oyunun\w*|matc\w*|hesab\w*|komanda\w*|cempion\w*|qol\w*)\b/i;

export function detectQueryLanguage(query = "") {
  const q = String(query || "");
  if (q.includes("\u0259") || q.includes("\u018f")) return "az";
  if (/[\u0400-\u04ff]{2,}/.test(q)) return "ru";
  // v41: fr/es/de/pt — "meilleurs films français" TÜRK dili deyil (ç hərfi tuzaq idi)
  const FR = /(?<![\p{L}])(le|la|les|des|du|une|pour|avec|dans|meilleurs?|meilleures?|films?|français|aujourd|hui|recettes?|séries?|chansons?|voitures?|voyage|cuisine|monde|histoire|par|sur|et)(?![\p{L}])/iu;
  const ES = /(?<![\p{L}])(el|los|las|para|con|una|unos|hoy|mejores?|películas?|noticias|recetas?|canciones?|series?|juegos?|coches?|cómo|por|del|que|más)(?![\p{L}])/iu;
  const DE = /(?<![\p{L}])(der|die|das|und|für|mit|nicht|heute|aktuell|nachrichten|besten|filme|serien|rezepte|wie|ist|auf|im)(?![\p{L}])/iu;
  const PT = /(?<![\p{L}])(não|uma|para|com|hoje|melhores|filmes|notícias|receitas|como)(?![\p{L}])/iu;
  if (/[éèêàâûôîœç]/iu.test(q) && FR.test(q) && !/[ığ]/u.test(q)) return "fr";
  if (/[ñ¿¡]/u.test(q) || (ES.test(q) && !/[əığş]/u.test(q))) return "es";
  if (/[ßä]/u.test(q) || (DE.test(q) && !/[əığş]/u.test(q))) return "de";
  if (/[ãõ]/u.test(q) || (PT.test(q) && !/[əığş]/u.test(q))) return "pt";
  if (/[şğüöİı]/u.test(q)) {
    const qf = normalizeAz(q);
    if (AZ_SPECIFIC_RE.test(q) || AZ_SPECIFIC_RE.test(qf)) return "az";
    return "tr";
  }
  if (AZ_ASCII_RE.test(q)) return "az";
  // v41.1: diakritiksiz latın dilləri — söz siyahısı ilə (>=2 uyğunluq tələb olunur)
  const W = {
    fr: /(?<![\p{L}])(meilleur\w*|tendances?|femme|homme|chaussures?|sacs?|bijoux|vacances|recettes?|cuisine|monde|histoire|films?|séries?|chansons?|voitures?|voyage|pour|avec|les|des|une|dans|aujourd|hui)(?![\p{L}])/giu,
    es: /(?<![\p{L}])(mejores?|tendencias?|mujer|hombre|zapatos|vacaciones|recetas?|comida|viaje|salud|ejercicios?|películas?|canciones?|juegos?|coches?|para|con|los|las|del|hoy|como)(?![\p{L}])/giu,
    de: /(?<![\p{L}])(besten?|trends?|frauen|männer|schuhe|rezepte?|küche|reise|urlaub|filme|serien|nachrichten|für|mit|der|die|das|und|heute|wie)(?![\p{L}])/giu,
    tr: /(?<![\p{L}])(en\s+iyi|filmler|diziler|oyunlar|tarifler|şarkılar|haberler|fiyatlar|nasıl|için|ile|bir|ve|bugün|moda)(?![\p{L}])/giu,
    az: /(?<![\p{L}])(ən\s+yaxşı|filmlər|seriallar|oyunlar|reseptlər|mahnılar|xəbərlər|qiymətlər|necə|üçün|ilə|bir|və|bu\s+gün|moda|təhsil|səyahət)(?![\p{L}])/giu
  };
  let bestW = null, bestN = 1;
  for (const [k, re] of Object.entries(W)) {
    const n = (q.match(re) || []).length;
    if (n > bestN) { bestN = n; bestW = k; }
  }
  if (bestW) return bestW;
  if (TR_ASCII_RE.test(q)) return "tr";
  // v18: "qaqa gozel bir sheher harda var" kimi diakritiksiz AZ yazılışı ingilis kimi oxunmasın
  const asciiAz = restoreAsciiAz(q);
  if (asciiAz.restored) return "az";
  return "en";
}

export function acceptLanguageHeader(lang = "az") {
  if (lang === "fr") return "fr-FR,fr;q=0.95,en-US;q=0.5,en;q=0.4";
  if (lang === "es") return "es-ES,es;q=0.95,en-US;q=0.5,en;q=0.4";
  if (lang === "de") return "de-DE,de;q=0.95,en-US;q=0.5,en;q=0.4";
  if (lang === "pt") return "pt-PT,pt;q=0.95,en-US;q=0.5,en;q=0.4";
  if (lang === "tr") return "tr-TR,tr;q=0.95,en-US;q=0.6,en;q=0.5";
  if (lang === "ru") return "ru-RU,ru;q=0.95,en-US;q=0.5,en;q=0.4";
  if (lang === "en") return "en-US,en;q=0.95";
  return "az-AZ,az;q=0.95,tr-TR;q=0.75,en-US;q=0.5,en;q=0.4";
}

export function wikiExtractUrl(url) {
  try {
    const u = new URL(url);
    const m = u.hostname.match(/^([a-z-]{2,})\.wikipedia\.org$/i);
    if (!m) return null;
    if (!u.pathname.startsWith("/wiki/") || u.pathname.length <= 6) return null;
    let title;
    try { title = decodeURIComponent(u.pathname.slice(6)).replace(/_/g, " ").trim(); } catch { return null; }
    if (!title) return null;
    if (/^(File|Fayl|Wikipediya|Vikipediya|Wikipedia|Category|Kategori|Kategoriya|Help|Help:|Portal|Template|Şablon|MediaWiki|Spesial|Special|Media|File|Fayl):/i.test(title)) return null;
    const lang = m[1].toLowerCase();
    return `https://${lang}.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&exsectionformat=plain&redirects=1&format=json&titles=${encodeURIComponent(title)}`;
  } catch {
    return null;
  }
}

export function cutWord(text, max = 200) {
  const s = String(text || "");
  if (s.length <= max) return s;
  const sliced = s.slice(0, max);
  const lastSpace = sliced.lastIndexOf(" ");
  const cut = (lastSpace > 40 ? sliced.slice(0, lastSpace) : sliced).trimEnd();
  return cut + "…";
}

export function dedupeSnippet(snippet, content) {
  if (!snippet) return undefined;
  const s = String(snippet).trim();
  if (!s) return undefined;
  if (!content) return s;
  const c = String(content).trim();
  if (s === c) return undefined;
  const norm = (x) => x
    .replace(/^(?:\d{1,2}\s+[\p{L}]+\s+\d{4}|[\p{L}]+\s+\d{1,2},\s*\d{4})\s*[-·–—]\s*/iu, "")
    .replace(/[.…\s]+$/u, "")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
  const ns = norm(s);
  const nc = norm(c);
  if (!ns) return undefined;
  if (nc.startsWith(ns) || ns.startsWith(nc)) return undefined;
  const probe = ns.slice(0, Math.min(85, ns.length));
  if (probe.length >= 25 && nc.includes(probe)) return undefined;
  return s;
}

// v120: BLOKLAMA / İCAZƏSİZ GİRİŞ səhifələri ("Доступ ограничен", "Access denied", "Erişim engellendi").
// Əvvəl yalnız JS/Cloudflare challenge səhifələri tutulurdu; bloklama mesajı olan səhifə nəticə kimi qayıdırdı.
// Qaydalar (yanlış-müsbəti azaltmaq üçün):
//  - STRONG ifadələr (səhifəyə girişi rədd edən tam cümlələr) yalnız QISA mətndə (<=900 simvol) sayılır;
//  - TITLE_ONLY: başlıq BÜTÖVLÜKLƏ bloklama mesajıdırsa ("Доступ ограничен") — xəbər başlığı ("Twitter'a erişim engellendi")
//    və ya "Access denied for journalists..." kimi başlıq tutulmur.
const BLOCK_STRONG_RE = new RegExp([
  "access\\s+denied", "unauthori[sz]ed\\s+access\\s+(?:is\\s+)?(?:prohibited|forbidden|not\\s+(?:allowed|permitted))",
  "you\\s+(?:have\\s+been|are)\\s+blocked", "request\\s+(?:has\\s+been\\s+)?blocked", "403\\s+forbidden",
  "verify\\s+you\\s+are\\s+(?:a\\s+)?human", "are\\s+you\\s+a\\s+robot", "unusual\\s+traffic\\s+from\\s+your",
  "несанкционированный\\s+доступ\\s+(?:запрещ[её]н|воспрещ[её]н)", "подтвердите,?\\s+что\\s+вы\\s+не\\s+робот",
  "доступ\\s+к\\s+(?:этой|данной)\\s+(?:странице|сайту|ресурсу)\\s+(?:ограничен|запрещ[её]н|закрыт)", "вам\\s+отказано\\s+в\\s+доступе",
  "eri[şs]iminiz\\s+engellendi", "bu\\s+sayfaya\\s+eri[şs]im\\s+yetkiniz\\s+yok", "yetkisiz\\s+eri[şs]im\\s+yasakt[ıi]r", "eri[şs]im\\s+reddedildi",
  "giriş\\s+qadağandır", "bu\\s+səhifəyə\\s+giriş\\s+məhduddur", "icazəsiz\\s+giriş\\s+qadağandır", "girişiniz\\s+bloklanıb"
].join("|"), "iu");
const BLOCK_TITLE_ONLY_RE = new RegExp("^\\s*(?:" + [
  "access\\s+denied", "forbidden", "blocked", "403(?:\\s+forbidden)?", "attention\\s+required!?(?:\\s*\\|\\s*cloudflare)?", "just\\s+a\\s+moment\\.{0,3}",
  "доступ\\s+(?:ограничен|запрещ[её]н|заблокирован)", "eri[şs]im\\s+engellendi", "giriş\\s+məhduddur"
].join("|") + ")[\\s.!:\\-–—]*$", "iu");

export function isBlockPageText(text = "", title = "") {
  const ti = String(title || "").trim();
  if (ti && ti.length <= 80 && BLOCK_TITLE_ONLY_RE.test(ti)) return true;
  const t = String(text || "").trim();
  if (!t || t.length > 900) return false;
  return BLOCK_STRONG_RE.test(t);
}
