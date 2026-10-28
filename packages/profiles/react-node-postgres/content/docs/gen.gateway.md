---
id: gen.gateway
kind: concept
title: API gateway / reverse proxy
summary: The single entry point for requests from outside. It routes paths to services and handles TLS, rate limits and sometimes auth.
level: intermediate
tracks: [foundations]
tags: [nginx, traefik, kong, proxy]
related: [node.service, gen.cdn, calls]
references:
  - title: NGINX — Reverse proxy
    url: https://docs.nginx.com/nginx/admin-guide/web-server/reverse-proxy/
  - title: microservices.io — API gateway pattern
    url: https://microservices.io/patterns/apigateway.html
---

## Beginner

A **gateway** (or reverse proxy) is the front door: all requests from the internet arrive
there first. It sends `/api/*` to the Node service and everything else to the static
frontend files, and handles HTTPS.

## Intermediate

- Common jobs: TLS termination, routing, compression, request size limits, rate limits,
  CORS, access logs.
- Cloud gateways can also check API keys or JWTs before requests reach your services.
- Keep business logic out of the gateway.

## Senior

- The gateway is a single point of failure and a shared config: run it redundantly and
  manage its config as code.
- Forward the client IP and a request ID; services must trust these headers only from the
  gateway.

## Common mistakes

- Business rules in gateway scripts.
- Services also reachable directly from the internet, bypassing the gateway.

## Examples

**Route API and static files (nginx):**

```bash
location /api/ { proxy_pass http://api:3000/; proxy_set_header X-Request-Id $request_id; }
location / { root /srv/web; try_files $uri /index.html; }
```
