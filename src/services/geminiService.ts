import { GoogleGenerativeAI } from "@google/generative-ai";
import type { ClaimAnalysis } from "../types";

export class GeminiService {
  private genAI: GoogleGenerativeAI;
  private model: any;

  constructor(apiKey: string) {
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.model = this.genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
  }

  async analyzeTranscript(transcript: string, signal?: AbortSignal): Promise<ClaimAnalysis> {
    const prompt = `
      Analyze the following transcript from a short-form video.
      Your task is to determine if it contains factual claims that can be verified.

      CRITICAL RULES:
      1. If the content is satire, comedy, jokes, sarcasm, storytelling, or fictional entertainment, set isSatire to true.
      2. If it is satire/comedy, do not look for factual claims.
      3. If it is NOT satire, check for specific factual claims (e.g., health benefits, historical facts, scientific data).
      4. Factual claims must be specific statements presented as truth.
      5. Ignore opinions or subjective statements.

      Output JSON format:
      {
        "containsClaim": boolean,
        "claim": "The core factual claim if found, else null",
        "category": "health | science | politics | finance | other | null",
        "isSatire": boolean,
        "reasoning": "brief explanation"
      }

      Transcript: "${transcript}"
    `;

    try {
      const result = await this.model.generateContent(prompt);
      
      if (signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      const response = await result.response;
      const text = response.text();
      console.log("Raw Gemini response:", text);

      // Clean the response if it contains markdown code blocks
      const jsonStr = text.replace(/```json|```/gi, "").trim();
      const parsed = JSON.parse(jsonStr) as ClaimAnalysis;

      console.log("Parsed Gemini analysis:", parsed);

      return parsed;
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        console.log("Gemini request aborted");

        return {
          containsClaim: false,
          isSatire: false,
          reasoning: "Request aborted"
        };
      }

      console.error("Gemini Analysis Error:", error);
      return {
        containsClaim: false,
        isSatire: false,
        reasoning: "Error during analysis"
      };
    }
  }
}
