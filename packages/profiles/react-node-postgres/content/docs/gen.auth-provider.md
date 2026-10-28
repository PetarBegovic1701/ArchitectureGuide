---
id: gen.auth-provider
kind: concept
title: Auth provider
summary: The service that signs users in and issues identities — Auth0, Clerk, Cognito, Keycloak, or your own. Apps trust its tokens instead of storing passwords.
level: intermediate
tracks: [auth]
tags: [oidc, oauth, sso, identity]
related: [topic.authentication, node.middleware, node.bff, authenticates-with]
references:
  - title: OpenID Connect — How it works
    url: https://openid.net/developers/how-connect-works/
  - title: OWASP — Authentication cheat sheet
    url: https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html
---

## Beginner

An **auth provider** handles sign-in: passwords, Google login, passkeys, two-factor. After
sign-in it gives your app proof of who the user is (a token). Your API checks that proof
instead of storing passwords itself.

## Intermediate

- Browser apps use the **authorization code flow with PKCE**; ideally a BFF runs it and
  keeps tokens server-side.
- The API verifies tokens (signature, issuer, audience, expiry) in auth middleware.
- The provider says **who** the user is; your app still decides **what** they may do
  (roles, ownership).

## Senior

- Plan key rotation (JWKS) and token lifetimes; short access tokens with refresh tokens
  held server-side.
- Logout across apps and token revocation are harder with stateless JWTs; sessions are
  simpler when you control both sides.
- Service-to-service calls use client credentials or mTLS, not user tokens.

## Common mistakes

- Treating "has a valid token" as "may do anything".
- Not checking the token audience, so tokens for another app work on yours.

## Examples

**Verify a token with a remote JWKS (jose):**

```ts
import { createRemoteJWKSet, jwtVerify } from 'jose';

const jwks = createRemoteJWKSet(new URL('https://auth.example.com/.well-known/jwks.json'));

export async function verify(token: string) {
  const { payload } = await jwtVerify(token, jwks, {
    issuer: 'https://auth.example.com/',
    audience: 'shop-api',
  });
  return payload;
}
```
