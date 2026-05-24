import { QueueManager } from "./queueManager";
import { GeminiService } from "../services/geminiService";
import { FactCheckService } from "../services/factCheckService";
import { HealthService } from "../services/healthService";
import { NewsService } from "../services/newsService";
import type { ClaimAnalysis, BackgroundMessage, BackgroundResponse } from "../types";

// ─── Cache configuration ───────────────────────────────────────────────────────
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const CACHE_PREFIX_VIDEO = "credlens_cache_";
const CACHE_PREFIX_CLAIM = "credlens_claim_cache_";
const MAX_CACHE_ENTRIES = 50; // total cached items before pruning oldest

interface CachedEntry {
  data: ClaimAnalysis;
  timestamp: number;
}

/**
 * Robust retry helper for transient network failures.
 */
async function retryWithDelay<T>(
  fn: () => Promise<T>,
  retries = 2,
  delayMs = 1500,
  signal?: AbortSignal
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (retries <= 0 || signal?.aborted) {
      throw error;
    }
    console.warn(`[Background] Retrying operation due to failure (${retries} left). Error:`, error);
    if (signal) {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(resolve, delayMs);
        signal.addEventListener("abort", () => {
          clearTimeout(timeout);
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    } else {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    return retryWithDelay(fn, retries - 1, delayMs, signal);
  }
}

/**
 * Computes a standard SHA-256 hash of a claim to perform duplicate cross-video caching.
 */
async function computeClaimHash(claim: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(claim.trim().toLowerCase());
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Prune expired and excess cache entries from chrome.storage.local.
 * Called once on extension install/startup.
 */
async function pruneCache(): Promise<void> {
  try {
    const all = await chrome.storage.local.get(null);
    const now = Date.now();
    const credlensKeys = Object.keys(all).filter(
      (k) => k.startsWith(CACHE_PREFIX_VIDEO) || k.startsWith(CACHE_PREFIX_CLAIM)
    );

    const toDelete: string[] = [];
    const validEntries: { key: string; timestamp: number }[] = [];

    for (const key of credlensKeys) {
      const entry = all[key] as CachedEntry | undefined;
      if (!entry || !entry.timestamp || now - entry.timestamp > CACHE_TTL_MS) {
        toDelete.push(key); // expired
      } else {
        validEntries.push({ key, timestamp: entry.timestamp });
      }
    }

    // If still over limit after TTL pruning, delete oldest first
    if (validEntries.length > MAX_CACHE_ENTRIES) {
      validEntries.sort((a, b) => a.timestamp - b.timestamp);
      const overflow = validEntries.splice(0, validEntries.length - MAX_CACHE_ENTRIES);
      overflow.forEach((e) => toDelete.push(e.key));
    }

    if (toDelete.length > 0) {
      await chrome.storage.local.remove(toDelete);
      console.log(`[Background] Cache pruned: removed ${toDelete.length} entries.`);
    } else {
      console.log(`[Background] Cache healthy: ${validEntries.length} entries.`);
    }
  } catch (err) {
    console.warn("[Background] Cache pruning failed:", err);
  }
}

// Run cache pruning on install and startup
chrome.runtime.onInstalled.addListener(() => {
  console.log("[Background] CredLens AI installed/updated.");
  pruneCache();
});

chrome.runtime.onStartup.addListener(() => {
  pruneCache();
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
      
      // Start processing pipeline
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
        error: "Missing API Key. Please click the extension icon and configure your Gemini API Key.",
      });
      QueueManager.complete(videoId);
      return;
    }

    // 3. Double-Layer Cache Level 1: Check Video ID Cache (with TTL)
    const cachedVideo = await chrome.storage.local.get([`${CACHE_PREFIX_VIDEO}${videoId}`]);
    const videoEntry = cachedVideo[`${CACHE_PREFIX_VIDEO}${videoId}`] as CachedEntry | undefined;
    if (videoEntry) {
      const age = Date.now() - (videoEntry.timestamp ?? 0);
      if (age < CACHE_TTL_MS) {
        console.log(`[Background] Cache Hit (Video ID): ${videoId} (age: ${Math.round(age / 1000)}s)`);
        postResponse(port, { status: "completed", videoId, analysis: videoEntry.data });
        QueueManager.complete(videoId);
        return;
      } else {
        console.log(`[Background] Cache Expired (Video ID): ${videoId}`);
        await chrome.storage.local.remove(`${CACHE_PREFIX_VIDEO}${videoId}`);
      }
    }

    if (signal.aborted) throw new DOMException("Aborted", "AbortError");

    // 4. Initialize Gemini Service
    const gemini = new GeminiService(apiKey);

    // 5. Stage A: Extract claims, category, and satire flags (Minimizes token/quota costs)
    console.log("[Background] Extracting claims from transcript...");
    const claimAnalysis = await retryWithDelay(
      () => gemini.analyzeTranscript(transcript, signal),
      1,
      1000,
      signal
    );

    if (signal.aborted) throw new DOMException("Aborted", "AbortError");

    // If no claims are found or it's comedy/satire, stop the pipeline early (Quota Saver!)
    if (!claimAnalysis.containsClaim || claimAnalysis.isSatire) {
      console.log("[Background] No factual claims found or satire detected. Finalizing...");
      const finalResult: ClaimAnalysis = {
        containsClaim: false,
        isSatire: claimAnalysis.isSatire,
        reasoning: claimAnalysis.reasoning,
        verdict: claimAnalysis.isSatire ? "Satire / Entertainment" : "No verifiable claims detected",
        credibility: "none",
      };

      // Cache and respond
      await cacheResult(videoId, null, finalResult);
      postResponse(port, { status: "completed", videoId, analysis: finalResult });
      QueueManager.complete(videoId);
      return;
    }

    const claimText = claimAnalysis.claim!;
    const category = claimAnalysis.category || "other";
    console.log(`[Background] Flagged Claim: "${claimText}" in category: ${category}`);

    // 6. Double-Layer Cache Level 2: Check Claim Hash Cache (with TTL)
    const claimHash = await computeClaimHash(claimText);
    const cachedClaim = await chrome.storage.local.get([`${CACHE_PREFIX_CLAIM}${claimHash}`]);
    const claimEntry = cachedClaim[`${CACHE_PREFIX_CLAIM}${claimHash}`] as CachedEntry | undefined;
    if (claimEntry) {
      const age = Date.now() - (claimEntry.timestamp ?? 0);
      if (age < CACHE_TTL_MS) {
        console.log(`[Background] Cache Hit (Claim Hash): ${claimHash.slice(0, 12)}… (age: ${Math.round(age / 1000)}s)`);
        await cacheResult(videoId, claimHash, claimEntry.data);
        postResponse(port, { status: "completed", videoId, analysis: claimEntry.data });
        QueueManager.complete(videoId);
        return;
      } else {
        console.log(`[Background] Cache Expired (Claim Hash): ${claimHash.slice(0, 12)}…`);
        await chrome.storage.local.remove(`${CACHE_PREFIX_CLAIM}${claimHash}`);
      }
    }

    if (signal.aborted) throw new DOMException("Aborted", "AbortError");

    // 7. Stage B: Search External Verification Databases (MODULAR CONCURRENCY & FAIL-SAFES)
    console.log("[Background] Initiating concurrent verification searches...");

    const [factCheckRes, healthRes, newsRes] = await Promise.all([
      // Google Fact Check search (with retry wrapper)
      retryWithDelay(
        () => FactCheckService.verifyClaim(claimText, apiKey, signal),
        1,
        1000,
        signal
      ).catch((err) => {
        console.error("[Background] Modular service failure (FactCheck):", err);
        return null;
      }),

      // PubMed health search (if health category)
      (category === "health" || category === "science")
        ? retryWithDelay(
            () => HealthService.searchPubMed(claimText, signal),
            1,
            1000,
            signal
          ).catch((err) => {
            console.error("[Background] Modular service failure (Health PubMed):", err);
            return [];
          })
        : Promise.resolve([]),

      // Google News search (if news/politics/other category)
      (category !== "health")
        ? retryWithDelay(
            () => NewsService.searchNews(claimText, signal),
            1,
            1000,
            signal
          ).catch((err) => {
            console.error("[Background] Modular service failure (Google News):", err);
            return [];
          })
        : Promise.resolve([]),
    ]);

    if (signal.aborted) throw new DOMException("Aborted", "AbortError");

    console.log("[Background] External searches complete. Synthesizing evidence...");

    // 8. Stage C: Synthesize final soft correction using Gemini (Enforces tone & educational rules)
    const synthesisInput = {
      factCheck: factCheckRes,
      healthResearch: healthRes,
      newsArticles: newsRes,
    };

    const synthesizedAnalysis = await retryWithDelay(
      () => gemini.synthesizeVerification(claimText, category, synthesisInput, signal),
      1,
      1000,
      signal
    );

    if (signal.aborted) throw new DOMException("Aborted", "AbortError");

    // Attach rich structural sub-blocks for UI details
    synthesizedAnalysis.factCheck = factCheckRes;
    synthesizedAnalysis.healthResearch = healthRes.length > 0 ? {
      status: synthesizedAnalysis.verdict as any,
      summary: synthesizedAnalysis.explanation || "",
      sources: healthRes
    } : null;
    synthesizedAnalysis.newsVerification = newsRes.length > 0 ? {
      status: synthesizedAnalysis.verdict as any,
      summary: synthesizedAnalysis.explanation || "",
      sources: newsRes
    } : null;

    // 9. Double Caching
    await cacheResult(videoId, claimHash, synthesizedAnalysis);

    // 10. Respond success
    postResponse(port, {
      status: "completed",
      videoId,
      analysis: synthesizedAnalysis,
    });
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
 * Caches a structured analysis in chrome.storage.local with a timestamp.
 */
async function cacheResult(
  videoId: string,
  claimHash: string | null,
  result: ClaimAnalysis
): Promise<void> {
  const entry: CachedEntry = { data: result, timestamp: Date.now() };
  const cacheObj: { [key: string]: CachedEntry } = {};
  cacheObj[`${CACHE_PREFIX_VIDEO}${videoId}`] = entry;

  if (claimHash) {
    cacheObj[`${CACHE_PREFIX_CLAIM}${claimHash}`] = entry;
  }

  await chrome.storage.local.set(cacheObj);
  console.log(
    `[Background] Cached results for Video: ${videoId}` +
      (claimHash ? ` & ClaimHash: ${claimHash.slice(0, 12)}…` : "")
  );
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
chrome.runtime.onSuspend.addListener(() => {
  QueueManager.cancelAll();
});
