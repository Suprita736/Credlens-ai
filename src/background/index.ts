// src/background/index.ts
import { QueueManager } from "./queueManager";
import { GeminiService } from "../services/geminiService";
import { CacheService } from "../services/cacheService";
import { ConfidenceScorer } from "../utils/confidenceScorer";
import { filterForClaims } from "../utils/claimFilter"; // Phase 3.5
import { extractClaimSentences } from "../utils/claimExtractor"; // Phase 3.5
import { ClaimClassifier } from "../utils/claimClassifier";
import { ClaimRouter } from "../utils/claimRouter";
import { ConfidenceEngine } from "../utils/confidenceEngine";
import { RetrievalEngine } from "../services/retrievalEngine";
import { EscalationManager } from "../utils/escalationManager";
import type { ClaimAnalysis, BackgroundMessage, BackgroundResponse } from "../types";

function retryWithDelay<T>(
  fn: () => Promise<T>,
  attempts: number,
  delayMs: number,
  signal?: AbortSignal
): Promise<T> {
  let lastError: any;
  for (let i = 0; i < attempts; i++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    try {
      return fn();
    } catch (err) {
      lastError = err;
      if (i < attempts - 1) {
        return new Promise<T>((_, reject) => {
          const t = setTimeout(() => {
            fn().then(_).catch(reject);
          }, delayMs);
          signal?.addEventListener('abort', () => {
            clearTimeout(t);
            reject(new DOMException('Aborted', 'AbortError'));
          });
        });
      }
    }
  }
  return Promise.reject(lastError);
}

// Run cache pruning on install and startup
chrome.runtime.onInstalled.addListener(() => {
  console.log("[Background] CredLens AI installed/updated.");
  CacheService.prune();
});

chrome.runtime.onStartup.addListener(() => {
  CacheService.prune();
});

// Background Port Messaging Router
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "credlens-verification") return;
  console.log("[Background] Content script connected to verification port.");

  let activeVideoId: string | null = null;

  port.onMessage.addListener(async (message: BackgroundMessage) => {
    const { action, videoId, transcript } = message;
    if (action === "VERIFY_TRANSCRIPT" && videoId && transcript) {
      activeVideoId = videoId;
      console.log(`[Background] Received verification request for ${videoId}`);
      await runVerificationPipeline(videoId, transcript, port);
    } else if (action === "CANCEL_VERIFICATION" && videoId) {
      console.log(`[Background] Received cancellation request for ${videoId}`);
      QueueManager.cancel(videoId);
    }
  });

  port.onDisconnect.addListener(() => {
    console.log("[Background] Content script disconnected. Cleaning active jobs...");
    if (activeVideoId) {
      QueueManager.cancel(activeVideoId);
    }
  });
});

/**
 * Orchestrates the Phase 2 claim verification pipeline.
 */
async function runVerificationPipeline(
  videoId: string,
  transcript: string,
  port: chrome.runtime.Port
) {
  // 1. Send loading status early to content script
  postResponse(port, { status: "loading", videoId });

  // Register with QueueManager to get a cancellation signal
  const signal = QueueManager.register(videoId);

  try {
    // 2. Retrieve Gemini API Key from storage
    const storage = (await chrome.storage.local.get(["geminiApiKey"])) as {
      geminiApiKey?: string;
    };
    const apiKey = storage.geminiApiKey;
    if (!apiKey) {
      console.warn("[Background] No Gemini API key stored");
      postResponse(port, {
        status: "error",
        videoId,
        error:
          "Missing API Key. Please click the extension icon and configure your Gemini API Key.",
      });
      QueueManager.complete(videoId);
      return;
    }

    // 3. Double-Layer Cache Level 1: Check Video ID Cache
    const cachedAnalysis = await CacheService.get(videoId);
    if (cachedAnalysis) {
      console.log(`[Background] Cache Hit (Video ID): ${videoId}`);
      postResponse(port, { status: "completed", videoId, analysis: cachedAnalysis });
      QueueManager.complete(videoId);
      return;
    }

    if (signal.aborted) throw new DOMException("Aborted", "AbortError");

    // 4. Initialize Gemini Service
    const gemini = new GeminiService(apiKey);

    // ── Phase 3.5 — Local Claim Filter ────────────────────────────────────────
    // Run zero-cost local heuristics BEFORE any Gemini call.
    // If the transcript is clearly devoid of factual signals (e.g. it's a
    // music video or pure filler) we skip Gemini entirely and finalise early.
    // IMPORTANT: This is additive — if the filter throws for any reason we
    // catch the error and fall through to normal Gemini analysis.

    let claimSentences: string[] | undefined;
    try {
      const filterResult = filterForClaims(transcript);
      console.log(
        `[Background] Phase 3.5 Claim Filter: hasPotentialClaim=${filterResult.hasPotentialClaim}, ` +
          `confidence=${filterResult.confidence}, ` +
          `matchedPatterns=${filterResult.matchedPatterns
            .filter((p) => p !== "__numeric__")
            .slice(0, 5)
            .join(", ") || "(none)"}`
      );
      if (!filterResult.hasPotentialClaim) {
        console.log(
          `[Background] Phase 3.5 — Local filter skipped Gemini call. ` +
            "Transcript has no detectable claim signals."
        );
        const noClaimResult: ClaimAnalysis = {
          containsClaim: false,
          isSatire: false,
          reasoning:
            "Local claim filter: no factual claim signals detected in transcript.",
          verdict: "No verifiable claims detected",
          credibility: "none",
        };
        await CacheService.set(videoId, null, noClaimResult);
        postResponse(port, { status: "completed", videoId, analysis: noClaimResult });
        QueueManager.complete(videoId);
        return;
      }

      // ── Phase 3.5 — Local Claim Sentence Extraction ──────────────────────────
      const extractionResult = extractClaimSentences(transcript);
      console.log(
        `[Background] Phase 3.5 Claim Extractor: ${extractionResult.stats.extractedCount}/${extractionResult.stats.totalSentences} sentences kept, ` +
          `~${extractionResult.stats.reductionPercent}% token reduction ` +
          `(${extractionResult.stats.originalCharCount} → ${extractionResult.stats.reducedCharCount} chars).`
      );
      if (extractionResult.sentences.length > 0) {
        claimSentences = extractionResult.sentences;
      } else {
        console.log(
          "[Background] Phase 3.5 — Extractor found 0 sentences; falling back to full transcript for Gemini."
        );
      }
    } catch (filterErr) {
      console.warn(
        "[Background] Phase 3.5 local filter/extractor error (non-fatal, falling back):",
        filterErr
      );
    }

    if (signal.aborted) throw new DOMException("Aborted", "AbortError");

    // 5. Local Classification & Routing (Zero-cost, local-first intelligence)
    const claimText = (claimSentences && claimSentences.length > 0 && claimSentences[0].trim().length > 0
      ? claimSentences[0]
      : transcript.slice(0, 150)
    ).trim();

    const localClassification = ClaimClassifier.classify(claimText);
    const category = localClassification.category || "other";
    console.log(`[Classifier] Local category=${category}`);

    const route = ClaimRouter.determineRoute(category);
    console.log(`[Router] Route=${route}`);

    // 6. Double-Layer Cache Level 2: Check Claim Hash Cache
    const claimHash = await CacheService.computeClaimHash(claimText);
    const cachedClaimAnalysis = await CacheService.getByClaimHash(claimHash);
    if (cachedClaimAnalysis) {
      console.log(`[Background] Cache Hit (Claim Hash): ${claimHash.slice(0, 12)}…`);
      await CacheService.set(videoId, claimHash, cachedClaimAnalysis);
      postResponse(port, { status: "completed", videoId, analysis: cachedClaimAnalysis });
      QueueManager.complete(videoId);
      return;
    }

    if (signal.aborted) throw new DOMException("Aborted", "AbortError");

    // 7. Search External Verification Databases (MODULAR RETRIEVAL FIRST)
    console.log("[Retrieval] Running FactCheck");
    console.log("[Retrieval] Running PubMed");
    console.log("[Retrieval] Running News");
    const evidence = await RetrievalEngine.retrieve(claimText, category, apiKey, signal);
    const factCheckRes = evidence.factCheck;
    const healthRes = evidence.healthResearch || [];
    const newsRes = evidence.newsArticles || [];

    if (signal.aborted) throw new DOMException("Aborted", "AbortError");

    // 8. Compute Local Evidence Confidence Score
    const localConfidence = ConfidenceEngine.compute({
      factCheck: factCheckRes ? [factCheckRes] : [],
      healthResearch: healthRes,
      newsArticles: newsRes,
    });
    console.log(`[Confidence] Score=${localConfidence}`);

    // Verify at least one source produced evidence (Confidence Safety Rule)
    const hasEvidence = !!factCheckRes || healthRes.length > 0 || newsRes.length > 0;

    let synthesizedAnalysis: ClaimAnalysis;

    // Check if we can skip LLM (High confidence AND at least one verification source returned data)
    if (localConfidence >= 75 && hasEvidence) {
      console.log("[Escalation] Skipped Gemini due to high confidence");
      synthesizedAnalysis = buildLocalSynthesis(claimText, category, localConfidence, factCheckRes, healthRes, newsRes);
    } else {
      // Moderate/Low confidence OR no evidence → Try to verify/synthesize using Gemini
      try {
        console.log("[Background] Sending to Gemini for claim classification...");
        const claimAnalysis = await retryWithDelay(
          () => gemini.analyzeTranscript(transcript, signal, claimSentences),
          1,
          1000,
          signal
        );

        if (signal.aborted) throw new DOMException("Aborted", "AbortError");

        // If no claims are found or it's comedy/satire, stop the pipeline early (Quota Saver!)
        if (!claimAnalysis.containsClaim || claimAnalysis.isSatire) {
          console.log("[Background] Gemini classified as no claim or satire.");
          // BUT check if retrieval found supporting evidence anyway!
          if (hasEvidence) {
            console.log("[Gemini Fallback] Gemini returned no claim but retrieval has evidence; falling back to retrieval-only verification.");
            synthesizedAnalysis = buildLocalSynthesis(claimText, category, localConfidence, factCheckRes, healthRes, newsRes);
          } else {
            console.log("[Background] No factual claims found or satire detected. Finalizing...");
            const finalResult: ClaimAnalysis = {
              containsClaim: false,
              isSatire: claimAnalysis.isSatire,
              reasoning: claimAnalysis.reasoning,
              verdict: claimAnalysis.isSatire
                ? "Satire / Entertainment"
                : "No verifiable claims detected",
              credibility: "none",
            };
            await CacheService.set(videoId, null, finalResult);
            postResponse(port, { status: "completed", videoId, analysis: finalResult });
            QueueManager.complete(videoId);
            return;
          }
        } else {
          console.log("[Background] External searches complete. Synthesizing evidence...");
          const synthesisInput = {
            factCheck: factCheckRes,
            healthResearch: healthRes,
            newsArticles: newsRes,
          };
          synthesizedAnalysis = await retryWithDelay(
            () => gemini.synthesizeVerification(claimText, category, synthesisInput, signal),
            1,
            1000,
            signal
          );
        }
      } catch (err: any) {
        console.warn("[Gemini Fallback] Quota exceeded or error. Falling back to retrieval-only verification:", err);
        // Fallback to retrieval-based synthesis
        synthesizedAnalysis = buildLocalSynthesis(claimText, category, localConfidence, factCheckRes, healthRes, newsRes);
      }
    }

    if (signal.aborted) throw new DOMException("Aborted", "AbortError");

    // Attach rich structural sub-blocks for UI details
    if (!synthesizedAnalysis.factCheck) synthesizedAnalysis.factCheck = factCheckRes;
    if (healthRes.length > 0 && !synthesizedAnalysis.healthResearch) {
      synthesizedAnalysis.healthResearch = {
        status: synthesizedAnalysis.verdict as any,
        summary: synthesizedAnalysis.explanation || "",
        sources: healthRes,
      };
    }
    if (newsRes.length > 0 && !synthesizedAnalysis.newsVerification) {
      synthesizedAnalysis.newsVerification = {
        status: synthesizedAnalysis.verdict as any,
        summary: synthesizedAnalysis.explanation || "",
        sources: newsRes,
      };
    }

    // 9. Local multi-factor confidence scoring
    const scores = ConfidenceScorer.compute(synthesizedAnalysis);
    synthesizedAnalysis.confidence = scores.confidence;
    synthesizedAnalysis.scientificSupport = scores.scientificSupport;
    synthesizedAnalysis.manipulationRisk = scores.manipulationRisk;
    synthesizedAnalysis.evidenceStrength = scores.evidenceStrength;

    // 9b. If confidence low, augment with OpenRouter verification via EscalationManager
    const openResult = await EscalationManager.escalateIfNeeded(
      claimText,
      evidence,
      scores.confidence,
      apiKey,
      signal
    );
    Object.assign(synthesizedAnalysis, openResult);

    // 10. Multi-tier Caching
    await CacheService.set(videoId, claimHash, synthesizedAnalysis);

    // 10. Respond success
    postResponse(port, { status: "completed", videoId, analysis: synthesizedAnalysis });
  } catch (error: any) {
    if (error.name === "AbortError" || signal.aborted) {
      console.log(`[Background] Verification pipeline aborted for ${videoId}`);
    } else {
      console.error(`[Background] Verification pipeline error for ${videoId}:`, error);
      postResponse(port, {
        status: "error",
        videoId,
        error: `Verification pipeline encountered an error: ${error.message || error}`,
      });
    }
  } finally {
    QueueManager.complete(videoId);
  }
}

/**
 * Helper to safely post responses back through the communication port.
 */
function postResponse(port: chrome.runtime.Port, response: BackgroundResponse) {
  try {
    port.postMessage(response);
  } catch (err) {
    console.warn("[Background] Failed to post message to disconnected port:", err);
  }
}

// Background cleanup on suspend
chrome.runtime.onSuspend.addListener(() => QueueManager.cancelAll());

function buildLocalSynthesis(
  claimText: string,
  category: string,
  confidence: number,
  factCheckRes: any,
  healthRes: any[],
  newsRes: any[]
): ClaimAnalysis {
  const hasFactCheck = !!factCheckRes;
  const hasHealth = healthRes.length > 0;
  const hasNews = newsRes.length > 0;

  let verdict = "Unverified";
  let credibility: "low" | "medium" | "high" | "none" = "none";
  let explanation = "No trusted sources could verify this statement at this time.";

  if (hasFactCheck) {
    verdict = factCheckRes.verdict;
    const loweredVerdict = verdict.toLowerCase();
    if (
      loweredVerdict.includes("false") ||
      loweredVerdict.includes("incorrect") ||
      loweredVerdict.includes("fake") ||
      loweredVerdict.includes("misleading") ||
      loweredVerdict.includes("debunk")
    ) {
      credibility = "low";
      explanation = `Google Fact Check database matches a debunked claim: "${factCheckRes.explanation}".`;
    } else {
      credibility = "high";
      explanation = `Google Fact Check database matches a verified claim: "${factCheckRes.explanation}".`;
    }
  } else if (hasHealth) {
    verdict = "Scientifically supported";
    credibility = "high";
    explanation = `Peer-reviewed scientific literature corroborates this claim (found ${healthRes.length} studies).`;
  } else if (hasNews) {
    verdict = "Widely reported";
    credibility = "high";
    explanation = `High-credibility news reports corroborate this claim (found ${newsRes.length} articles).`;
  }

  return {
    containsClaim: true,
    claim: claimText,
    category: category as any,
    isSatire: false,
    verdict,
    credibility,
    confidence,
    explanation,
    alternativeExplanation: "Retrieved via local intelligence verification tools.",
    sourceName: factCheckRes ? factCheckRes.source : (hasHealth ? healthRes[0].journal : newsRes[0]?.source),
    sourceUrl: factCheckRes ? factCheckRes.url : (hasHealth ? healthRes[0].url : newsRes[0]?.url),
    factCheck: factCheckRes,
    healthResearch: hasHealth ? {
      status: "Scientifically supported" as any,
      summary: explanation,
      sources: healthRes,
    } : null,
    newsVerification: hasNews ? {
      status: "Widely reported" as any,
      summary: explanation,
      sources: newsRes,
    } : null,
  };
}

