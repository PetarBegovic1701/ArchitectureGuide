---
id: authenticates-with
kind: relation
title: authenticates with
summary: Uses an auth provider to sign users in or to verify their tokens. Set the method — OIDC with PKCE, passwords, passkeys, API keys.
level: intermediate
tracks: [auth]
tags: [oidc, oauth, login]
related: [gen.auth-provider, node.middleware, topic.authentication, node.bff]
references:
  - title: RFC 7636 — PKCE
    url: https://datatracker.ietf.org/doc/html/rfc7636
  - title: OWASP — Session management cheat sheet
    url: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
---

## Beginner

`App authenticates with Auth provider` means the app sends users to the provider to sign
in, and gets back proof of who they are. `API authenticates with Auth provider` means the
API checks that proof on each request.

## Intermediate

- `method`: `oidc-code-pkce` for browser apps, `password`, `magic-link`, `passkey`,
  `oauth-client-credentials` for machine clients, `api-key`.
- Authentication says who; authorization (roles, ownership) is still your code's job.

## Senior

- Prefer a BFF or HttpOnly session cookies over tokens in the browser.
- Machine-to-machine calls use client credentials or mTLS, with narrow scopes.

## Common mistakes

- Authenticating users but never checking what they may access.

## Examples

**Start an OIDC code flow with PKCE (server side):**

```ts
const verifier = randomBytes(32).toString('base64url');
const challenge = createHash('sha256').update(verifier).digest('base64url');
redirect(
  `${issuer}/authorize?response_type=code&client_id=${id}&code_challenge=${challenge}&code_challenge_method=S256`,
);
```
