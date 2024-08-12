import { Database, open } from "lmdb";

export type HandleFunction = (request: Request) => Promise<Response> | Response;
export type CacheMiddleware = (
  request: Request,
  handle: HandleFunction
) => Promise<Response>;

interface CacheEntry {
  response: CachedResponse;
  timestamp: number; //timestamp - when the response was cached
  expires: number | null;
  lastModified: string | null;
  etag: string | null;
}

interface CachedResponse {
  body: ArrayBuffer | Buffer;
  headers: Record<string, string>;
  status: number;
  statusText: string;
}

export interface CacheOptions {
  maxAge?: number;
  staleWhileRevalidate?: number;
  cacheableStatusCodes?: number[];
  storagePath?: string;
}

// cache config default values.
const DEFAULT_MAX_AGE = 3600; // 1 hour
const DEFAULT_CACHEABLE_STATUS_CODES = [200, 301, 302, 307, 308];
const DEFAULT_STALE_WHILE_REVALIDATE = 300; // 5 minutes

/**
 * Creates the cache middleware.
 *
 * @param {CacheOptions} options - Configuration options for the cache middleware.
 * @param {string} options.storagePath - Path to the storage location for cached data.
 * @param {number} [options.maxAge=DEFAULT_MAX_AGE] - Maximum age for cached entries (in seconds). Default is 1 hour.
 * @param {number} [options.staleWhileRevalidate=DEFAULT_STALE_WHILE_REVALIDATE] - Time to serve stale content while revalidating. Default is 5 minutes.
 * @param {number[]} [options.cacheableStatusCodes=DEFAULT_CACHEABLE_STATUS_CODES] - List of status codes that are cacheable. Default is [200, 301, 302, 307, 308].
 * @returns {CacheMiddleware} The cache middleware function.
 */
export function createCacheMiddleware(options: CacheOptions): CacheMiddleware {
  const {
    storagePath,
    maxAge = DEFAULT_MAX_AGE,
    staleWhileRevalidate = DEFAULT_STALE_WHILE_REVALIDATE,
    cacheableStatusCodes = DEFAULT_CACHEABLE_STATUS_CODES,
  } = options;

  const db = open({
    path: storagePath,
    compression: true,
  });

  return async (
    request: Request,
    handle: HandleFunction
  ): Promise<Response> => {
    const cacheKey = `${request.method}:${request.url}`;

    if (!isCacheableRequest(request)) {
      return handle(request);
    }

    const cachedEntry = await getCachedResponse(db, cacheKey);

    if (cachedEntry) {
      const response = await fromCachedResponse(cachedEntry.response);
      if (isFresh(cachedEntry, maxAge)) {
        return addCacheStatusHeader(response, "hit");
      }

      if (
        staleWhileRevalidate > 0 &&
        isWithinStaleWhileRevalidate(cachedEntry, maxAge, staleWhileRevalidate)
      ) {
        updateCacheInBackground(
          request,
          handle,
          db,
          cacheKey,
          cacheableStatusCodes
        );

        return addCacheStatusHeader(response, "stale");
      }
    }

    const response = await handle(request);

    if (isCacheableResponse(response, cacheableStatusCodes)) {
      await cacheResponse(db, cacheKey, response);
    }

    return addCacheStatusHeader(response, "miss");
  };
}

function isCacheableRequest(request: Request): boolean {
  return request.method === "GET" || request.method === "HEAD";
}

async function getCachedResponse(
  db: Database,
  key: string
): Promise<CacheEntry | null> {
  const cachedEntry = await db.get(key);
  if (cachedEntry) {
    return cachedEntry;
  }
  return null;
}

function isFresh(entry: CacheEntry, maxAge: number): boolean {
  if (entry.expires) {
    return entry.expires > Date.now();
  }
  return Date.now() - entry.timestamp < maxAge * 1000;
}

function isWithinStaleWhileRevalidate(
  entry: CacheEntry,
  maxAge: number,
  staleWhileRevalidate: number
): boolean {
  const age = Date.now() - entry.timestamp;
  return age < (maxAge + staleWhileRevalidate) * 1000;
}

async function updateCacheInBackground(
  request: Request,
  handle: HandleFunction,
  db: Database,
  cacheKey: string,
  cacheableStatusCodes: number[]
): Promise<void> {
  try {
    const response = await handle(request);
    if (isCacheableResponse(response, cacheableStatusCodes)) {
      await cacheResponse(db, cacheKey, response);
    }
  } catch (error) {
    console.error("Error updating cache in background:", error);
  }
}

function isCacheableResponse(
  response: Response,
  cacheableStatusCodes: number[]
): boolean {
  return cacheableStatusCodes.includes(response.status);
}

async function cacheResponse(
  db: Database,
  key: string,
  response: Response
): Promise<void> {
  const cacheControl = response.headers.get("cache-control");
  const expires = response.headers.get("expires");
  const lastModified = response.headers.get("last-modified");
  const etag = response.headers.get("etag");

  const entry: CacheEntry = {
    response: await toCachedResponse(response.clone()),
    timestamp: Date.now(),
    expires: expires ? new Date(expires).getTime() : null,
    lastModified,
    etag,
  };

  if (cacheControl) {
    const maxAge = parseMaxAge(cacheControl);
    if (maxAge !== null) {
      entry.expires = Date.now() + maxAge * 1000;
    }
  }

  await db.put(key, entry);
}

function parseMaxAge(cacheControl: string): number | null {
  const match = cacheControl.match(/max-age=(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

//helper function to add Cache-Status header
function addCacheStatusHeader(
  response: Response,
  status: "hit" | "miss" | "stale"
): Response {
  response.headers.set(
    "Cache-Status",
    `"http-cache-middleware"; hit${status === "hit" ? "" : "=0"}`
  );
  return response;
}

//convert Response to CachedResponse
async function toCachedResponse(response: Response): Promise<CachedResponse> {
  return {
    headers: Object.fromEntries(response.headers),
    status: response.status,
    statusText: response.statusText,
    body: await response.arrayBuffer(),
  };
}

//convert CachedResponse to Response
async function fromCachedResponse(
  serializedResponse: CachedResponse
): Promise<Response> {
  return new Response(serializedResponse.body, {
    headers: serializedResponse.headers,
    status: serializedResponse.status,
    statusText: serializedResponse.statusText,
  });
}
