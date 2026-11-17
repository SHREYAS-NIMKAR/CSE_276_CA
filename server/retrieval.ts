import { PolicyClause, RetrievedClauseHit, SystemSettings } from './types';

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has', 'he',
  'in', 'is', 'it', 'its', 'of', 'on', 'or', 'that', 'the', 'to', 'was', 'were',
  'will', 'with', 'must', 'should', 'can', 'may', 'this', 'these', 'those',
  'into', 'any', 'all', 'before', 'when', 'where', 'which', 'who', 'not', 'no',
]);

export function simpleStem(word: string): string {
  let w = word.toLowerCase();
  if (w.length <= 3) return w;
  const suffixes = [
    'ations', 'ation', 'ments', 'ment', 'nesses', 'ness', 'ities', 'ity',
    'ings', 'ing', 'ies', 'ied', 'ers', 'er', 'ed', 'es', 'ly', 'al', 's',
  ];
  for (const suf of suffixes) {
    if (w.endsWith(suf) && w.length - suf.length >= 3) {
      if (suf === 'ies' || suf === 'ied') {
        w = w.slice(0, -3) + 'y';
      } else {
        w = w.slice(0, -suf.length);
      }
      break;
    }
  }
  return w;
}

export function tokenize(text: string): string[] {
  const raw = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter(Boolean);
  const out: string[] = [];
  for (const tok of raw) {
    if (tok.length < 2 || STOP_WORDS.has(tok)) continue;
    out.push(simpleStem(tok));
  }
  return out;
}

export interface SearchableDoc {
  clause: PolicyClause;
  tokens: string[];
  rawTokensLower: Set<string>;
}

function buildDocText(c: PolicyClause): string {
  return `${c.clause_id} ${c.title} ${c.text} ${c.tags.join(' ')} ${c.source}`;
}

export function computeBm25Scores(
  queryTokens: string[],
  docs: SearchableDoc[],
  k1 = 1.5,
  b = 0.75
): number[] {
  const n = docs.length;
  if (n === 0 || queryTokens.length === 0) return docs.map(() => 0);

  const docLengths = docs.map((d) => d.tokens.length);
  const avgdl = docLengths.reduce((acc, l) => acc + l, 0) / n || 1;

  // Document frequency per term
  const df = new Map<string, number>();
  for (const doc of docs) {
    const seen = new Set(doc.tokens);
    for (const t of seen) {
      df.set(t, (df.get(t) ?? 0) + 1);
    }
  }

  // Unique query terms (or count-weighted)
  const qTerms = Array.from(new Set(queryTokens));

  return docs.map((doc, idx) => {
    const dl = docLengths[idx];
    const tfMap = new Map<string, number>();
    for (const t of doc.tokens) {
      tfMap.set(t, (tfMap.get(t) ?? 0) + 1);
    }
    let score = 0;
    for (const qt of qTerms) {
      const tf = tfMap.get(qt) ?? 0;
      if (tf === 0) continue;
      const docFreq = df.get(qt) ?? 0;
      const idf = Math.log(1 + (n - docFreq + 0.5) / (docFreq + 0.5));
      const num = tf * (k1 + 1);
      const den = tf + k1 * (1 - b + b * (dl / avgdl));
      score += idf * (num / den);
    }
    return score;
  });
}

export function computeTfIdfCosineScores(
  queryTokens: string[],
  docs: SearchableDoc[]
): number[] {
  const n = docs.length;
  if (n === 0 || queryTokens.length === 0) return docs.map(() => 0);

  const df = new Map<string, number>();
  for (const doc of docs) {
    const seen = new Set(doc.tokens);
    for (const t of seen) {
      df.set(t, (df.get(t) ?? 0) + 1);
    }
  }

  const idf = (term: string): number => {
    const docFreq = df.get(term) ?? 0;
    return Math.log((n + 1) / (docFreq + 1)) + 1;
  };

  // Build query vector
  const qTf = new Map<string, number>();
  for (const qt of queryTokens) {
    qTf.set(qt, (qTf.get(qt) ?? 0) + 1);
  }
  const qVec = new Map<string, number>();
  let qNormSq = 0;
  for (const [term, tf] of qTf.entries()) {
    const weight = (1 + Math.log(tf)) * idf(term);
    qVec.set(term, weight);
    qNormSq += weight * weight;
  }
  const qNorm = Math.sqrt(qNormSq);
  if (qNorm === 0) return docs.map(() => 0);

  return docs.map((doc) => {
    if (doc.tokens.length === 0) return 0;
    const dTf = new Map<string, number>();
    for (const t of doc.tokens) {
      dTf.set(t, (dTf.get(t) ?? 0) + 1);
    }
    let dot = 0;
    let dNormSq = 0;
    for (const [term, tf] of dTf.entries()) {
      const w = (1 + Math.log(tf)) * idf(term);
      dNormSq += w * w;
      const qw = qVec.get(term);
      if (qw !== undefined) {
        dot += w * qw;
      }
    }
    const dNorm = Math.sqrt(dNormSq);
    if (dNorm === 0) return 0;
    return dot / (qNorm * dNorm);
  });
}

export function normalizeScores(scores: number[]): number[] {
  if (scores.length === 0) return [];
  const max = Math.max(...scores);
  if (max <= 0) return scores.map(() => 0);
  const min = Math.min(...scores);
  if (max === min) {
    return scores.map((s) => (s > 0 ? 1 : 0));
  }
  return scores.map((s) => (s - min) / (max - min));
}

export function classifyConfidence(
  hybridScore: number,
  highThreshold: number,
  mediumThreshold: number
): { confidence: 'High' | 'Medium' | 'Low'; label: string; needsHumanInspection: boolean } {
  if (hybridScore >= highThreshold) {
    return { confidence: 'High', label: 'Strong match', needsHumanInspection: false };
  }
  if (hybridScore >= mediumThreshold) {
    return { confidence: 'Medium', label: 'Possible match', needsHumanInspection: false };
  }
  return {
    confidence: 'Low',
    label: 'Not sure: a person should check',
    needsHumanInspection: true,
  };
}

export function retrievePolicyClauses(
  query: string,
  clauses: PolicyClause[],
  settings: SystemSettings,
  topK = 3
): RetrievedClauseHit[] {
  const activeClauses = clauses.filter((c) => c.is_active);
  if (activeClauses.length === 0) return [];

  const queryTokens = tokenize(query);
  const rawQueryWords = query
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));

  const docs: SearchableDoc[] = activeClauses.map((c) => {
    const fullText = buildDocText(c);
    const rawWords = new Set(
      fullText
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, ' ')
        .split(/[\s-]+/)
        .filter(Boolean)
    );
    return {
      clause: c,
      tokens: tokenize(fullText),
      rawTokensLower: rawWords,
    };
  });

  const rawBm25 = computeBm25Scores(queryTokens, docs, settings.bm25_k1, settings.bm25_b);
  const rawTfIdf = computeTfIdfCosineScores(queryTokens, docs);

  const normBm25 = normalizeScores(rawBm25);
  const normTfIdf = normalizeScores(rawTfIdf);

  const w = Math.min(1, Math.max(0, settings.hybrid_weight));
  const clauseById = new Map(activeClauses.map((c) => [c.clause_id, c]));

  const scored = docs.map((doc, i) => {
    const bm25Score = Number(normBm25[i].toFixed(4));
    const tfidfScore = Number(normTfIdf[i].toFixed(4));
    // Also factor un-normalized cosine floor so totally irrelevant queries don't get artificially boosted to 1.0
    const hasMatch = rawBm25[i] > 0 || rawTfIdf[i] > 0;
    const rawCombo = w * normBm25[i] + (1 - w) * normTfIdf[i];
    // Dampen score if query overlap is weak (fewer than 2 matched stems or low cosine)
    const docStemSet = new Set(doc.tokens);
    const matchedStems = Array.from(new Set(queryTokens)).filter((qt) => docStemSet.has(qt));
    const matchedTerms = rawQueryWords.filter((rw) => {
      const st = simpleStem(rw);
      return doc.rawTokensLower.has(rw) || docStemSet.has(st);
    });
    const uniqueMatchedTerms = Array.from(new Set(matchedTerms));

    const coverage = queryTokens.length > 0 ? matchedStems.length / Math.min(queryTokens.length, 4) : 0;
    const hybridScore = hasMatch
      ? Number(Math.min(1, rawCombo * Math.min(1, 0.35 + 0.65 * coverage)).toFixed(4))
      : 0;

    const conf = classifyConfidence(
      hybridScore,
      settings.retrieval_high_threshold,
      settings.retrieval_medium_threshold
    );

    const relatedClauses = doc.clause.related_clause_ids
      .map((rid) => clauseById.get(rid))
      .filter((rc): rc is PolicyClause => Boolean(rc))
      .map((rc) => ({
        clauseId: rc.clause_id,
        title: rc.title,
        source: rc.source,
        sectionNumber: rc.section_number,
        text: rc.text,
      }));

    return {
      clauseId: doc.clause.clause_id,
      source: doc.clause.source,
      sectionNumber: doc.clause.section_number,
      title: doc.clause.title,
      text: doc.clause.text,
      bm25Score,
      tfidfScore,
      hybridScore,
      matchedTerms: uniqueMatchedTerms.length > 0 ? uniqueMatchedTerms : matchedStems,
      confidence: conf.confidence,
      confidenceLabel: conf.label,
      needsHumanInspection: conf.needsHumanInspection,
      relatedClauses,
    } satisfies RetrievedClauseHit;
  });

  scored.sort((a, b) => b.hybridScore - a.hybridScore || a.clauseId.localeCompare(b.clauseId));
  return scored.slice(0, topK);
}

export function buildGroundedGuidanceText(hits: RetrievedClauseHit[]): string {
  if (hits.length === 0) {
    return 'No matching policy clause was found in the active corpus. Human reviewer inspection is required.';
  }
  const top = hits[0];
  return `According to ${top.source} (Section ${top.sectionNumber}, "${top.title}"): ${top.text}`;
}
