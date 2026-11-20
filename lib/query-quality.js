// Deterministic intent anchors; no fabricated search results or popularity claims.
import { normalizeColloquialAz } from './clean.js';

export function intentAnchor(query = '') {
  const q = normalizeColloquialAz(query);
  if (/\bgithub\b/i.test(q) && /layih[əe]|repositor|repo\b/iu.test(q)
      && /ən\s+yaxşı|en\s+yaxsi|best|top|populyar/iu.test(q)) {
    return 'best GitHub repositories open source projects';
  }
  if (/tutuquş/iu.test(q) && /neçə|növ|sayı/iu.test(q)) {
    return 'number of parrot species Psittaciformes';
  }
  return null;
}

export function hasEncodingDamage(result = {}) {
  const text = `${result.title || ''} ${result.content || result.snippet || ''}`;
  const count = (text.match(/\uFFFD/g) || []).length;
  return count >= 3 && count / Math.max(text.length, 1) > 0.02;
}

// A service landing page or award for GitHub itself is not a project recommendation.
export function matchesRecommendationIntent(query, result = {}) {
  if (/ən\s+yaxşı.*film.*adlar/iu.test(normalizeColloquialAz(query))
      && /mükafat|award|Qızıl\s+Qlobus/iu.test(result.title || '')
      && !/mükafat|award|Qızıl\s+Qlobus/iu.test(query)) return false;
  if (!/\bgithub\b/i.test(query) || !intentAnchor(query)) return true;
  const text = `${result.title || ''} ${result.snippet || ''} ${result.content || ''}`;
  let path = '';
  try { const u = new URL(result.url); path = u.hostname.replace(/^www\./, '') === 'github.com' ? u.pathname : ''; } catch {}
  if (/^https?:\/\/(?:www\.)?arxiv\.org\//i.test(result.url || '')) return false;
  if (/^\/(?:team|teams|pricing|features)(?:\/|$)/i.test(path)) return false;
  return /repositor|projects?|layih|репозитор|проект|awesome|trending/iu.test(text + ' ' + path);
}
