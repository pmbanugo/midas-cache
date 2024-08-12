# midas-cache: turbo-charge your web apps & APIs

**midas-cache** is a caching middleware that can boost your apps by 70% - 95%. It reduces the response time and increases the number of requests your server can handle. It's intended for use on the server, for server-side rendered apps (e.g. blogs) and regular REST API.

It currently only works with Bun (manually tested ATM), but might work with Deno since because it uses the web platform [Request](https://developer.mozilla.org/en-US/docs/Web/API/Request)/[Response](https://developer.mozilla.org/en-US/docs/Web/API/Response) API. Support for Node.js web servers will be implemented _soon_.

## Installation

_midas-cache_ is currently only available on [JSR](https://jsr.io/@pmbanugo/midas-cache). You can install the package using npm:

```sh
npx jsr add @pmbanugo/midas-cache
```

Or any of the following for other package managers:

```sh
bunx jsr add @pmbanugo/midas-cache
pnpm dlx jsr add @pmbanugo/midas-cache
yarn dlx jsr add @pmbanugo/midas-cache
```

## Usage

To use `midas-cache`, you need to integrate it into your server setup. Below is an example of how to use it with a _Bun_ server:

```typescript
import { createCacheMiddleware } from "@pmbanugo/midas-cache";

const cacheOptions = {
  maxAge: 3600, // 1 hour
  staleWhileRevalidate: 300, // 5 minutes
  cacheableStatusCodes: [200, 301, 302],
};

// Create the cache middleware
const cacheMiddleware = createCacheMiddleware(cacheOptions);

// Create a simple Bun server
const server = Bun.serve({
  port: 3000,
  async fetch(req: Request) {
    // Use the cache middleware
    return cacheMiddleware(req, async (request: Request) => {
      // Simulate some processing time
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Return a simple response
      return new Response(`Hello, World! Timestamp: ${Date.now()}`, {
        headers: {
          "Content-Type": "text/plain",
          "Cache-Control": "max-age=60", // Cache for 1 minute
        },
      });
    });
  },
});

console.log(`Server running at http://localhost:${server.port}`);
```

Creating the middleware requires a few optional properties. The example above specified tells the middleware to cache requests with the specified value. They'll stay fresh for 1 hour, and it can serve stale response for up to 5 minutes.

Here's an example of how to use it with Elysia framework:

```typescript
const cacheMiddleware = createCacheMiddleware(cacheOptions);
const app = new Elysia()
  .get("/", () => "Hello, welcome to my app! ❤︎ midas-cache")
  .get("/records", async () => {
    const results = await db.execute("SELECT * FROM expenses");
    return results.rows;
  });

const handle = (request: Request) => app.handle(request);

const server = Bun.serve({
  port: port,
  async fetch(req: Request) {
    // Use the cache middleware
    return cacheMiddleware(req, handle);
  },
});
```

### Example with benchmark

You can find a working example at [pmbanugo/midas-cache-examples](https://github.com/pmbanugo/midas-cache-examples). It's a REST API that stores data using SQLite and Turso. It runs four web servers as described below.

1. `localhost:3000`: Makes use of Turso's embedded replica where by there's a local SQLite DB that it reads from, and occasionally syncs with the remote Turso database.
2. `localhost:3001`: Call's the Turso database directly, with requests going over the internet. The primary database is hosted in Frankfurt, which is the datacenter closest server to me.
3. `localhost:3003`: Makes use of Turso's embedded replica and `midas-cache` to cache and serve cached response.
4. `localhost:3004`: Makes use of `midas-cache` but calls the remote Turso database when it needs to refresh or get fresh data.

The following data is the result of the benchmark.

Using local SQLite + remote Turso DB

```sh
$ oha --no-tui -n 500  http://localhost:3000/records

Summary:
  Success rate:	100.00%
  Total:	0.0660 secs
  Slowest:	0.0180 secs
  Fastest:	0.0015 secs
  Average:	0.0063 secs
  Requests/sec:	7580.3614
```

Using only remote Turso DB

```sh
$ oha --no-tui -n 500  http://localhost:3001/records

Summary:
  Success rate:	100.00%
  Total:	0.7538 secs
  Slowest:	0.3827 secs
  Fastest:	0.0195 secs
  Average:	0.0733 secs
  Requests/sec:	663.3302
```

Using the cache middleware and remote Turso DB. The slowest call is the call to the remote DB.

```sh
$ oha --no-tui -n 500  http://localhost:3004/records

Summary:
  Success rate:	100.00%
  Total:	0.2626 secs
  Slowest:	0.2611 secs
  Fastest:	0.0001 secs
  Average:	0.0249 secs
  Requests/sec:	1903.7218
```

Using the cache middleware, local SQLite (embedded replica), and remote Turso DB for synchronisation.

```sh
$ oha --no-tui -n 500  http://localhost:3003/records

Summary:
  Success rate:	100.00%
  Total:	0.0186 secs
  Slowest:	0.0087 secs
  Fastest:	0.0006 secs
  Average:	0.0017 secs
  Requests/sec:	26916.3311
```

> Regardless of the figures you see on this benchmark, you should benchmark it with your actual application.

## Configuration Options

The `createCacheMiddleware` function accepts an options object with the following properties:

- `storagePath` (string): Path to the storage for caching.
- `maxAge` (number, optional): Maximum age for cache entries to stay fresh (in seconds). Default is 3600 (1 hour).
- `staleWhileRevalidate` (number, optional): Time to serve stale content while revalidating in seconds. Default is 60 (1 minute).
- `cacheableStatusCodes` (number[], optional): List of status codes that are cacheable. Default is [200, 301, 302].
