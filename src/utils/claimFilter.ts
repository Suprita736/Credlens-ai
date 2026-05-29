/**
 * ─── Phase 3.5 — Local Claim Filter ─────────────────────────────────────────
 *
 * Lightweight, synchronous, local-only heuristic that decides whether a
 * transcript is likely to contain factual claims BEFORE any Gemini API call
 * is made.
 *
 * Design goals:
 *  • Zero network / API usage.
 *  • Completes in < 1 ms for typical Shorts transcripts.
 *  • Conservative: err on the side of PASSING content (never aggressively block).
 *  • Reduces obvious noise only (music, filler, storytelling, jokes).
 *
 * Integration point:
 *  → Called in background/index.ts AFTER transcript stabilisation but
 *    BEFORE the first Gemini `analyzeTranscript()` call.
 */

// ─── Public return type ───────────────────────────────────────────────────────

export interface ClaimFilterResult {
  /** True  → transcript is worth sending to Gemini for analysis. */
  hasPotentialClaim: boolean;
  /**
   * 0–100 confidence that the transcript contains a real factual claim.
   * Higher = more claim signals detected.
   */
  confidence: number;
  /** The specific pattern strings that fired during scanning. */
  matchedPatterns: string[];
}

// ─── Positive claim signal patterns ──────────────────────────────────────────
//
// Each entry is a regex-friendly substring (tested case-insensitively).
// We deliberately keep this comprehensive so legitimate fact-checking
// content is NEVER blocked.

const CLAIM_SIGNAL_PATTERNS: string[] = [
  // Research / scientific authority
  "research shows",
  "study shows",
  "studies show",
  "scientists say",
  "scientists found",
  "researchers found",
  "researchers say",
  "according to",
  "experts say",
  "doctors say",
  "doctors recommend",
  "evidence shows",
  "data shows",
  "published in",
  "peer-reviewed",
  "clinical trial",
  "meta-analysis",
  "systematic review",

  // Causal / effect language
  "causes",
  "linked to",
  "associated with",
  "leads to",
  "results in",
  "increases risk",
  "decreases risk",
  "reduces",
  "improves",
  "prevents",
  "triggers",
  "proven to",
  "shown to",

  // Health & medical vocabulary
  "blood pressure",
  "blood sugar",
  "cholesterol",
  "heart disease",
  "cancer",
  "diabetes",
  "inflammation",
  "immune system",
  "hormone",
  "calorie",
  "protein",
  "vitamin",
  "supplement",
  "dosage",
  "mg per",
  "per day",
  "daily intake",
  "clinical",
  "symptom",
  "disease",
  "infection",
  "virus",
  "bacteria",
  "antibiotic",
  "vaccine",

  // Statistics & numeric precision signals
  // (actual number matches handled separately — see NUMERIC_PATTERN below)
  "percent",
  "%",
  "million",
  "billion",
  "thousand",
  "times more",
  "times less",
  "double",
  "triple",
  "half the",

  // News / political / financial authority
  "government",
  "president",
  "prime minister",
  "congress",
  "senate",
  "parliament",
  "report says",
  "report shows",
  "official",
  "economy",
  "gdp",
  "inflation",
  "unemployment",
  "stock market",
  "federal reserve",
  "central bank",

  // Science / environment
  "climate change",
  "global warming",
  "carbon",
  "temperature",
  "species",
  "evolution",
  "nasa",
  "who",
  "cdc",
  "fda",
  "nih",
  "un report",

  // General factual assertion markers
  "fact",
  "actually",
  "in reality",
  "the truth",
  "did you know",
  "statistic",
  "number",
];

/**
 * Regex that matches a standalone integer or decimal number in text.
 * Examples: "23", "4.5", "17.3%", "1,200"
 * This is a strong signal of factual precision even without keyword context.
 */
const NUMERIC_PATTERN = /\b\d[\d,.]*\s*(?:%|mg|kg|g|ml|lb|oz|km|cm|mm|°|degrees?)?\b/i;

// ─── Noise suppression list ───────────────────────────────────────────────────
//
// If the transcript ONLY contains phrases from this list and nothing in
// CLAIM_SIGNAL_PATTERNS fired, it is almost certainly pure filler/music.
// We still only SKIP if confidence stayed at 0 after scanning.

const PURE_NOISE_SIGNALS: string[] = [
  "official music video",
  "official audio",
  "lyric video",
  "music video",
  "[music]",
  "like and subscribe",
  "hit the bell",
  "follow for more",
  "smash that like",
  "watch till the end",
];

// ─── Main exported function ───────────────────────────────────────────────────

/**
 * Synchronously scan `transcript` for factual-claim signals.
 *
 * Returns `hasPotentialClaim: false` ONLY when zero positive signals fire
 * AND at least one pure-noise signal is present, OR the transcript is
 * objectively too short / repetitive to contain a claim.
 *
 * NEVER blocks based on a single heuristic alone — the system always falls
 * back to Gemini analysis when uncertain.
 */
export function filterForClaims(transcript: string): ClaimFilterResult {
  const lower = transcript.toLowerCase();
  const matched: string[] = [];

  // ── 1. Scan positive claim signals ──────────────────────────────────────
  for (const pattern of CLAIM_SIGNAL_PATTERNS) {
    if (lower.includes(pattern)) {
      matched.push(pattern);
    }
  }

  // ── 2. Check for numeric precision (strong factual indicator) ────────────
  if (NUMERIC_PATTERN.test(transcript)) {
    matched.push("__numeric__");
  }

  // ── 3. Compute confidence score ──────────────────────────────────────────
  //
  // Each unique matched pattern contributes to confidence.
  // Cap at 100; apply a small bonus for combined signal density.
  const baseScore = Math.min(100, matched.length * 12);
  const densityBonus = matched.length >= 4 ? 10 : matched.length >= 2 ? 5 : 0;
  const confidence = Math.min(100, baseScore + densityBonus);

  // ── 4. Noise-only detection (only fires when zero positive signals) ───────
  if (matched.length === 0) {
    const hasNoise = PURE_NOISE_SIGNALS.some((n) => lower.includes(n));
    if (hasNoise) {
      console.log(
        "[ClaimFilter] Skipping — pure noise content detected, zero claim signals."
      );
      return { hasPotentialClaim: false, confidence: 0, matchedPatterns: [] };
    }

    // No positive signals, no pure noise → could be general speech.
    // PASS with low confidence so Gemini makes the final decision.
    console.log(
      "[ClaimFilter] No strong claim signals but no noise flags either → passing to Gemini."
    );
    return { hasPotentialClaim: true, confidence: 10, matchedPatterns: [] };
  }

  // ── 5. At least one positive signal → pass ───────────────────────────────
  console.log(
    `[ClaimFilter] Claim signals detected (${matched.length} patterns, confidence ${confidence}):`,
    matched.filter((m) => m !== "__numeric__").slice(0, 5)
  );
  return { hasPotentialClaim: true, confidence, matchedPatterns: matched };
}
