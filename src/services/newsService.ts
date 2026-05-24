import type { NewsArticle } from "../types";

export class NewsService {
  // List of high-credibility news sources
  private static TRUSTED_SOURCES = [
    "reuters",
    "associated press",
    "ap news",
    "ap",
    "bbc news",
    "bbc",
    "bloomberg",
    "cnbc",
    "financial times",
    "the guardian",
    "the new york times",
    "new york times",
    "the washington post",
    "washington post",
    "npr",
    "pbs",
    "cbs news",
    "abc news",
    "nbc news",
    "cnn",
    "official government",
    "world health organization",
    "who",
    "cdc",
    "nih"
  ];

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
   * Parses RSS XML using standard RegExp to avoid DOMParser inside MV3 service workers.
   */
  private static parseRss(xmlText: string): NewsArticle[] {
    const articles: NewsArticle[] = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;

    const clean = (str: string) => {
      if (!str) return "";
      return str
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1") // remove CDATA wrapper
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .trim();
    };

    while ((match = itemRegex.exec(xmlText)) !== null) {
      const itemContent = match[1];

      const titleMatch = itemContent.match(/<title>([\s\S]*?)<\/title>/);
      const linkMatch = itemContent.match(/<link>([\s\S]*?)<\/link>/);
      const pubDateMatch = itemContent.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
      const sourceMatch = itemContent.match(/<source[^>]*>([\s\S]*?)<\/source>/);

      if (titleMatch && linkMatch) {
        articles.push({
          title: clean(titleMatch[1]),
          url: clean(linkMatch[1]),
          date: pubDateMatch ? clean(pubDateMatch[1]) : "Unknown Date",
          source: sourceMatch ? clean(sourceMatch[1]) : "Google News",
        });
      }
    }

    return articles;
  }

  /**
   * Extracts search-friendly terms for Google News RSS.
   */
  private static extractKeywords(claim: string): string {
    return claim
      .toLowerCase()
      .replace(/[^\w\s]/g, "") // remove punctuation
      .replace(/\b(does|cure|prevent|cause|how|to|the|is|in|of|and|for|on|at|with|by|from|say|says|what|new|latest|reports|video|short)\b/gi, "")
      .trim()
      .split(/\s+/)
      .filter((word) => word.length > 2)
      .slice(0, 6) // limit to 6 keywords for precision
      .join(" ");
  }

  /**
   * Searches trusted news reporting for a current event or news claim.
   */
  static async searchNews(
    claim: string,
    signal?: AbortSignal
  ): Promise<NewsArticle[]> {
    const keywords = this.extractKeywords(claim);
    if (!keywords) {
      console.log("[NewsService] Claim has no searchable keywords for Google News");
      return [];
    }

    // Google News RSS search URL
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(
      keywords
    )}&hl=en-US&gl=US&ceid=US:en`;

    console.log(`[NewsService] Querying Google News RSS for: "${keywords}"`);

    try {
      const response = await this.fetchWithTimeout(url, { signal });
      if (!response.ok) {
        throw new Error(`Google News RSS HTTP error: ${response.status}`);
      }

      const xmlText = await response.text();
      const allArticles = this.parseRss(xmlText);

      console.log(`[NewsService] Extracted ${allArticles.length} articles from feed`);

      if (allArticles.length === 0) {
        return [];
      }

      // Prioritize and filter articles from highly trusted sources
      const trustedArticles: NewsArticle[] = [];
      const standardArticles: NewsArticle[] = [];

      for (const art of allArticles) {
        const srcLower = art.source.toLowerCase();
        const isTrusted = this.TRUSTED_SOURCES.some((trusted) =>
          srcLower.includes(trusted)
        );

        if (isTrusted) {
          trustedArticles.push(art);
        } else {
          standardArticles.push(art);
        }
      }

      console.log(
        `[NewsService] Split: ${trustedArticles.length} trusted sources, ${standardArticles.length} standard sources`
      );

      // Return a curated list (prioritize trusted, fallback to standard, cap at 3)
      const results = [...trustedArticles, ...standardArticles].slice(0, 3);
      return results;
    } catch (error: any) {
      if (error.name === "AbortError" || signal?.aborted) {
        console.log("[NewsService] News search aborted");
      } else {
        console.error("[NewsService] News search failed:", error);
      }
      return []; // Return empty list rather than failing
    }
  }
}
