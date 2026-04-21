/**
 * Pluggable storage: Vercel KV in production, in-memory Map in dev.
 * Both expose the same async Record<string, unknown>-style interface.
 *
 * In prod, set KV_REST_API_URL and KV_REST_API_TOKEN env vars (Vercel KV
 * auto-injects these). In dev, everything just lives in process memory.
 */

const hasKV = !!process.env.KV_REST_API_URL && !!process.env.KV_REST_API_TOKEN;

interface Storage {
  get<T = unknown>(key: string): Promise<T | null>;
  set<T = unknown>(key: string, value: T): Promise<void>;
  del(key: string): Promise<void>;
  keys(pattern: string): Promise<string[]>;
  lpush(key: string, value: string): Promise<void>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
  lrem(key: string, count: number, value: string): Promise<void>;
}

// ─── In-memory fallback ─────────────────────────────────────────────────────

class MemoryStorage implements Storage {
  private kv = new Map<string, string>();
  private lists = new Map<string, string[]>();

  async get<T>(key: string): Promise<T | null> {
    const raw = this.kv.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  }
  async set<T>(key: string, value: T): Promise<void> {
    this.kv.set(key, JSON.stringify(value));
  }
  async del(key: string): Promise<void> {
    this.kv.delete(key);
    this.lists.delete(key);
  }
  async keys(pattern: string): Promise<string[]> {
    const rx = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$");
    return Array.from(this.kv.keys()).filter((k) => rx.test(k));
  }
  async lpush(key: string, value: string): Promise<void> {
    const arr = this.lists.get(key) || [];
    arr.unshift(value);
    this.lists.set(key, arr);
  }
  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    const arr = this.lists.get(key) || [];
    const end = stop === -1 ? arr.length : stop + 1;
    return arr.slice(start, end);
  }
  async lrem(key: string, count: number, value: string): Promise<void> {
    const arr = this.lists.get(key) || [];
    let removed = 0;
    const out: string[] = [];
    for (const v of arr) {
      if (v === value && (count === 0 || removed < count)) {
        removed++;
      } else {
        out.push(v);
      }
    }
    this.lists.set(key, out);
  }
}

// ─── Vercel KV adapter ──────────────────────────────────────────────────────

async function getKV() {
  const { kv } = await import("@vercel/kv");
  return kv;
}

class VercelKVStorage implements Storage {
  async get<T>(key: string): Promise<T | null> {
    const kv = await getKV();
    return (await kv.get<T>(key)) ?? null;
  }
  async set<T>(key: string, value: T): Promise<void> {
    const kv = await getKV();
    await kv.set(key, value as object);
  }
  async del(key: string): Promise<void> {
    const kv = await getKV();
    await kv.del(key);
  }
  async keys(pattern: string): Promise<string[]> {
    const kv = await getKV();
    // KV supports scan via keys command
    return await kv.keys(pattern);
  }
  async lpush(key: string, value: string): Promise<void> {
    const kv = await getKV();
    await kv.lpush(key, value);
  }
  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    const kv = await getKV();
    return await kv.lrange(key, start, stop);
  }
  async lrem(key: string, count: number, value: string): Promise<void> {
    const kv = await getKV();
    await kv.lrem(key, count, value);
  }
}

// Keep a single instance so MemoryStorage survives within a serverless invocation.
// (Across cold starts, in-memory resets — that's fine for dev.)
declare global {
  var __zoStorage: Storage | undefined;
}
if (!globalThis.__zoStorage) {
  globalThis.__zoStorage = hasKV ? new VercelKVStorage() : new MemoryStorage();
}

export const storage: Storage = globalThis.__zoStorage;
export const isProd = hasKV;
