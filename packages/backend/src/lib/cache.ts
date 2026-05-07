/**
 * Tiny in-memory TTL cache. Used by the AI analysis endpoints so we don't
 * pay Bedrock latency + cost on every page hit. Interface is deliberately
 * narrow so we can swap in Redis later without touching call sites.
 */

export interface AsyncCache<V> {
  get(key: string): Promise<V | undefined>;
  set(key: string, value: V, ttlMs: number): Promise<void>;
}

interface Entry<V> {
  value: V;
  expiresAt: number;
}

export class InMemoryTTLCache<V> implements AsyncCache<V> {
  private readonly store = new Map<string, Entry<V>>();

  async get(key: string): Promise<V | undefined> {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  async set(key: string, value: V, ttlMs: number): Promise<void> {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }
}
