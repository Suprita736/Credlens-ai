/**
 * Lightweight Transcript Pre-Filter
 *
 * Runs zero-cost heuristics BEFORE any API call.
 * Keeps Gemini quota for transcripts that actually contain checkable facts.
 */

export type FilterVerdict =
  | { pass: true }
  | { pass: false; reason: string };

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Split into clean word tokens, lower-cased. */
const tokens = (text: string): string[] =>
  text.toLowerCase().replace(/[^\w\s]/g, " ").split(/\s+/).filter(Boolean);

/** Unique-word ratio: 1.0 = all unique, 0.0 = completely repetitive. */
const uniqueRatio = (words: string[]): number =>
  words.length === 0 ? 0 : new Set(words).size / words.length;

// ─── Signal lists ─────────────────────────────────────────────────────────────

const MUSIC_BRACKET_TAGS = [
  "[music]", "[musique]", "[musik]", "[música]", "[संगीत]",
  "[음악]", "[музыка]", "[音楽]", "[音乐]", "[applause]",
  "[cheering]", "[laughter]", "[crowd cheering]",
];

/** Strong indicators that the whole clip is a song. */
const MUSIC_KEYWORD_PHRASES = [
  "official music video", "official audio", "official lyric video",
  "lyrics", "lyric video", "music video", "out now", "streaming now",
  "follow me on spotify", "available on all platforms",
];

/**
 * Short filler phrases that commonly appear as the entire transcript
 * of aesthetic/vlog-style Shorts with no spoken information.
 */
const FILLER_ONLY_PHRASES = [
  "wait for it", "like and subscribe", "follow for more",
  "subscribe for more", "don't forget to like", "comment below",
  "share this video", "hit the bell", "turn on notifications",
  "check the link in bio", "link in bio", "check the description",
  "watch till the end", "drop a like", "smash that like",
];

// ─── Main filter function ──────────────────────────────────────────────────────

/**
 * Returns `{ pass: true }` if the transcript is worth sending to Gemini,
 * or `{ pass: false, reason }` if it should be silently discarded.
 */
export function preFilterTranscript(raw: string): FilterVerdict {
  const text = raw.trim();

  // 1. Absolute minimum length
  if (text.length < 60) {
    return { pass: false, reason: "Transcript too short (< 60 chars)" };
  }

  const lower = text.toLowerCase();
  const words = tokens(text);

  // 2. Minimum word count
  if (words.length < 15) {
    return { pass: false, reason: `Too few words (${words.length} < 15)` };
  }

  // 3. Music bracket tags
  const musicBracket = MUSIC_BRACKET_TAGS.find((tag) => lower.includes(tag));
  if (musicBracket) {
    return { pass: false, reason: `Music/bracket tag detected: "${musicBracket}"` };
  }

  // 4. Music keyword phrases — only block if they appear early (first 30 % of text)
  const firstPart = lower.slice(0, Math.floor(lower.length * 0.3));
  const musicPhrase = MUSIC_KEYWORD_PHRASES.find((phrase) =>
    firstPart.includes(phrase)
  );
  if (musicPhrase) {
    return { pass: false, reason: `Music/lyric phrase detected early: "${musicPhrase}"` };
  }

  // 5. Extremely repetitive content  (ratio below 0.03 → > 97 % repeated words)
  const ratio = uniqueRatio(words);
  if (ratio < 0.03) {
    return {
      pass: false,
      reason: `Highly repetitive content (unique-word ratio ${ratio.toFixed(2)})`,
    };
  }

  // 6. Transcript consists almost entirely of filler calls-to-action
  const fillerHits = FILLER_ONLY_PHRASES.filter((p) => lower.includes(p)).length;
  // More than 2 distinct filler phrases with no real content → skip
  if (fillerHits >= 2 && words.length < 40) {
    return {
      pass: false,
      reason: `Filler-only transcript (${fillerHits} CTA phrases, only ${words.length} words)`,
    };
  }

  // 7. Emoji / symbol density — aesthetic edits often have near-zero real words
  const emojiRegex =
    /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FEFF}]/gu;
  const emojiCount = (text.match(emojiRegex) ?? []).length;
  if (emojiCount > 0 && emojiCount / words.length > 0.5) {
    return {
      pass: false,
      reason: `High emoji density (${emojiCount} emojis for ${words.length} words)`,
    };
  }

  return { pass: true };
}

/**
 * Deduplicates a progressively-growing transcript string.
 *
 * YouTube captions are delivered in overlapping windows, so the same
 * phrase often appears multiple times. This normalises the raw
 * concatenated buffer into one clean, deduplicated passage.
 */
export function deduplicateTranscript(raw: string): string {
  if (!raw) return "";

  // Step 1: basic clean-up
  let text = raw
    .replace(/\[music\]/gi, "")
    .replace(/\[.*?\]/g, "")             // strip bracket tags
    .replace(/>>/g, "")                  // strip subtitle arrows
    .replace(/\s+/g, " ")               // collapse whitespace
    .trim();

  // Step 2: deduplicate repeated consecutive word sequences
  // e.g. "hello hello world world" → "hello world"
  text = text.replace(/\b(\w+)( \1\b)+/gi, "$1");

  // Step 3: split into sentences, deduplicate by normalised content
  const sentences = text.split(/(?<=[.!?])\s+/);
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const sentence of sentences) {
    const normalised = sentence.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
    if (normalised && !seen.has(normalised)) {
      seen.add(normalised);
      unique.push(sentence.trim());
    }
  }

  return unique.join(" ").trim();
}
