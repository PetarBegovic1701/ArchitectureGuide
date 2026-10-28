---
id: serves
kind: relation
title: serves
summary: Delivers the static build of the React app to browsers — from a CDN, a Node service or a BFF.
level: beginner
tracks: [foundations]
tags: [hosting, static-files]
related: [react.app, gen.cdn, node.service, node.bff]
references:
  - title: Vite — Deploying a static site
    url: https://vite.dev/guide/static-deploy.html
---

## Beginner

`CDN serves React app` means the browser downloads the app's files from the CDN. The
built app is just files, so any static host can serve it.

## Intermediate

- Serving from a CDN keeps static traffic off the API.
- Serving from the Node service or BFF keeps one origin (simpler cookies and CORS).

## Senior

- Version assets with hashes and cache them long; never cache `index.html` long.

## Common mistakes

- No SPA fallback to `index.html` for deep links.

## Examples

**Serve the build from Fastify:**

```ts
await app.register(fastifyStatic, { root: join(dirname, 'web'), wildcard: false });
app.setNotFoundHandler((req, reply) => reply.sendFile('index.html'));
```
