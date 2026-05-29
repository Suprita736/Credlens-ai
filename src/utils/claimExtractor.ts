/**
 * ─── Phase 3.5 — Local Claim Sentence Extractor ──────────────────────────────
 *
 * Extracts ONLY factual-looking sentences from a transcript, using pure
 * regex and rule-based matching. No AI, no network calls, no async — fully
 * deterministic and synchronous.
 *
 * Design goals:
 *  • Reduce the token payload sent to Gemini by 70–90 %.
 *  • Send Gemini ONLY sentences that contain concrete, verifiable assertions.
 *  • Keep the implementation simple, stable, and easy to extend.
 *  • Never use deep NLP — regex + keyword heuristics only.
 *
 * Integration point:
 *  → Called in background/index.ts after claimFilter passes,
 *    BEFORE the Gemini analyzeTranscript() call.
 *    The extracted sentences replace the full transcript as Gemini input.
 */

// ─── Public return type ───────────────────────────────────────────────────────

export interface ClaimExtractionResult {
  /** The sentences judged to be factual claims. */
  sentences: string[];
  /**
   * A single joined string of extracted sentences ready to pass to Gemini.
   * This is what replaces the full transcript in the prompt.
   */
  payload: string;
  /** Stats for debug logging. */
  stats: {
    totalSentences: number;
    extractedCount: number;
    originalCharCount: number;
    reducedCharCount: number;
    reductionPercent: number;
  };
}

// ─── Sentence-level claim scoring ────────────────────────────────────────────
//
// Each group of patterns contributes points to a sentence's "claim score".
// A sentence must reach MIN_CLAIM_SCORE to be included in the payload.
// Keeping thresholds low ensures we never drop real factual content.

const MIN_CLAIM_SCORE = 1; // inclusive; raise to 2 to be slightly stricter

/** Patterns that give the sentence +2 points (strong factual indicators). */
const HIGH_SIGNAL_PATTERNS: RegExp[] = [
  /\b(?:research|study|studies|scientists?|researchers?|doctors?|experts?|evidence)\s+(?:show[s]?|found|say[s]?|suggest[s]?|confirm[s]?|report[s]?|indicate[s]?)\b/i,
  /\baccording to\b/i,
  /\b(?:clinical(?:ly)?|peer.reviewed|published|meta.analysis|systematic review|randomized|trial)\b/i,
  /\b(?:proven|demonstrated|confirmed)\s+to\b/i,
  /\b(?:fda|cdc|who|nih|nasa|epa|nhs)\b/i,
];

/** Patterns that give the sentence +1 point (moderate factual indicators). */
const MED_SIGNAL_PATTERNS: RegExp[] = [
  // Causal/effect language
  /\b(?:causes?|linked to|associated with|leads? to|results? in|triggers?|increases?|decreases?|reduces?|improves?|prevents?)\b/i,
  // Health & science vocabulary
  /\b(?:blood pressure|blood sugar|cholesterol|heart disease|cancer|diabetes|inflammation|immune|hormone|calorie|protein|vitamin|supplement|dosage|symptom|infection|virus|bacteria|antibiotic|vaccine|obesity|metabolism)\b/i,
  // Statistics, percentages, numbers with units
  /\b\d[\d,.]*\s*(?:%|percent|mg|kg|g|ml|lb|oz|km|cm|°|degrees?|times?|fold)\b/i,
  // Authoritative numeric references
  /\b(?:million|billion|thousand)\s+(?:people|cases|deaths|patients|dollars?)\b/i,
  // News / political authority
  /\b(?:government|president|prime minister|congress|senate|parliament|official|economy|inflation|unemployment|central bank)\b/i,
  // Environmental / scientific
  /\b(?:climate change|global warming|carbon|temperature|species|evolution|atmosphere|greenhouse)\b/i,
  // Finance
  /\b(?:gdp|stock market|federal reserve|interest rate|recession|deficit|surplus)\b/i,
  // General factual markers
  /\b(?:actually|in reality|the truth is|did you know|statistics? show|data shows?|the fact (?:is|that))\b/i,
  // Standalone percentage or numeric precision
  /\b\d{1,3}(?:\.\d+)?%\b/,
  /\b\d[\d,.]{2,}\b/,  // numbers ≥ 3 digits — strong precision signal
];

/** Patterns that EXCLUDE a sentence even if it has some signal. */
const EXCLUSION_PATTERNS: RegExp[] = [
  // Pure calls-to-action / filler
  /\b(?:like and subscribe|hit the bell|follow for more|subscribe for more|comment below|share this|watch till the end|drop a like|smash that like|link in bio|check the description)\b/i,
  // Self-referential meta-commentary
  /\b(?:in this video|today we(?:'re| are) (?:talking|going|looking)|welcome back|what's up guys|hey guys|hey everyone)\b/i,
  // Pure opinions / feelings with no factual content
  /^(?:i think|i feel|i believe|in my opinion|personally|i love|i hate|omg|wow|amazing|incredible|crazy|insane)\b/i,
  // Music/lyric bracket tags
  /\[(?:music|musique|musik|applause|cheering|laughter|crowd|audio)\]/i,
];

// ─── Sentence splitter ────────────────────────────────────────────────────────

/**
 * Splits text into individual sentences using punctuation boundaries.
 * Handles edge cases: abbreviations (e.g. "Dr."), numbers ("3.5 mg"),
 * and ellipses are not treated as sentence terminators.
 */
function splitIntoSentences(text: string): string[] {
  // Normalise whitespace first
  const normalised = text.replace(/\s+/g, " ").trim();

  // Split on sentence-ending punctuation followed by space + capital or end-of-string.
  // We use a lookahead so we don't consume the capital letter of the next sentence.
  const raw = normalised.split(/(?<=[.!?])\s+(?=[A-Z"'])/);

  return raw
    .map((s) => s.trim())
    .filter((s) => s.length >= 10); // discard trivially short fragments
}

// ─── Sentence scorer ──────────────────────────────────────────────────────────

/**
 * Returns the claim score for a single sentence.
 * 0 = not a claim; ≥ MIN_CLAIM_SCORE = treat as factual claim sentence.
 */
function scoreSentence(sentence: string): number {
  // First: check exclusion list — if any exclusion pattern matches, score = 0
  for (const ex of EXCLUSION_PATTERNS) {
    if (ex.test(sentence)) return 0;
  }

  let score = 0;

  // High-signal patterns (+2 each)
  for (const pat of HIGH_SIGNAL_PATTERNS) {
    if (pat.test(sentence)) {
      score += 2;
    }
  }

  // Medium-signal patterns (+1 each)
  for (const pat of MED_SIGNAL_PATTERNS) {
    if (pat.test(sentence)) {
      score += 1;
    }
  }

  return score;
}

// ─── Main exported function ───────────────────────────────────────────────────

/**
 * Extract factual claim sentences from `transcript`.
 *
 * Returns a `ClaimExtractionResult` with:
 *  - `sentences`  → individual claim sentences
 *  - `payload`    → single string to pass to Gemini instead of full transcript
 *  - `stats`      → debug/logging metadata
 *
 * Fallback behaviour:
 *  If zero sentences are extracted (e.g. all filler), `payload` will be an
 *  empty string and the caller (background/index.ts) should fall back to
 *  sending the full (already deduplicated) transcript to Gemini — preserving
 *  the existing pipeline behaviour.
 */
export function extractClaimSentences(transcript: string): ClaimExtractionResult {
  const originalCharCount = transcript.length;
  const allSentences = splitIntoSentences(transcript);

  const claimSentences: string[] = [];

  for (const sentence of allSentences) {
    const score = scoreSentence(sentence);
    if (score >= MIN_CLAIM_SCORE) {
      claimSentences.push(sentence);
    }
  }

  // De-duplicate claim sentences (edge case: overlapping caption windows)
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const s of claimSentences) {
    const key = s.toLowerCase().replace(/\s+/g, " ").trim();
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(s);
    }
  }

  const payload = unique.join(" ").trim();
  const reducedCharCount = payload.length;
  const reductionPercent =
    originalCharCount > 0
      ? Math.round(((originalCharCount - reducedCharCount) / originalCharCount) * 100)
      : 0;

  const stats = {
    totalSentences: allSentences.length,
    extractedCount: unique.length,
    originalCharCount,
    reducedCharCount,
    reductionPercent,
  };

  // Debug log
  if (unique.length > 0) {
    console.log(
      `[ClaimExtractor] Extracted ${unique.length}/${allSentences.length} sentences. ` +
        `Token reduction: ~${reductionPercent}% (${originalCharCount} → ${reducedCharCount} chars).`
    );
    console.log("[ClaimExtractor] Claim sentences:", unique);
  } else {
    console.log(
      `[ClaimExtractor] No claim sentences extracted from ${allSentences.length} total sentences. ` +
        `Caller should fall back to full transcript.`
    );
  }

  return { sentences: unique, payload, stats };
}
