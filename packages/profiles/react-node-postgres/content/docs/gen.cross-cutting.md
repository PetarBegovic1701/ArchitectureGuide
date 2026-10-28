---
id: gen.cross-cutting
kind: concept
title: Cross-cutting concern
summary: Something many parts use — logging, configuration, feature flags, tracing. Shown once instead of drawing arrows from everything.
level: intermediate
tracks: [foundations]
tags: [logging, observability, config, feature-flags]
related: [node.shared-lib, node.middleware]
references:
  - title: OpenTelemetry — What is OpenTelemetry?
    url: https://opentelemetry.io/docs/what-is-opentelemetry/
  - title: The Twelve-Factor App — Config
    url: https://12factor.net/config
---

## Beginner

Some things are used by almost every part of the system: logging, configuration,
feature flags, error reporting. Drawing an arrow from every box would clutter the diagram,
so this shape notes them once.

## Intermediate

- Logs: structured (JSON) with a request ID, so one request can be followed across
  services.
- Config: from environment variables, validated at startup.
- Feature flags: release code dark and turn features on gradually.

## Senior

- Traces (OpenTelemetry) show where time goes across services and the database.
- Treat flags as debt: remove them when a feature is fully released.

## Common mistakes

- Logs without request IDs.
- Config read lazily, so a missing variable fails hours after deploy.

## Examples

**Structured logging with a request ID (pino):**

```ts
const log = pino();
app.addHook('onRequest', async (req) => {
  req.log = log.child({ requestId: req.id });
});
```
