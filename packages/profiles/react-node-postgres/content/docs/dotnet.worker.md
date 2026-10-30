---
id: dotnet.worker
kind: concept
title: .NET worker
summary: A .NET process that runs background work (a hosted service, Hangfire, Quartz.NET, MassTransit consumers) outside the request, with retries when something fails.
level: intermediate
tracks: [concurrency-and-parallelism]
tags: [dotnet, csharp, hosted-service, hangfire, jobs]
related: [node.worker, dotnet.service, processes, consumes, pattern.background-jobs]
references:
  - title: Worker services in .NET
    url: https://learn.microsoft.com/en-us/dotnet/core/extensions/workers
  - title: Hangfire — Documentation
    url: https://docs.hangfire.io/en/latest/
  - title: MassTransit — Consumers
    url: https://masstransit.io/documentation/concepts/consumers
---

## Beginner

A .NET worker is a process without a web front: it runs jobs in the background. The
.NET "Worker Service" template runs one or more `BackgroundService` classes. Hangfire
and Quartz.NET run jobs on a schedule or from a queue. MassTransit consumers handle
messages from a broker.

## Intermediate

- Jobs and consumers must be **idempotent**: a message can come twice.
- Set retries with backoff, and a dead-letter queue for messages that keep failing.
- Use a new scope (and a new `DbContext`) per job; do not keep one for the life of the
  worker.
- Show the queue or broker on the diagram, with the producers and this worker.

## Senior

- Publish messages with an outbox (MassTransit has one) so a message never leaves when
  the transaction rolls back.
- Limit concurrency per consumer, and keep slow and fast work on separate queues.
- Stop gracefully: honour the `CancellationToken` so a deploy does not cut a job in half.

## Common mistakes

- A `while (true)` loop without a delay or a cancellation check.
- One `DbContext` for the whole life of the worker.
- Non-idempotent consumers that charge a card twice when a message is redelivered.

## Examples

**A hosted service that processes work in a loop:**

```csharp
public sealed class InvoiceWorker(IServiceScopeFactory scopes) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stop)
    {
        while (!stop.IsCancellationRequested)
        {
            using var scope = scopes.CreateScope();
            var invoices = scope.ServiceProvider.GetRequiredService<InvoiceJobs>();
            await invoices.RunNextAsync(stop);
            await Task.Delay(TimeSpan.FromSeconds(5), stop);
        }
    }
}
```
