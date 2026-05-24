import { GoogleGenerativeAI } from "@google/generative-ai";
import type { ClaimAnalysis } from "../types";

// ─── Exponential back-off retry ───────────────────────────────────────────────

interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  signal?: AbortSignal;
}

async function withExponentialBackoff<T>(
  fn: () => Promise<T>,
  { maxRetries = 3, baseDelayMs = 1200, signal }: RetryOptions = {}
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

    try {
      return await fn();
    } catch (err: any) {
      lastError = err;

      if (err?.name === "AbortError" || signal?.aborted) {
        throw err; // never retry on intentional cancellation
      }

      const isQuotaError =
        err?.status === 429 ||
        String(err?.message ?? "").includes("429") ||
        String(err?.message ?? "").toLowerCase().includes("quota") ||
        String(err?.message ?? "").toLowerCase().includes("rate limit");

      const isRetryable =
        isQuotaError ||
        err?.status === 503 ||
        err?.status === 500 ||
        String(err?.message ?? "").includes("503") ||
        String(err?.message ?? "").includes("500");

      if (!isRetryable || attempt >= maxRetries) {
        console.error(
          `[GeminiService] Non-retryable error or max retries reached (attempt ${attempt + 1}):`,
          err?.message ?? err
        );
        throw err;
      }

      // Exponential back-off: 1.2s → 2.4s → 4.8s …  (jitter ±20 %)
      const jitter = 0.8 + Math.random() * 0.4;
      const delay = baseDelayMs * Math.pow(2, attempt) * jitter;
      const delayLabel = isQuotaError ? "quota / 429" : "transient";
      console.warn(
        `[GeminiService] ${delayLabel} error – retrying in ${Math.round(delay)}ms ` +
          `(attempt ${attempt + 1}/${maxRetries})`
      );

      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, delay);
        signal?.addEventListener("abort", () => {
          clearTimeout(t);
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    }
  }

  throw lastError;
}

// ─── GeminiService ────────────────────────────────────────────────────────────

export class GeminiService {
  private genAI: GoogleGenerativeAI;
  private model: any;

  constructor(apiKey: string) {
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.model = this.genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
  }

  // ── Stage A: Claim extraction ──────────────────────────────────────────────

  /**
   * Classifies a transcript: does it contain a verifiable factual claim?
   * Intentionally short prompt → minimal token cost → protects quota.
   */
  async analyzeTranscript(
    transcript: string,
    signal?: AbortSignal
  ): Promise<ClaimAnalysis> {
    const prompt = `
Analyze the transcript below from a short-form video.
Determine whether it contains a specific, verifiable factual claim.

RULES:
1. Pure entertainment (satire, comedy, storytelling, fiction, music) → set isSatire:true, containsClaim:false.
2. Opinions, feelings, rhetorical questions → containsClaim:false.
3. Specific factual assertions presented as truth (health, science, politics, finance, news events) → containsClaim:true.
4. Pick the single most important claim if multiple exist.
5. Category must be one of: health | science | politics | finance | news | other | null

Reply with ONLY valid JSON (no markdown, no extra text):
{
  "containsClaim": boolean,
  "claim": "core claim text or null",
  "category": "health|science|politics|finance|news|other|null",
  "isSatire": boolean,
  "reasoning": "one sentence"
}

Transcript: "${transcript.slice(0, 1200)}"
`.trim();

    try {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

      const result = await withExponentialBackoff(
        () => this.model.generateContent(prompt),
        { maxRetries: 2, baseDelayMs: 1200, signal }
      ) as any;

      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

      const text: string = result.response.text();
      console.log("[GeminiService] Claim extraction raw:", text);

      const jsonStr = text.replace(/```json|```/gi, "").trim();
      return JSON.parse(jsonStr) as ClaimAnalysis;
    } catch (err: any) {
      if (err?.name === "AbortError" || signal?.aborted) {
        console.log("[GeminiService] Claim extraction aborted");
        return { containsClaim: false, isSatire: false, reasoning: "Aborted" };
      }
      console.error("[GeminiService] Claim extraction failed:", err?.message ?? err);
      return {
        containsClaim: false,
        isSatire: false,
        reasoning: `Analysis failed: ${err?.message ?? err}`,
      };
    }
  }

  // ── Stage B: Evidence synthesis ────────────────────────────────────────────

  /**
   * Takes the external evidence gathered from FactCheck / PubMed / Google News
   * and synthesises a soft, educational, neutral verdict.
   *
   * NEVER uses aggressive language. Always educational and trust-building.
   */
  async synthesizeVerification(
    claim: string,
    category: string,
    evidence: {
      factCheck: any;
      healthResearch: any[];
      newsArticles: any[];
    },
    signal?: AbortSignal
  ): Promise<ClaimAnalysis> {
    // Trim evidence payload to avoid massive token spend
    const evidenceSummary = JSON.stringify(
      {
        factCheck: evidence.factCheck,
        healthResearch: evidence.healthResearch.slice(0, 3),
        newsArticles: evidence.newsArticles.slice(0, 3),
      },
      null,
      2
    ).slice(0, 3000); // hard cap at 3 000 chars

    const prompt = `
You are an impartial fact-verification assistant producing an educational overlay for a browser extension.

Claim: "${claim}"
Category: "${category}"

External evidence gathered:
${evidenceSummary}

TONE RULES — mandatory:
• NEVER say "This video is false", "Fake News", "Lies", "Misinformation", or accuse anyone.
• Use phrases like:
  - "This statement may be inaccurate."
  - "Scientific evidence does not strongly support this claim."
  - "Trusted sources could not verify this statement."
  - "This claim is widely reported as…"
• Be educational, neutral, and trust-building.

VERDICT LOGIC:
• health/science + peer-reviewed support   → verdict:"Scientifically supported",  credibility:"high"
• health/science + limited papers          → verdict:"Limited evidence",           credibility:"medium"
• health/science + no/contradicting papers → verdict:"No credible evidence found", credibility:"low"
• fact-check database match (debunked)     → use their verdict softened,           credibility:"low"/"medium"
• news + Reuters/AP/BBC confirm            → verdict:"Widely reported",            credibility:"high"
• news + conflicting reports               → verdict:"Conflicting reports",         credibility:"medium"
• news + no trusted match                  → verdict:"No trusted reporting found",  credibility:"low"

Reply with ONLY valid JSON (no markdown):
{
  "containsClaim": true,
  "claim": "${claim.replace(/"/g, "'")}",
  "category": "${category}",
  "isSatire": false,
  "verdict": "short verdict string",
  "credibility": "low|medium|high|none",
  "confidence": 0-100,
  "explanation": "1-2 gentle neutral sentences",
  "alternativeExplanation": "evidence-based helpful context",
  "sourceName": "most authoritative source name",
  "sourceUrl": "valid URL from evidence or empty string"
}
`.trim();

    try {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

      const result = await withExponentialBackoff(
        () => this.model.generateContent(prompt),
        { maxRetries: 2, baseDelayMs: 1500, signal }
      ) as any;

      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

      const text: string = result.response.text();
      console.log("[GeminiService] Synthesis raw:", text);

      const jsonStr = text.replace(/```json|```/gi, "").trim();
      return JSON.parse(jsonStr) as ClaimAnalysis;
    } catch (err: any) {
      if (err?.name === "AbortError" || signal?.aborted) {
        console.log("[GeminiService] Synthesis aborted");
        return this.fallbackAnalysis(claim, "Aborted");
      }
      console.error("[GeminiService] Synthesis failed:", err?.message ?? err);
      return this.fallbackAnalysis(claim, err?.message ?? "Unknown error");
    }
  }

  // ── Fallback helper ────────────────────────────────────────────────────────

  private fallbackAnalysis(claim: string, reason: string): ClaimAnalysis {
    return {
      containsClaim: true,
      claim,
      isSatire: false,
      reasoning: `Synthesis unavailable: ${reason}`,
      verdict: "Unverified",
      credibility: "none",
      confidence: 50,
      explanation:
        "Verification could not be completed at this time. Please check again later.",
      alternativeExplanation:
        "Consider consulting trusted news sources or academic databases for this topic.",
    };
  }
}
