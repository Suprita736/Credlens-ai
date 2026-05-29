// src/utils/confidenceEngine.ts

/**
 * Simple confidence engine for retrieval evidence.
 * Uses source trust weighting and agreement count.
 * Returns a numeric confidence 0‑100.
 */
export interface EvidenceBundle {
  factCheck?: any[]; // array of fact‑check results
  healthResearch?: any[]; // PubMed results
  newsArticles?: any[]; // news articles
}

export class ConfidenceEngine {
  /**
   * Compute a confidence score based on the provided evidence.
   * HIGH (>=75) when multiple trusted sources agree,
   * MODERATE (50‑74) when limited evidence, and
   * LOW (<50) otherwise.
   */
  static compute(evidence: EvidenceBundle): number {
    let score = 0;
    let weight = 0;

    if (evidence.factCheck && evidence.factCheck.length) {
      // Fact‑check APIs are high‑trust
      score += 40 * Math.min(1, evidence.factCheck.length / 3);
      weight += 40;
    }
    if (evidence.healthResearch && evidence.healthResearch.length) {
      // PubMed/NIH are high‑trust for health
      score += 30 * Math.min(1, evidence.healthResearch.length / 5);
      weight += 30;
    }
    if (evidence.newsArticles && evidence.newsArticles.length) {
      // News sources have medium trust; we weight by count and diversity
      const uniqueSources = new Set(
        evidence.newsArticles.map((a: any) => a.source?.toLowerCase() ?? "unknown")
      ).size;
      score += 20 * Math.min(1, uniqueSources / 3);
      weight += 20;
    }

    // Normalize to 0‑100
    return weight ? Math.round((score / weight) * 100) : 0;
  }
}
