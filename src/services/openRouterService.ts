// src/services/openRouterService.ts

import type { AIProvider, ClaimAnalysis, EvidenceBundle } from "../types";

/**
 * OpenRouterProvider implements AIProvider using the OpenRouter API.
 * It follows the same contract as other providers (Gemini, etc.)
 * and returns a ClaimAnalysis object.
 */
export class OpenRouterProvider implements AIProvider {
  private readonly endpoint = "https://openrouter.ai/api/v1/chat/completions";
  private readonly model = "openai/gpt-4o-mini"; // default model, can be switched via config later
  private readonly timeoutMs = 8000;
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async analyzeClaim(
    claim: string,
    evidence?: EvidenceBundle
  ): Promise<ClaimAnalysis> {
    // Build minimal payload according to token optimization rules
    const messages = [
      {
        role: "system",
        content:
          "You are an expert fact‑checker. Provide a concise verification of the given claim. Use only the supplied evidence. Respond with a JSON object matching the ClaimAnalysis interface.",
      },
      {
        role: "user",
        content: this.buildUserContent(claim, evidence),
      },
    ];

    const body = {
      model: this.model,
      messages,
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const txt = await response.text();
      throw new Error(`OpenRouter error ${response.status}: ${txt}`);
    }

    const data = await response.json();
    // Assuming the model returns a JSON string in the first choice
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("OpenRouter returned empty content");
    }
    // Try to parse JSON; fallback to a minimal analysis if parsing fails
    try {
      const parsed: ClaimAnalysis = JSON.parse(content);
      return parsed;
    } catch {
      // Fallback: create a basic analysis object
      return {
        containsClaim: true,
        isSatire: false,
        claim,
        reasoning: "OpenRouter could not parse structured response; returning basic verdict.",
        verdict: "Unable to verify",
        credibility: "low",
        confidence: 0,
      } as ClaimAnalysis;
    }
  }

  private buildUserContent(claim: string, evidence?: EvidenceBundle): string {
    let payload = `Claim: "${claim}"\n`;
    if (evidence) {
      payload += "Evidence:\n";
      if (evidence.factCheck) payload += `FactCheck: ${JSON.stringify(evidence.factCheck)}\n`;
      if (evidence.healthResearch) payload += `Health: ${JSON.stringify(evidence.healthResearch)}\n`;
      if (evidence.newsArticles) payload += `News: ${JSON.stringify(evidence.newsArticles)}\n`;
    }
    payload += "\nProvide a concise verification result in JSON format matching the ClaimAnalysis type.";
    return payload;
  }
}

