// İdman nəticəsi intenti — TheSportsDB (açıq test açarı "123", keysiz qeydiyyat yoxdur).
// Səbəb: "Real Madrid son oyununu udubmu" sualında axtarış köhnə mövsüm səhifələrini gətirirdi,
// cavab (hesab) isə API-də birbaşa durur.
// Qeyd: pulsuz açar limitlidir — eventslast 1 oyun qaytarır, eventsseason boşdur. Ona görə
// yalnız "son oyun" sualları üçün istifadə olunur; alınmasa adi axtarışa düşür.
import { normalizeAz } from "./rank.js";

const KEY = process.env.THESPORTSDB_KEY || "123";
const BASE = "https://www.thesportsdb.com/api/v1/json";
const UA = "Mozilla/5.0 (compatible; LLMSearchAPI/1.0)";

// Sual növü: "son oyununu udubmu", "son matçı necə bitdi", "did X win last match"
const ASK_RE = /(?<![\p{L}])(son\s+(oyun|matc|matç|görüş|gorus)|udubmu|uduzubmu|uduzdu|hesab\s+nece|nece\s+bitdi|last\s+(match|game)|did\s+.+\s+win|score\s+of)(?![\p{L}])/iu;
const STOP = /(?<![\p{L}])(did|does|is|was|the|match|game|team|win|won|lost|score|of|son|oyun|oyunu|oyununu|oyunlar|matc|matç|matcini|matçını|udubmu|uduzubmu|uduzdu|hesab|nece|necə|bitdi|hansı|hansi|ne|nə|qeder|qədər|necedir|necədir|kim|haqqinda|haqqında|barədə|barada|oyunun|neticeni|nəticəni|ve|və|ile|ilə)(?![\p{L}])/giu;

const norm = (s) => normalizeAz(s).replace(/\s+/g, " ").trim();
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// AZ yazılışı → TheSportsDB-də işlədilən ad (kiçik data cədvəli, regex deyil)
const TEAM_ALIASES = {
  barselona: "Barcelona", barcelona: "Barcelona",
  manchester_united: "Manchester United", mançester: "Manchester United", manchester: "Manchester United",
  çelsi: "Chelsea", chelsea: "Chelsea", liverpul: "Liverpool",
  yuventus: "Juventus", juventus: "Juventus",
  "bayern munih": "Bayern Munich", "bavariya": "Bayern Munich",
  "psj": "Paris Saint-Germain", "psg": "Paris Saint-Germain",
  "mençester siti": "Manchester City", "manchester city": "Manchester City",
  arsenal: "Arsenal", "tottenham": "Tottenham",
  "qarabağ": "Qarabag", qarabag: "Qarabag", "neftçi": "Neftchi Baku", neftci: "Neftchi Baku",
  neapol: "Napoli", napoli: "Napoli", "roma": "Roma", "latsio": "Lazio", lazio: "Lazio",
  "atletiko": "Atletico Madrid", "atletico": "Atletico Madrid", "seviya": "Sevilla",
  "dortmund": "Borussia Dortmund", "leyptsig": "RB Leipzig",
  milan: "AC Milan", inter: "Inter Milan", "tottenhem": "Tottenham",
  "mançester united": "Manchester United",
  "portu": "Porto", "benfika": "Benfica",
  "ayaks": "Ajax", "psv": "PSV", "feyenoord": "Feyenoord"
};
function aliasOf(team) {
  const n = norm(team);
  if (TEAM_ALIASES[n]) return TEAM_ALIASES[n];
  for (const [k, v] of Object.entries(TEAM_ALIASES)) if (n.includes(norm(k))) return v;
  return team;
}

export function matchSports(query = "") {
  const q = String(query || "");
  // yoxlama normalizə edilmiş formada (necə → nece, udubmu və s.)
  if (!ASK_RE.test(norm(q))) return { hit: false, exact: false };
  const cleaned = norm(q.replace(STOP, " ").replace(/[?!.,]+$/g, ""));
  const team = cleaned.split(/\s+/).filter(Boolean).slice(0, 4).join(" ");
  if (team.length < 3) return { hit: false, exact: false };
  return { hit: true, exact: true, team: aliasOf(team), teamRaw: cleaned };
}

async function getJson(url, ms = 2200) {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(ms) });
  if (!res.ok) throw new Error("sportsdb " + res.status);
  return res.json();
}

// 429-lardan qorunma: nəticə 10 dəq keşlənir, 429-dan sonra 5 dəq susuruq
const CACHE = new Map();
let BLOCK_UNTIL = 0;

export async function fetchLastMatch(team, ms = 2200) {
  const key = String(team || "").toLowerCase();
  const c = CACHE.get(key);
  if (c && Date.now() - c.t < 600000) return c.v;
  if (Date.now() < BLOCK_UNTIL) return null;
  if (!team) return null;
  const t = await getJson(`${BASE}/${KEY}/searchteams.php?t=${encodeURIComponent(team)}`, ms).catch((e) => {
    if (/429/.test(String(e && e.message))) BLOCK_UNTIL = Date.now() + 300000;
    return null;
  });
  // tapılmasa ikinci cəhd: yalnız ilk söz (məs. "bayern munih" → "Bayern")
  const teams = t?.teams || [];
  if (!teams.length) return null;
  // ad uyğunluğu: sorğudaki sözlərin çoxu komanda adında olsun
  const want = new Set(norm(team).split(/\s+/));
  const scored = teams.map(x => {
    const have = new Set(norm(x.strTeam || "").split(/\s+/));
    let hit = 0;
    for (const w of want) if (have.has(w)) hit++;
    return { x, hit };
  }).sort((a, b) => b.hit - a.hit);
  const best = scored[0];
  if (!best || best.hit === 0) return null;
  const id = best.x.idTeam;

  const ev = await getJson(`${BASE}/${KEY}/eventslast.php?id=${id}`, ms).catch(() => null);
  const list = ev?.results || ev?.events || [];
  const withScore = list.filter(e => e.intHomeScore !== null && e.intHomeScore !== undefined && e.intAwayScore !== null);
  if (!withScore.length) return null;
  const e = withScore.sort((a, b) => String(b.strTimestamp || "").localeCompare(String(a.strTimestamp || "")))[0];
  const home = Number(e.intHomeScore), away = Number(e.intAwayScore);
  const out = {
    team: best.x.strTeam,
    league: e.strLeague || best.x.strLeague || null,
    date: e.strTimestamp ? String(e.strTimestamp).slice(0, 10) : null,
    event: e.strEvent || `${e.strHomeTeam} - ${e.strAwayTeam}`,
    homeTeam: e.strHomeTeam, awayTeam: e.strAwayTeam,
    home, away,
    isHome: norm(e.strHomeTeam || "") === norm(best.x.strTeam || ""),
    venue: e.strVenue || null,
    fetched_at: new Date().toISOString()
  };
  CACHE.set(key, { t: Date.now(), v: out });
  return out;
}

export function lastMatchToText(m, qLang = "az") {
  if (!m) return "";
  const winner = m.home > m.away ? m.homeTeam : m.away > m.home ? m.awayTeam : null;
  const teamWon = winner ? norm(winner) === norm(m.team) : false;
  if (qLang === "en") {
    const verdict = !winner ? "it was a draw" : teamWon ? `${m.team} won` : `${m.team} lost`;
    return `${m.team}'s last match: ${m.homeTeam} ${m.home}-${m.away} ${m.awayTeam}${m.league ? ` (${m.league})` : ""}${m.date ? `, ${m.date}` : ""} — ${verdict}.`;
  }
  const verdict = !winner ? "heç-heçə" : teamWon ? `${m.team} qalib gəldi` : `${m.team} uduzdu`;
  return `${m.team}-ın son oyunu: ${m.homeTeam} ${m.home}-${m.away} ${m.awayTeam}${m.league ? ` (${m.league})` : ""}${m.date ? `, ${m.date}` : ""} — ${verdict}.`;
}

export function isSportsQuery(query = "") {
  return matchSports(query).hit;
}
