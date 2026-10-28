---
id: react.api-client
kind: concept
title: API client
summary: The one place in the frontend that talks HTTP to the backend — base URL, auth, error handling, and request and response types.
level: beginner
tracks: [api-design, state-management]
tags: [fetch, axios, openapi, trpc]
related: [node.contract, node.dto, react.server-state, fetches-via, calls]
references:
  - title: MDN — Using the Fetch API
    url: https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch
  - title: openapi-typescript — Introduction
    url: https://openapi-ts.dev/introduction
---

## Beginner

Instead of writing `fetch('https://…')` all over the app, put the details in one
**API client**: the base URL, the headers, what to do on errors, and the shape of each
request and response.

The rest of the app calls `api.getOrders()` or `api.post('/orders', body)`; if the
backend changes, you change one file.

## Intermediate

- Turn HTTP errors into typed errors (status, problem details), so the UI can show a good
  message and retry where it makes sense.
- Send cookies (`credentials: 'include'`) or tokens in one place.
- Generate the client from the API contract (OpenAPI, tRPC, GraphQL codegen), so types
  match the server.
- The server-state cache, hooks and thunks use the client; components do not call it
  directly.

## Senior

- Add timeouts (`AbortSignal.timeout`) and decide which calls may retry: only idempotent
  ones, or with an idempotency key.
- Validate responses at the boundary (zod) when the backend is not under your control.
- Correlate requests with a request ID header for tracing.

## Common mistakes

- `fetch` calls scattered through components.
- Ignoring non-2xx responses (`fetch` does not throw on 404 or 500).
- Retrying POST requests without an idempotency key.

## Examples

**A small typed fetch wrapper:**

```ts
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(10_000),
    ...init,
  });
  if (!res.ok) throw new ApiError(res.status, await res.text());
  return (await res.json()) as T;
}
```
