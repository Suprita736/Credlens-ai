import type { FactCheckResult } from "../types";

export class FactCheckService {
  /**
   * Helper to calculate Jaccard similarity (token overlap) between two claims.
   * Filters out common stop words to focus on meaningful content words.
   */
  private static calculateSimilarity(str1: string, str2: string): number {
    const stopWords = new Set([
      "the", "is", "at", "which", "on", "a", "an", "and", "or", 
      "but", "for", "of", "in", "to", "that", "this", "these", "those",
      "about", "with", "from", "by", "as", "are", "was", "were", "be"
    ]);

    const getTokens = (s: string): Set<string> => {
      return new Set(
        s.toLowerCase()
          .replace(/[^\w\s]/g, "") // remove punctuation
          .split(/\s+/)
          .filter((token) => token.length > 1 && !stopWords.has(token))
      );
    };

    const set1 = getTokens(str1);
    const set2 = getTokens(str2);

    if (set1.size === 0 || set2.size === 0) return 0;

    const intersection = new Set([...set1].filter((x) => set2.has(x)));
    const union = new Set([...set1, ...set2]);

    return intersection.size / union.size;
  }

  /**
   * Searches the Google Fact Check Tools API for a claim.
   * Returns a structured FactCheckResult or null if no matching reviews are found.
   */
  static async verifyClaim(
    claim: string,
    apiKey: string,
    signal?: AbortSignal
  ): Promise<FactCheckResult | null> {
    if (!apiKey) {
      console.warn("[FactCheckService] Missing Google API key for Fact Check Tools");
      return null;
    }

    const url = `https://factchecktools.googleapis.com/v1alpha1/claims:search?query=${encodeURIComponent(
      claim
    )}&key=${apiKey}`;

    console.log(`[FactCheckService] Querying Fact Check API for: "${claim}"`);

    try {
      // Fetch with timeout support
      const fetchPromise = fetch(url, { signal });
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Timeout")), 8000)
      );

      const response = await Promise.race([fetchPromise, timeoutPromise]);

      if (!response.ok) {
        console.error(`[FactCheckService] API error: ${response.status} ${response.statusText}`);
        return null;
      }

      const data = (await response.json()) as any;

      if (!data.claims || data.claims.length === 0) {
        console.log("[FactCheckService] No fact check results returned from Google");
        return null;
      }

      console.log(`[FactCheckService] Found ${data.claims.length} claim matches. Ranking...`);

      // Rank matching claims by Jaccard similarity
      let bestClaim: any = null;
      let highestSimilarity = -1;

      for (const item of data.claims) {
        const sim = this.calculateSimilarity(claim, item.text);
        console.log(`[FactCheckService] Overlap with "${item.text}": ${sim.toFixed(2)}`);

        if (sim > highestSimilarity) {
          highestSimilarity = sim;
          bestClaim = item;
        }
      }

      // Minimum Jaccard threshold to prevent matching completely unrelated claims
      const MIN_SIMILARITY_THRESHOLD = 0.12;
      if (!bestClaim || highestSimilarity < MIN_SIMILARITY_THRESHOLD) {
        console.log("[FactCheckService] Best matching claim is below similarity threshold");
        return null;
      }

      // Extract reviews
      const reviews = bestClaim.claimReview as any[];
      if (!reviews || reviews.length === 0) {
        console.log("[FactCheckService] Claim found but has no reviews associated");
        return null;
      }

      // Grab the primary/first review
      const primaryReview = reviews[0];
      const publisher = primaryReview.publisher?.name || "Fact Checker";
      const rating = primaryReview.textualRating || "Unverified";
      const reviewUrl = primaryReview.url || "";
      const title = primaryReview.title || bestClaim.text;

      // Base confidence score on Jaccard similarity (scaled)
      // Jaccard similarity is typically < 0.8 unless exact, let's map similarity to confidence (50% - 95%)
      const confidence = Math.min(
        95,
        Math.max(50, Math.round(50 + highestSimilarity * 50))
      );

      console.log(`[FactCheckService] Selected Best Review: "${title}" by ${publisher} with verdict: "${rating}"`);

      return {
        verified: true,
        verdict: rating,
        source: publisher,
        explanation: title,
        url: reviewUrl,
        confidence,
      };
    } catch (error: any) {
      if (error.name === "AbortError" || signal?.aborted) {
        console.log("[FactCheckService] Request aborted");
      } else {
        console.error("[FactCheckService] Error during search:", error);
      }
      // Return null rather than failing the whole pipeline
      return null;
    }
  }
}
