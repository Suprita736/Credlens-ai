// src/utils/claimRouter.ts

export type VerificationRoute = "health_science" | "news_politics" | "general";

/**
 * Synchronous claim routing utility.
 * Categorizes claims and maps them to clear verification routing paths
 * matching original checks exactly.
 */
export class ClaimRouter {
  /**
   * Maps a classification category to a modular routing path.
   */
  static determineRoute(category: string): VerificationRoute {
    const cat = (category || "").toLowerCase().trim();
    if (cat === "health" || cat === "science") {
      return "health_science";
    } else if (cat === "news" || cat === "politics") {
      return "news_politics";
    } else {
      return "general";
    }
  }

  /**
   * Checks if the given category should query health/academic databases (PubMed).
   * Exact match of original logic: category === "health" || category === "science"
   */
  static shouldSearchPubMed(category: string): boolean {
    const cat = (category || "").toLowerCase().trim();
    return cat === "health" || cat === "science";
  }

  /**
   * Checks if the given category should query news/general reporting databases (Google News).
   * Exact match of original logic: category !== "health"
   */
  static shouldSearchNews(category: string): boolean {
    const cat = (category || "").toLowerCase().trim();
    return cat !== "health";
  }
}
