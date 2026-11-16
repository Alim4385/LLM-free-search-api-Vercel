// v39: tip-üzrə retrieval router.
// Sualın NÖVÜNÜ müəyyən edir və həmin növə uyğun mənbə strategiyası qaytarır.
// Bu qat axtarışı yönləndirir (site hint + bonus), skor regex-i deyil.

export const AZ_OFFICIAL = [
  "e-qanun.az", "supremecourt.gov.az", "constcourt.gov.az", "edu.gov.az",
  "stat.gov.az", "economy.gov.az", "taxes.gov.az", "president.az",
  "azerbaijan.az", "mfa.gov.az", "cbar.az", "eecologiya.gov.az",
  "sosial.gov.az", "e-qanun", "mincom.gov.az", "health.gov.az"
];

const R = {
  count: /(?<![\p{L}])(neçə|nece|sayı|sayi|nə\s+qədər|ne\s+qeder|miqdarı|həcmi|hecmi|sahəsi|əhalisi|ehalisi)(?![\p{L}])/iu,
  date: /(?<![\p{L}])(nə\s+vaxt|ne\s+vaxt|hansı\s+ildə|hansi\s+ilde|hangi\s+il|nə\s+zaman|buraxıldı|çıxdı|cxdi|təsis|quruldu|açıldı|acildi|ən\s+son|en\s+son|son\s+dəfə|tarix)(?![\p{L}])/iu,
  list: /(?<![\p{L}])(siyahı\w*|siyahi\w*|qaliblər\w*|qalibleri|növləri|novleri|üsulları\w*|usullari\w*|yolları|yollari|üstünlükləri\w*|ustunlukleri\w*|çatışmazlıqları\w*|top\s*\d+|ən\s+yaxşı|en\s+yaxsi|best)(?![\p{L}])/iu,
  howto: /(?<![\p{L}])(necə|nece|nə\s+deməkdir|ne\s+demekdir|nədir|nedir|işləyir|isleyir|işləməsi|izah)(?![\p{L}])/iu,
  azCtx: {
    legal: /(?<![\p{L}])(hüquq\w*|huquq\w*|müqavilə\w*|muqavile\w*|məhkəmə\w*|mehkeme\w*|qanun\w*|cinayət\w*|cinayet\w*|mülki|mulki|pozuntu\w*)(?![\p{L}])/iu,
    edu: /(?<![\p{L}])(təhsil\w*|tehsil\w*|məktəb\w*|mekteb\w*|universitet\w*|ali\s+məktəb\w*|ali\s+mekteb\w*|islahat\w*|islağ?hat\w*|imtahan\w*|bakalavr|magistr)(?![\p{L}])/iu,
    econ: /(?<![\p{L}])(iqtisad\w*|iqtisadi\w*|biznes\w*|sahibkar\w*|maliyyə\w*|maliyye\w*|vergi\w*|büdcə\w*|budce\w*|investisiya\w*|ixrac\w*|idxal\w*|statistika\w*)(?![\p{L}])/iu,
    health: /(?<![\p{L}])(səhiyyə\w*|sehiyye\w*|xəstəlik\w*|xestelik\w*|peyvənd\w*|peyvend\w*|vaksin\w*|tibb\w*|həkim\w*)(?![\p{L}])/iu
  }
};

const AZ_HINT = /(?<![\p{L}])(azərbaycan\w*|azerbaycan\w*|bakı\w*|baki|naxçıvan\w*|naxcivan\w*|respublika\w*|ölkəmizdə|olkeəmizde|milli|dövlət\w*|dovlet\w*)(?![\p{L}])/iu;

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
  const u = String(url || "").toLowerCase();
  for (const d of AZ_OFFICIAL) if (u.includes(d)) return 1.8;
  return 0;
}

// "ən son" / "2026" kimi təzəlik tələb edən suallar
export function wantsFresh(query = "") {
  return /(?<![\p{L}])(ən\s+son|en\s+son|son\s+xəbər\w*|son\s+xeber\w*|bu\s+il|2025|2026|indi|hazırda|hazirda)(?![\p{L}])/iu.test(String(query || ""));
}
