// v123: HTML entity decode — tək keçid (ikiqat decode QƏSDƏN YOXDUR: "&amp;lt;" → "&lt;", təhlükəsizlik üçün).
// Əvvəl yalnız 7 adlı entity bilinirdi; "&middot;", "&hellip;", "&ndash;" nəticədə olduğu kimi qalırdı.
const NAMED_ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  middot: "·", hellip: "…", ndash: "–", mdash: "—", laquo: "«", raquo: "»",
  lsquo: "‘", rsquo: "’", sbquo: "‚", ldquo: "“", rdquo: "”", bdquo: "„",
  bull: "•", copy: "©", reg: "®", trade: "™", euro: "€", pound: "£", yen: "¥", cent: "¢",
  deg: "°", times: "×", divide: "÷", plusmn: "±", frac12: "½", sect: "§", para: "¶",
  larr: "←", rarr: "→", uarr: "↑", darr: "↓", ensp: " ", emsp: " ", thinsp: " ", shy: ""
};
const ENTITY_RE = /&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z][a-zA-Z0-9]{1,7}));/g;

// opts.angle=false → "&lt;"/"&gt;" (və &#60;/&#62;) DƏYİŞDİRİLMİR (LLM-ə gedən mətndə təsadüfi tag yaranmasın).
export function decodeEntities(s, opts = {}) {
  const angle = opts.angle !== false;
  return String(s || "").replace(ENTITY_RE, (m, dec, hex, name) => {
    if (dec !== undefined || hex !== undefined) {
      const cp = dec !== undefined ? parseInt(dec, 10) : parseInt(hex, 16);
      if (!Number.isFinite(cp) || cp <= 0 || cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF)) return m; // səhv kod → toxunma (əvvəl RangeError atırdı)
      if (!angle && (cp === 60 || cp === 62)) return m;
      return String.fromCodePoint(cp);
    }
    if (!Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, name)) return m;
    if (!angle && (name === "lt" || name === "gt")) return m;
    return NAMED_ENTITIES[name];
  });
}
