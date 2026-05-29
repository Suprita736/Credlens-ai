import type { ClaimAnalysis } from "../types";

export interface ConfidenceReport {
  credibilityScore: number;
  confidence: number;
  scientificSupport: 'Strong' | 'Moderate' | 'Weak' | 'None' | 'N/A';
  manipulationRisk: 'High' | 'Moderate' | 'Low';
  evidenceStrength: 'Strong' | 'Moderate' | 'Weak';
}

export class ConfidenceScorer {
  /**
   * Deterministically computes credibility and confidence scores along with nuanced
   * metadata breakdowns based on external verification service outputs and Gemini synthesis.
   * Runs locally, instantly, and with zero API calls.
   */
  static compute(analysis: ClaimAnalysis): ConfidenceReport {
    const category = analysis.category || "other";
    const credibility = analysis.credibility || "none";
    const isSatire = analysis.isSatire || false;
    
    // Extract evidence details
    const factCheck = analysis.factCheck;
    const healthResearchCount = analysis.healthResearch?.sources?.length || 0;
    const newsArticlesCount = analysis.newsVerification?.sources?.length || 0;

    // ────────────────────────────────────────────────────────────────────────
    // 1. Scientific Support
    // ────────────────────────────────────────────────────────────────────────
    let scientificSupport: 'Strong' | 'Moderate' | 'Weak' | 'None' | 'N/A' = 'N/A';
    if (category === "health" || category === "science") {
      if (healthResearchCount >= 2 && (credibility === "high" || analysis.verdict?.toLowerCase().includes("support"))) {
        scientificSupport = 'Strong';
      } else if (healthResearchCount >= 1) {
        scientificSupport = 'Moderate';
      } else if (healthResearchCount === 0 && credibility === "low") {
        scientificSupport = 'None';
      } else {
        scientificSupport = 'Weak';
      }
    }

    // ────────────────────────────────────────────────────────────────────────
    // 2. Evidence Strength
    // ────────────────────────────────────────────────────────────────────────
    let evidenceStrength: 'Strong' | 'Moderate' | 'Weak' = 'Weak';
    const totalEvidenceCount = (factCheck ? 1 : 0) + healthResearchCount + newsArticlesCount;
    
    if ((factCheck && factCheck.confidence >= 80) || healthResearchCount >= 2 || newsArticlesCount >= 2) {
      evidenceStrength = 'Strong';
    } else if (totalEvidenceCount >= 1) {
      evidenceStrength = 'Moderate';
    }

    // ────────────────────────────────────────────────────────────────────────
    // 3. Manipulation Risk
    // ────────────────────────────────────────────────────────────────────────
    let manipulationRisk: 'High' | 'Moderate' | 'Low' = 'Moderate';
    const verdictLower = (analysis.verdict || "").toLowerCase();
    
    if (isSatire || credibility === "high" || verdictLower.includes("supported") || verdictLower.includes("reported")) {
      manipulationRisk = 'Low';
    } else if (
      credibility === "low" ||
      verdictLower.includes("false") ||
      verdictLower.includes("inaccurate") ||
      verdictLower.includes("debunk") ||
      verdictLower.includes("misleading") ||
      verdictLower.includes("no credible evidence")
    ) {
      manipulationRisk = 'High';
    }

    // ────────────────────────────────────────────────────────────────────────
    // 4. Credibility Score (0 - 100)
    // ────────────────────────────────────────────────────────────────────────
    let credibilityScore = 50; // base mid-point

    switch (credibility) {
      case "high":
        credibilityScore = 85;
        break;
      case "medium":
        credibilityScore = 60;
        break;
      case "low":
        credibilityScore = 20;
        break;
      case "none":
      default:
        credibilityScore = 45;
        break;
    }

    // Adjustments from Google Fact Check
    if (factCheck) {
      const factCheckVerdict = factCheck.verdict.toLowerCase();
      if (
        factCheckVerdict.includes("false") ||
        factCheckVerdict.includes("incorrect") ||
        factCheckVerdict.includes("fake") ||
        factCheckVerdict.includes("misleading") ||
        factCheckVerdict.includes("debunk")
      ) {
        credibilityScore -= 15;
      } else if (factCheckVerdict.includes("true") || factCheckVerdict.includes("correct") || factCheckVerdict.includes("accurate")) {
        credibilityScore += 10;
      }
    }

    // Adjustments from Medical consensus
    if (category === "health" || category === "science") {
      if (scientificSupport === "Strong") {
        credibilityScore += 10;
      } else if (scientificSupport === "None") {
        credibilityScore -= 15;
      }
    }

    // Adjustments from News corroboration
    if (category === "news" || category === "politics") {
      if (newsArticlesCount >= 2 && credibility === "high") {
        credibilityScore += 8;
      } else if (newsArticlesCount === 0 && credibility === "low") {
        credibilityScore -= 10;
      }
    }

    // Handle satire/entertainment gracefully
    if (isSatire) {
      credibilityScore = 95;
    }

    // Clamp credibilityScore strictly between 5 and 95 to retain nuance
    credibilityScore = Math.max(5, Math.min(95, credibilityScore));

    // ────────────────────────────────────────────────────────────────────────
    // 5. Confidence Score (0 - 100)
    // ────────────────────────────────────────────────────────────────────────
    // Start with the AI confidence from synthesised analysis, or 65 default
    let baseConfidence = analysis.confidence || 65;
    
    // Fact check adds direct verification confidence
    if (factCheck) {
      baseConfidence += 15;
    }
    
    // Academic studies provide solid meta weight
    if (healthResearchCount > 0) {
      baseConfidence += healthResearchCount === 1 ? 10 : 15;
    }
    
    // News corroboration adds reliability
    if (newsArticlesCount > 0) {
      baseConfidence += Math.min(15, newsArticlesCount * 5);
    }

    // If zero external evidence is found, confidence drops
    if (totalEvidenceCount === 0) {
      baseConfidence -= 15;
    }

    // Clamp confidence score between 30 and 95
    const confidence = Math.max(30, Math.min(95, baseConfidence));

    return {
      credibilityScore,
      confidence,
      scientificSupport,
      manipulationRisk,
      evidenceStrength,
    };
  }
}
