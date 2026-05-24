import type { ResearchArticle } from "../types";

export class HealthService {
  /**
   * Helper to fetch URLs with timeouts.
   */
  private static async fetchWithTimeout(
    url: string,
    options: RequestInit = {},
    timeoutMs = 6000
  ): Promise<Response> {
    const { signal, ...rest } = options;
    const controller = new AbortController();

    if (signal) {
      signal.addEventListener("abort", () => controller.abort());
    }

    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, { ...rest, signal: controller.signal });
      clearTimeout(timeout);
      return response;
    } catch (err) {
      clearTimeout(timeout);
      throw err;
    }
  }

  /**
   * Cleans a claim string to extract search-friendly terms for PubMed.
   */
  private static extractKeywords(claim: string): string {
    return claim
      .toLowerCase()
      .replace(/[^\w\s]/g, "") // remove punctuation
      .replace(/\b(does|cure|prevent|cause|how|to|the|is|in|of|and|for|on|at|with|by|from|clinical|proven|trial|study|treatment|for|human|medical)\b/gi, "")
      .trim()
      .split(/\s+/)
      .filter((word) => word.length > 2)
      .slice(0, 6) // limit to 6 keywords for better search success
      .join(" AND ");
  }

  /**
   * Searches PubMed for peer-reviewed studies relating to the health claim.
   */
  static async searchPubMed(
    claim: string,
    signal?: AbortSignal
  ): Promise<ResearchArticle[]> {
    const keywords = this.extractKeywords(claim);
    if (!keywords) {
      console.log("[HealthService] Claim has no searchable keywords for PubMed");
      return [];
    }

    console.log(`[HealthService] Searching PubMed with term: "${keywords}"`);
    const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(
      keywords
    )}&retmode=json&retmax=3`;

    try {
      const searchRes = await this.fetchWithTimeout(searchUrl, { signal });
      if (!searchRes.ok) {
        throw new Error(`PubMed Search HTTP error: ${searchRes.status}`);
      }

      const searchData = (await searchRes.json()) as any;
      const ids = searchData.esearchresult?.idlist as string[];

      if (!ids || ids.length === 0) {
        console.log("[HealthService] No PubMed articles found for keywords");
        return [];
      }

      console.log(`[HealthService] Found PubMed IDs: ${ids.join(", ")}. Fetching summaries...`);
      const summaryUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${ids.join(
        ","
      )}&retmode=json`;

      const summaryRes = await this.fetchWithTimeout(summaryUrl, { signal });
      if (!summaryRes.ok) {
        throw new Error(`PubMed Summary HTTP error: ${summaryRes.status}`);
      }

      const summaryData = (await summaryRes.json()) as any;
      const articles: ResearchArticle[] = [];

      for (const id of ids) {
        const doc = summaryData.result?.[id];
        if (doc) {
          const title = doc.title || "Untitled Paper";
          const journal = doc.source || "Unknown Journal";
          const authors = Array.isArray(doc.authors)
            ? doc.authors.map((a: any) => a.name).join(", ")
            : "Unknown Authors";
          const date = doc.pubdate || "Unknown Date";
          const url = `https://pubmed.ncbi.nlm.nih.gov/${id}/`;

          articles.push({
            id,
            title,
            journal,
            authors,
            date,
            url,
          });
        }
      }

      return articles;
    } catch (error: any) {
      if (error.name === "AbortError" || signal?.aborted) {
        console.log("[HealthService] PubMed search aborted");
      } else {
        console.error("[HealthService] PubMed search failed:", error);
      }
      return []; // Return empty list rather than failing
    }
  }
}
