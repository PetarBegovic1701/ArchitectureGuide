---
id: node.middleware
kind: concept
title: Middleware
summary: Code that runs before (or after) every handler of a route group — authentication, rate limiting, request logging, error handling.
level: beginner
tracks: [auth, api-design]
tags: [express, fastify, auth, rate-limit]
related: [topic.authentication, node.route-handler, gen.auth-provider, authenticates-with]
references:
  - title: Express — Using middleware
    url: https://expressjs.com/en/guide/using-middleware.html
  - title: OWASP — Authentication cheat sheet
    url: https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html
---

## Beginner

Some checks apply to many endpoints: "is the user signed in?", "has this IP sent too
many requests?". Instead of repeating them in every handler, a **middleware** runs before
the handlers and stops the request early when a check fails (401, 429).

## Intermediate

- **Auth middleware** answers "who is calling?": it reads the session cookie or the
  bearer token, verifies it, and attaches the user to the request.
- **Authorization** ("may this user cancel _this_ order?") usually needs the data, so it
  belongs in the use case, not only in middleware.
- Order matters: logging and request IDs first, then auth, then validation, then the
  handler, then the error handler last.

## Senior

- Verify JWTs properly: algorithm allow-list, issuer, audience, expiry, key rotation
  (JWKS caching).
- Rate limits per user and per IP, stored in a shared store when you run several
  instances.
- A central error handler maps exceptions to one error format and never leaks stack
  traces.

## Common mistakes

- Checking "signed in" but not "allowed to touch this record" (broken object-level
  authorization).
- Forgetting the auth middleware on new routes; prefer secure-by-default route groups.

## Examples

**Session check middleware (Express):**

```ts
export function requireSession(req: Request, res: Response, next: NextFunction) {
  const session = sessions.verify(req.cookies.sid);
  if (!session) return res.status(401).json({ title: 'Sign in required' });
  req.user = session.user;
  next();
}
```
