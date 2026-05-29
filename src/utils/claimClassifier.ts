// src/utils/claimClassifier.ts

/**
 * Simple deterministic claim classifier.
 * Uses keyword matching with weighted scores to categorize a claim.
 * No external API calls, synchronous and fast.
 */
export type ClaimCategory =
  | "health"
  | "news"
  | "science"
  | "politics"
  | "finance"
  | "technology"
  | "opinion"
  | "entertainment"
  | "unknown";

export interface ClassificationResult {
  category: ClaimCategory;
  confidence: number; // 0‑100
  matchedKeywords: string[];
}

// Keyword maps per category with optional weight (default 1)
const CATEGORY_KEYWORDS: Record<ClaimCategory, string[]> = {
  health: ["doctor", "hormone", "insulin", "blood pressure", "disease", "vaccine", "clinic", "symptom", "treatment"],
  news: ["government", "election", "president", "war", "policy", "breaking news", "report", "statement"],
  politics: ["government", "election", "president", "senate", "congress", "policy", "law", "regulation"],
  science: ["study", "researchers", "experiment", "scientific", "paper", "journal", "analysis"],
  finance: ["stock", "inflation", "gdp", "crypto", "market", "economy", "investment", "revenue"],
  technology: ["software", "hardware", "algorithm", "ai", "machine learning", "device", "app", "technology"],
  opinion: ["I think", "in my opinion", "believe", "suggest", "maybe", "perhaps"],
  entertainment: ["movie", "song", "album", "show", "series", "concert", "artist", "celebrity"],
  unknown: []
};

/**
 * Classify a claim string.
 * Scans for presence of keywords; each match increments a score.
 * The category with highest score wins. Confidence is score / maxPossible * 100.
 */
export class ClaimClassifier {
  static classify(claim: string): ClassificationResult {
    const lowered = claim.toLowerCase();
    const scores: Record<ClaimCategory, number> = {
      health: 0,
      news: 0,
      science: 0,
      politics: 0,
      finance: 0,
      technology: 0,
      opinion: 0,
      entertainment: 0,
      unknown: 0,
    };
    const matched: string[] = [];

    for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS) as [ClaimCategory, string[]][]) {
      for (const kw of keywords) {
        const pattern = new RegExp(`\\b${kw.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\b`, "i");
        if (pattern.test(lowered)) {
          scores[category] += 1; // weight = 1 for simplicity
          matched.push(kw);
        }
      }
    }

    // Determine best category
    let bestCategory: ClaimCategory = "unknown";
    let bestScore = 0;
    for (const [cat, sc] of Object.entries(scores) as [ClaimCategory, number][]) {
      if (sc > bestScore) {
        bestScore = sc;
        bestCategory = cat;
      }
    }

    // Compute confidence as percentage of max possible matches for that category
    const maxPossible = CATEGORY_KEYWORDS[bestCategory].length || 1;
    const confidence = Math.round((bestScore / maxPossible) * 100);

    return {
      category: bestCategory,
      confidence,
      matchedKeywords: matched,
    };
  }
}
