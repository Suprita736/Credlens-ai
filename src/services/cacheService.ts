import type { ClaimAnalysis } from "../types";

export interface CachedEntry {
  data: ClaimAnalysis;
  timestamp: number;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const CACHE_PREFIX_VIDEO = "credlens_cache_";
const CACHE_PREFIX_CLAIM = "credlens_claim_cache_";
const MAX_L1_ENTRIES = 30;
const DB_NAME = "credlens-db";
const DB_VERSION = 1;
const STORE_NAME = "cache";

export class CacheService {
  // L1 Cache: In-memory Map
  private static l1Cache = new Map<string, CachedEntry>();

  // IndexedDB initialization helper
  private static openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  /**
   * Computes a standard SHA-256 hash of a claim to perform duplicate cross-video caching.
   */
  static async computeClaimHash(claim: string): Promise<string> {
    const msgBuffer = new TextEncoder().encode(claim.trim().toLowerCase());
    const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  /**
   * Get item from IndexedDB (L3)
   */
  private static async getL3(key: string): Promise<CachedEntry | null> {
    try {
      const db = await this.openDB();
      return new Promise((resolve) => {
        const transaction = db.transaction(STORE_NAME, "readonly");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(key);

        request.onsuccess = () => {
          resolve(request.result || null);
        };
        request.onerror = () => {
          resolve(null);
        };
      });
    } catch (err) {
      console.warn("[CacheService] IndexedDB read failed, falling back:", err);
      return null;
    }
  }

  /**
   * Set item in IndexedDB (L3)
   */
  private static async setL3(key: string, entry: CachedEntry): Promise<void> {
    try {
      const db = await this.openDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, "readwrite");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.put(entry, key);

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } catch (err) {
      console.warn("[CacheService] IndexedDB write failed:", err);
    }
  }

  /**
   * Remove item from IndexedDB (L3)
   */
  private static async removeL3(key: string): Promise<void> {
    try {
      const db = await this.openDB();
      return new Promise((resolve) => {
        const transaction = db.transaction(STORE_NAME, "readwrite");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.delete(key);
        request.onsuccess = () => resolve();
        request.onerror = () => resolve();
      });
    } catch (err) {
      console.warn("[CacheService] IndexedDB remove failed:", err);
    }
  }

  /**
   * Prunes oldest L1 items to maintain max L1 entries.
   */
  private static maintainL1Limit(): void {
    if (this.l1Cache.size > MAX_L1_ENTRIES) {
      const firstKey = this.l1Cache.keys().next().value;
      if (firstKey !== undefined) {
        this.l1Cache.delete(firstKey);
      }
    }
  }

  /**
   * High-speed, tiered cache lookup: L1 -> L2 -> L3.
   */
  static async get(videoId: string): Promise<ClaimAnalysis | null> {
    const key = `${CACHE_PREFIX_VIDEO}${videoId}`;
    return this.getByKey(key);
  }

  /**
   * Lookup cache by claim hash.
   */
  static async getByClaimHash(hash: string): Promise<ClaimAnalysis | null> {
    const key = `${CACHE_PREFIX_CLAIM}${hash}`;
    return this.getByKey(key);
  }

  /**
   * Generic lookup key and populates higher tiers if found in lower tiers.
   */
  private static async getByKey(key: string): Promise<ClaimAnalysis | null> {
    const now = Date.now();

    // 1. Tier 1: In-memory L1
    const l1Entry = this.l1Cache.get(key);
    if (l1Entry) {
      if (now - l1Entry.timestamp < CACHE_TTL_MS) {
        console.log(`[CacheService] L1 (Memory) Hit: ${key}`);
        // Refresh position in Map for LRU
        this.l1Cache.delete(key);
        this.l1Cache.set(key, l1Entry);
        return l1Entry.data;
      } else {
        console.log(`[CacheService] L1 Expired: ${key}`);
        this.l1Cache.delete(key);
      }
    }

    // 2. Tier 2: chrome.storage.local L2
    try {
      const cached = await chrome.storage.local.get([key]);
      const l2Entry = cached[key] as CachedEntry | undefined;
      if (l2Entry) {
        if (now - l2Entry.timestamp < CACHE_TTL_MS) {
          console.log(`[CacheService] L2 (chrome.storage) Hit: ${key}`);
          // Populate L1
          this.l1Cache.set(key, l2Entry);
          this.maintainL1Limit();
          return l2Entry.data;
        } else {
          console.log(`[CacheService] L2 Expired: ${key}`);
          await chrome.storage.local.remove(key);
        }
      }
    } catch (err) {
      console.warn("[CacheService] L2 lookup failed:", err);
    }

    // 3. Tier 3: IndexedDB L3
    const l3Entry = await this.getL3(key);
    if (l3Entry) {
      if (now - l3Entry.timestamp < CACHE_TTL_MS) {
        console.log(`[CacheService] L3 (IndexedDB) Hit: ${key}`);
        // Populate L1 & L2
        this.l1Cache.set(key, l3Entry);
        this.maintainL1Limit();
        try {
          await chrome.storage.local.set({ [key]: l3Entry });
        } catch (err) {
          console.warn("[CacheService] L2 populate failed:", err);
        }
        return l3Entry.data;
      } else {
        console.log(`[CacheService] L3 Expired: ${key}`);
        await this.removeL3(key);
      }
    }

    return null;
  }

  /**
   * Caches results in all three tiers.
   */
  static async set(
    videoId: string,
    claimHash: string | null,
    data: ClaimAnalysis
  ): Promise<void> {
    const timestamp = Date.now();
    const entry: CachedEntry = { data, timestamp };

    const videoKey = `${CACHE_PREFIX_VIDEO}${videoId}`;
    const claimKey = claimHash ? `${CACHE_PREFIX_CLAIM}${claimHash}` : null;

    // Write to L1
    this.l1Cache.set(videoKey, entry);
    this.maintainL1Limit();
    if (claimKey) {
      this.l1Cache.set(claimKey, entry);
      this.maintainL1Limit();
    }

    // Write to L2
    try {
      const storageObj: { [key: string]: CachedEntry } = { [videoKey]: entry };
      if (claimKey) {
        storageObj[claimKey] = entry;
      }
      await chrome.storage.local.set(storageObj);
    } catch (err) {
      console.warn("[CacheService] L2 write failed:", err);
    }

    // Write to L3
    await this.setL3(videoKey, entry);
    if (claimKey) {
      await this.setL3(claimKey, entry);
    }

    console.log(
      `[CacheService] Successfully cached results for videoId: ${videoId}` +
      (claimHash ? ` & claimHash: ${claimHash.slice(0, 12)}…` : "")
    );
  }

  /**
   * Prunes expired cache entries across L2 and L3.
   */
  static async prune(): Promise<void> {
    const now = Date.now();
    console.log("[CacheService] Starting cache prune process...");

    // Prune L1
    for (const [key, entry] of this.l1Cache.entries()) {
      if (now - entry.timestamp > CACHE_TTL_MS) {
        this.l1Cache.delete(key);
      }
    }

    // Prune L2 (chrome.storage)
    try {
      const all = await chrome.storage.local.get(null);
      const toDeleteL2: string[] = [];
      const validL2: { key: string; timestamp: number }[] = [];

      for (const key of Object.keys(all)) {
        if (key.startsWith(CACHE_PREFIX_VIDEO) || key.startsWith(CACHE_PREFIX_CLAIM)) {
          const entry = all[key] as CachedEntry | undefined;
          if (!entry || !entry.timestamp || now - entry.timestamp > CACHE_TTL_MS) {
            toDeleteL2.push(key);
          } else {
            validL2.push({ key, timestamp: entry.timestamp });
          }
        }
      }

      if (toDeleteL2.length > 0) {
        await chrome.storage.local.remove(toDeleteL2);
        console.log(`[CacheService] L2 pruned ${toDeleteL2.length} entries.`);
      }
    } catch (err) {
      console.warn("[CacheService] L2 pruning failed:", err);
    }

    // Prune L3 (IndexedDB)
    try {
      const db = await this.openDB();
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.openCursor();

      request.onsuccess = (event) => {
        const cursor = (event.target as any).result;
        if (cursor) {
          const entry = cursor.value as CachedEntry;
          if (now - entry.timestamp > CACHE_TTL_MS) {
            cursor.delete();
          }
          cursor.continue();
        }
      };
    } catch (err) {
      console.warn("[CacheService] L3 pruning failed:", err);
    }
  }
}
