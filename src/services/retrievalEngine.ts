// src/services/retrievalEngine.ts

import { FactCheckService } from "./factCheckService";
import { HealthService } from "./healthService";
import { NewsService } from "./newsService";
import { ClaimRouter } from "../utils/claimRouter";
import type { EvidenceBundle } from "../types";

/**
 * Helper to retry an operation with a delay.
 */
function retryWithDelay<T>(
  fn: () => Promise<T>,
  attempts: number,
  delayMs: number,
  signal?: AbortSignal
): Promise<T> {
  let lastError: any;
  for (let i = 0; i < attempts; i++) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    try {
      return fn();
    } catch (err) {
      lastError = err;
      if (i < attempts - 1) {
        return new Promise<T>((_, reject) => {
          const t = setTimeout(() => {
            fn().then(_).catch(reject);
          }, delayMs);
          signal?.addEventListener("abort", () => {
            clearTimeout(t);
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
      }
    }
  }
  return Promise.reject(lastError);
}

/**
 * Standardized Retrieval Engine.
 * Coordinates concurrent queries to FactCheck, PubMed, and Google News services.
 */
export class RetrievalEngine {
  /**
   * Concurrently queries modular verification services based on the category.
   * Returns a standardized EvidenceBundle.
   */
  static async retrieve(
    claim: string,
    category: string,
    apiKey: string,
    signal?: AbortSignal
  ): Promise<EvidenceBundle> {
    console.log(`[RetrievalEngine] Initiating concurrent verification search for category: ${category}`);

    const [factCheckRes, healthRes, newsRes] = await Promise.all([
      // Google Fact Check search (with retry wrapper)
      retryWithDelay(
        () => FactCheckService.verifyClaim(claim, apiKey, signal),
        1,
        1000,
        signal
      ).catch((err: any) => {
        console.error("[RetrievalEngine] Service failure (FactCheck):", err);
        return null;
      }),

      // PubMed health search (if health category)
      ClaimRouter.shouldSearchPubMed(category)
        ? retryWithDelay(
            () => HealthService.searchPubMed(claim, signal),
            1,
            1000,
            signal
          ).catch((err: any) => {
            console.error("[RetrievalEngine] Service failure (Health PubMed):", err);
            return [];
          })
        : Promise.resolve([]),

      // Google News search (if news/politics/other category)
      ClaimRouter.shouldSearchNews(category)
        ? retryWithDelay(
            () => NewsService.searchNews(claim, signal),
            1,
            1000,
            signal
          ).catch((err: any) => {
            console.error("[RetrievalEngine] Service failure (Google News):", err);
            return [];
          })
        : Promise.resolve([]),
    ]);

    return {
      factCheck: factCheckRes,
      healthResearch: healthRes,
      newsArticles: newsRes,
    };
  }
}
