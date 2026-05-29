// src/utils/escalationManager.ts

import { OpenRouterProvider } from "../services/openRouterService";
import type { ClaimAnalysis, EvidenceBundle } from "../types";

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
 * Decoupled Escalation Manager.
 * Governs the conditional escalation check and API call to OpenRouter.
 */
export class EscalationManager {
  private static readonly CONFIDENCE_THRESHOLD = 60;

  /**
   * Determines if the claim verification needs escalation to OpenRouter.
   * Exactly matches the original confidence check: confidence < 60
   */
  static shouldEscalate(confidence: number): boolean {
    return confidence < this.CONFIDENCE_THRESHOLD;
  }

  /**
   * Performs escalation to OpenRouter and returns augmented analysis properties.
   * If escalation is not needed or fails, it returns an empty object (no changes).
   */
  static async escalateIfNeeded(
    claim: string,
    evidence: EvidenceBundle,
    confidence: number,
    apiKey: string,
    signal?: AbortSignal
  ): Promise<Partial<ClaimAnalysis>> {
    if (!this.shouldEscalate(confidence)) {
      return {};
    }

    console.log(
      `[EscalationManager] Low confidence (${confidence} < ${this.CONFIDENCE_THRESHOLD}). ` +
        `Escalating to OpenRouter...`
    );

    try {
      const openRouter = new OpenRouterProvider(apiKey);
      const openResult = await retryWithDelay(
        () => openRouter.analyzeClaim(claim, evidence),
        1,
        1000,
        signal
      );
      console.log("[EscalationManager] OpenRouter augmentation completed successfully.");
      return openResult;
    } catch (err: any) {
      console.warn("[EscalationManager] OpenRouter augmentation failed (non-fatal):", err);
      return {};
    }
  }
}
