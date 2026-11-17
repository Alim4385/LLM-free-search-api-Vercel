// v39: tip-üzrə retrieval router.
// Sualın NÖVÜNÜ müəyyən edir və həmin növə uyğun mənbə strategiyası qaytarır.
// Bu qat axtarışı yönləndirir (site hint + bonus), skor regex-i deyil.

export const AZ_OFFICIAL = [
  "e-qanun.az", "supremecourt.gov.az", "constcourt.gov.az", "edu.gov.az",
  "stat.gov.az", "economy.gov.az", "taxes.gov.az", "president.az",
  "azerbaijan.az", "mfa.gov.az", "cbar.az", "eco.gov.az",
  "sosial.gov.az", "e-qanun", "mincom.gov.az", "health.gov.az"
];

// v53: tanınmış, HTML/RSS-i açıq olan Azərbaycan xəbər mənbələri.
// "Axtardığım xəbərdə düzgün sayt gəlmirdi" probleminin səbəbi örtük idi:
// xəbər sorğularında site-hədəfli cəhd YOX İDİ (yalnız hüquq/təhsil/iqtisad üçün var idi).
export const AZ_NEWS_TRUSTED = [
  "azertag.az", "report.az", "apa.az", "trend.az", "oxu.az", "azadliq.org",
  "turan.az", "news.milli.az", "qafqazinfo.az", "azernews.az", "calibri.az",
  "1news.az", "moderator.az", "sia.az", "azvision.az", "cbc.az", "aztv.az",
  "xezerxeber.az", "astna.az", "interaz.az", "baku.ws", "az.baku.ws"
];

export function newsTrustBoost(url = "") {
  let host = "";
  try { host = new URL(String(url || "")).hostname.toLowerCase().replace(/^www\./, ""); } catch { return 0; }
  for (const d of AZ_NEWS_TRUSTED) if (host === d || host.endsWith("." + d)) return 1.2;
  return 0;
}

const R = {
  count: /(?<![\p{L}])(neçə|nece|sayı|sayi|nə\s+qədər|ne\s+qeder|miqdarı|həcmi|hecmi|sahəsi|əhalisi|ehalisi|istehsal[\p{L}]*|hasilat[\p{L}]*)(?![\p{L}])/iu,
  date: /(?<![\p{L}])(nə\s+vaxt|ne\s+vaxt|hansı\s+ildə|hansi\s+ilde|hangi\s+il|nə\s+zaman|buraxıldı|çıxdı|cxdi|təsis|quruldu|açıldı|acildi|ən\s+son|en\s+son|son\s+dəfə|tarix|nəticə[\p{L}]*|netice[\p{L}]*|results?|scores?|sonuç[\p{L}]*|результат[\p{L}]*|standings|cədvəl[\p{L}]*|cedvel[\p{L}]*)(?![\p{L}])/iu,
  list: /(?<![\p{L}])(siyahı[\p{L}]*|siyahi[\p{L}]*|qaliblər[\p{L}]*|qalibleri|növləri|novleri|üsulları[\p{L}]*|usullari[\p{L}]*|yolları|yollari|üstünlükləri[\p{L}]*|ustunlukleri[\p{L}]*|çatışmazlıqları[\p{L}]*|top\s*\d+|ən\s+yaxşı|en\s+yaxsi|best)(?![\p{L}])/iu,
  howto: /(?<![\p{L}])(necə|nece|nə\s+deməkdir|ne\s+demekdir|nədir|nedir|işləyir|isleyir|işləməsi|izah)(?![\p{L}])/iu,
  azCtx: {
    legal: /(?<![\p{L}])(hüquq[\p{L}]*|huquq[\p{L}]*|müqavilə[\p{L}]*|muqavile[\p{L}]*|məhkəmə[\p{L}]*|mehkeme[\p{L}]*|qanun[\p{L}]*|cinayət[\p{L}]*|cinayet[\p{L}]*|mülki|mulki|pozuntu[\p{L}]*)(?![\p{L}])/iu,
    edu: /(?<![\p{L}])(təhsil[\p{L}]*|tehsil[\p{L}]*|məktəb[\p{L}]*|mekteb[\p{L}]*|universitet[\p{L}]*|ali\s+məktəb[\p{L}]*|ali\s+mekteb[\p{L}]*|islahat[\p{L}]*|islağ?hat[\p{L}]*|imtahan[\p{L}]*|bakalavr|magistr)(?![\p{L}])/iu,
    econ: /(?<![\p{L}])(iqtisad[\p{L}]*|iqtisadi[\p{L}]*|biznes[\p{L}]*|sahibkar[\p{L}]*|maliyyə[\p{L}]*|maliyye[\p{L}]*|vergi[\p{L}]*|büdcə[\p{L}]*|budce[\p{L}]*|investisiya[\p{L}]*|ixrac[\p{L}]*|idxal[\p{L}]*|statistika[\p{L}]*)(?![\p{L}])/iu,
    health: /(?<![\p{L}])(səhiyyə[\p{L}]*|sehiyye[\p{L}]*|xəstəlik[\p{L}]*|xestelik[\p{L}]*|peyvənd[\p{L}]*|peyvend[\p{L}]*|vaksin[\p{L}]*|tibb[\p{L}]*|həkim[\p{L}]*)(?![\p{L}])/iu
  }
};

const AZ_HINT = /(?<![\p{L}])(azərbaycan[\p{L}]*|azerbaycan[\p{L}]*|bakı[\p{L}]*|baki|naxçıvan[\p{L}]*|naxcivan[\p{L}]*|respublika[\p{L}]*|ölkəmizdə|olkeəmizde|milli|dövlət[\p{L}]*|dovlet[\p{L}]*)(?![\p{L}])/iu;

export const SITE_HINT_FOR = {
  legal: "e-qanun.az",
  edu: "edu.gov.az",
  econ: "stat.gov.az",
  health: "health.gov.az"
};

// Qaytarır: { type, sub, siteHint, azContext }
export function classifyType(query = "") {
  const q = String(query || "");
  const azContext = AZ_HINT.test(q);
  let sub = null;
  if (R.azCtx.legal.test(q)) sub = "legal";
  else if (R.azCtx.edu.test(q)) sub = "edu";
  else if (R.azCtx.econ.test(q)) sub = "econ";
  else if (R.azCtx.health.test(q)) sub = "health";

  let type = "entity";
  if (R.count.test(q)) type = "count";
  else if (R.date.test(q)) type = "date";
  else if (R.list.test(q)) type = "list";
  else if (R.howto.test(q)) type = "howto";

  return {
    type,
    sub,
    azContext,
    siteHint: azContext && sub ? SITE_HINT_FOR[sub] : null
  };
}

// AZ rəsmi domen bonusu (yalnız sual AZ kontekstlidirsə tətbiq olunur)
export function officialBoost(url = "") {
  // v43: bütöv link sətri yox, HOSTNAME yoxlanılır ("reklam.com/e-qanun-haqqinda" dövlət saytı deyil!)
  let host = "";
  try { host = new URL(String(url || "")).hostname.toLowerCase().replace(/^www\./, ""); } catch { return 0; }
  for (const d of AZ_OFFICIAL) if (host === d || host.endsWith("." + d)) return 1.8;
  return 0;
}

// "ən son" / "2026" kimi təzəlik tələb edən suallar
export function wantsFresh(query = "") {
  return /(?<![\p{L}])(ən\s+son|en\s+son|son\s+xəbər[\p{L}]*|son\s+xeber[\p{L}]*|bu\s+il|2025|2026|indi|hazırda|hazirda|live|cədvəl|standings|(bu\s+g[üu]n)|today|tonight|right\s+now)(?![\p{L}])/iu.test(String(query || ""));
}

// v41.4: "bu gün / live / nəticələr" → provayderə təzəlik filtri
export function sameDayCue(query = "") {
  return /(?<![\p{L}])(bu\s+g[üu]n|son\s+dəqiqə|live|today|tonight|right\s+now|hoy|heute|сегодня|şimdi|simdi|aujourd|actualités\s+du\s+jour)(?![\p{L}])/iu.test(String(query || ""));
}
