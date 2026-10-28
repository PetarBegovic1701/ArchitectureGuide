---
id: group.zone
kind: concept
title: Deployment zone
summary: A network or deployment boundary — the public internet side, a private network, a region. It shows what is reachable from where.
level: intermediate
tracks: [foundations, auth]
tags: [network, vpc, deployment]
related: [gen.gateway, pg.database, node.service]
references:
  - title: AWS — VPCs and subnets
    url: https://docs.aws.amazon.com/vpc/latest/userguide/configure-subnets.html
---

## Beginner

A **zone** shows where things run and who can reach them. The gateway sits in a public
zone; services and the database sit in a private network that the internet cannot reach
directly.

## Intermediate

- Put databases and workers in private zones; only the gateway is public.
- Regions are zones too: data residency rules may require some data to stay in one.

## Senior

- Network boundaries are defense in depth, not authorization; services still
  authenticate each other.
- Cross-zone calls add latency and cost; draw them to make them visible.

## Common mistakes

- A database with a public IP.

## Examples

**Only the gateway is public (sketch):**

```yaml
public: [gateway, cdn]
private: [api, worker, postgres]
```
