---
id: gen.cdn
kind: concept
title: CDN / static hosting
summary: Serves static files — the built React app, images — from servers near the users, so pages load fast and your API does not have to.
level: beginner
tracks: [foundations]
tags: [cdn, cloudfront, cloudflare, netlify]
related: [react.app, serves, gen.gateway]
references:
  - title: MDN — CDN
    url: https://developer.mozilla.org/en-US/docs/Glossary/CDN
  - title: MDN — HTTP caching
    url: https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Caching
---

## Beginner

After `vite build`, a React app is just files: HTML, JavaScript, CSS, images. A **CDN**
copies them to servers around the world and **serves** each user from a nearby one.

## Intermediate

- Hashed file names (`app.3f9c.js`) can be cached for a year; `index.html` must not be
  cached long, so new releases load.
- SPAs need a fallback: unknown paths return `index.html`, and the router takes over.
- The API usually stays on its own domain or path behind the gateway.

## Senior

- Purge or version on deploy; keep the old assets for a while so open tabs still load
  lazy chunks.
- Security headers (CSP, HSTS) are often set at the CDN.

## Common mistakes

- Caching `index.html` for a long time, so users keep the old app.
- No SPA fallback, so reloading `/orders/42` gives 404.

## Examples

**Cache headers for a Vite build:**

```bash
# hashed assets: cache forever
Cache-Control: public, max-age=31536000, immutable   # for /assets/*
# the entry point: always revalidate
Cache-Control: no-cache                                # for /index.html
```
