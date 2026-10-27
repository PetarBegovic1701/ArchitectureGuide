---
id: topic.authentication
kind: topic
title: Authentication and authorization
summary: Authentication proves who the user is; authorization decides what they may do. Sessions and tokens are two ways to remember a signed-in user.
level: beginner
tracks: [auth]
tags: [security, sessions, jwt, oauth]
related: [gen.auth-provider, node.middleware, authenticates-with, node.bff, react.app]
references:
  - title: OWASP — Session Management Cheat Sheet
    url: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
  - title: OWASP — Password Storage Cheat Sheet
    url: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
  - title: RFC 7636 — Proof Key for Code Exchange (PKCE)
    url: https://datatracker.ietf.org/doc/html/rfc7636
  - title: RFC 9700 — Best Current Practice for OAuth 2.0 Security
    url: https://datatracker.ietf.org/doc/html/rfc9700
quiz:
  - question: A user is signed in but opens another user's invoice by changing the ID in the URL. Which part failed?
    options: [Authentication, Authorization, Encryption, Validation]
    answer: 1
    explanation: The server knew who the user was (authentication) but did not check that this invoice belongs to them (authorization).
  - question: Where should a browser app keep a session or access token?
    options:
      - localStorage
      - An HttpOnly, Secure, SameSite cookie
      - A global JavaScript variable shared across tabs
      - The URL
    answer: 1
    explanation: JavaScript cannot read HttpOnly cookies, so a cross-site scripting bug cannot steal them. localStorage is readable by any script on the page.
---

## Beginner

- **Authentication** answers "who are you?" (password, passkey, "Sign in with Google").
- **Authorization** answers "what may you do?" (only the owner may see this order;
  only admins may refund).

After sign-in, the server must **remember** the user on every later request. Two
common ways:

- **Session:** the server stores "session 8f3… = user 42" (for example in PostgreSQL)
  and sends the browser a cookie with the session ID.
- **Token (often a JWT):** the server signs a small piece of data ("user 42, expires
  in 15 minutes") and the client sends it with every request. The server checks the
  signature; it does not need to look anything up.

Rules that always apply: hash passwords (never store them), use HTTPS, and check
authorization **on the server** for every request. Hiding a button in React is not
security.

## Intermediate

|                   | Server sessions                    | Self-contained tokens (JWT)                                  |
| ----------------- | ---------------------------------- | ------------------------------------------------------------ |
| Server state      | Session store (table)              | None for access tokens                                       |
| Sign out / revoke | Delete the session: immediate      | Hard before expiry; keep tokens short-lived + refresh tokens |
| Browser storage   | HttpOnly cookie                    | Prefer HttpOnly cookie; avoid localStorage                   |
| Good fit          | Classic web apps, one backend, BFF | Service-to-service, several APIs, mobile apps                |

For a React SPA with an external identity provider (Auth0, Clerk, Keycloak, Cognito),
use the **OpenID Connect authorization code flow with PKCE**. The implicit flow is
deprecated. A common, safer setup is a **Backend-for-Frontend**: the BFF does the
OAuth flow and keeps the tokens; the browser only gets an HttpOnly session cookie.

Cookies are sent automatically, so protect state-changing requests against **CSRF**:
`SameSite=Lax` or `Strict` cookies, and a CSRF token or a custom header check for
anything else.

Authorization patterns: role checks (RBAC: "admin"), ownership checks
(`order.customerId === user.id`), and in PostgreSQL **Row Level Security** as a second
line of defense.

## Senior

- Validate JWTs fully: signature with the expected algorithm (never accept `alg: none`
  or switch to HMAC with a public key), `iss`, `aud`, `exp`, `nbf`. Rotate keys via JWKS.
- Refresh tokens: rotate on every use and detect reuse (a reused refresh token means it
  was stolen: revoke the family).
- Session IDs: high entropy, regenerated at sign-in (session fixation), idle and absolute
  timeouts, server-side revocation on password change.
- Passwords: Argon2id (or scrypt / bcrypt with a suitable cost), per-user salt from the
  library, rate limiting and lockout signals on sign-in endpoints.
- Put authorization in one place per boundary (middleware + policy functions), and test
  it like business logic. Most real-world breaches here are broken object-level
  authorization (the invoice example), not broken crypto.
- RLS: set the tenant/user per transaction (`SET LOCAL app.user_id = ...`) and make the
  application role non-owner, or policies are bypassed.

## Analogy

Authentication is showing your passport at the hotel desk. The session is the room key
card you get back. Authorization is the card opening only your room.

## Common mistakes

- Storing tokens in localStorage.
- Checking roles only in the React UI.
- Long-lived JWTs with no way to revoke them.
- Missing ownership checks on `GET /orders/:id`.
- Logging tokens or passwords.

## Examples

**Express: session cookie settings:**

```ts
app.use(
  session({
    store: new PgStore({ pool }), // sessions in PostgreSQL (connect-pg-simple)
    secret: process.env.SESSION_SECRET!,
    name: 'sid',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 8 },
  }),
);
```

**Authorization: check ownership on the server:**

```ts
router.get('/orders/:id', requireUser, async (req, res) => {
  const order = await orders.findById(req.params.id);
  if (!order || order.customerId !== req.user.id) {
    return res.status(404).end(); // do not reveal that the order exists
  }
  res.json(toOrderResponse(order));
});
```
