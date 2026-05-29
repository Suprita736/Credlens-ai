// src/types/aiProvider.ts

/**
 * Abstract interface for AI providers used for claim analysis.
 * Implementations must provide an async `analyzeClaim` method.
 */
export interface AIProvider {
  /**
   * Analyze a single claim, optionally with retrieved evidence.
   * @param claim The raw claim text.
   * @param evidence Optional evidence bundle from retrieval services.
   * @returns Promise resolving to a ClaimAnalysis object (compatible with existing types).
   */
  analyzeClaim(
    claim: string,
    evidence?: {
      factCheck?: any;
      healthResearch?: any;
      newsArticles?: any;
    }
  ): Promise<any>; // Using any to avoid circular type dependency; actual type matches ClaimAnalysis
}
