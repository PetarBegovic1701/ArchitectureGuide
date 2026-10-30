---
id: dotnet.service
kind: concept
title: .NET service (API)
summary: A .NET process that answers requests (ASP.NET Core controllers or minimal APIs). It checks the caller, validates input, applies the rules and owns its data.
level: beginner
tracks: [foundations, concurrency-and-parallelism]
tags: [dotnet, csharp, aspnetcore, backend]
related: [node.service, node.route-handler, node.repository, pg.schema, calls]
references:
  - title: Overview of ASP.NET Core
    url: https://learn.microsoft.com/en-us/aspnet/core/introduction-to-aspnet-core
  - title: Minimal APIs overview
    url: https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis/overview
  - title: Entity Framework Core — Overview
    url: https://learn.microsoft.com/en-us/ef/core/
---

## Beginner

A .NET service is a backend process written in C# (or F#, or Visual Basic) on ASP.NET
Core. It has the same job as a Node service: it receives HTTP requests, checks who is
calling, validates the input, applies the business rules and reads or writes its own
data.

Controllers map methods to paths with attributes (`[HttpGet("{id}")]`). Minimal APIs map
paths in `Program.cs` (`app.MapGet("/orders", ...)`).

## Intermediate

- Validate requests with data annotations or FluentValidation, and return problem
  details for errors.
- Keep controllers thin. Put the work in application services, and data access behind a
  repository or a `DbContext` (Entity Framework Core, Dapper).
- Give the service its own schema and EF Core migrations. Other services use its API.
- Register the authentication middleware (`AddAuthentication`, `UseAuthorization`), and
  mark public endpoints on purpose with `[AllowAnonymous]`.

## Senior

- ASP.NET Core serves requests on a thread pool. Use `async` all the way down; a blocking
  `.Result` on a task can starve the pool under load.
- Each instance has its own connection pool (Npgsql). Instances × pool size must fit
  Postgres; put a pooler in front at scale.
- A solution often holds several projects. Show the deployable projects as services and
  the class libraries as modules or shared packages, with their project references.

## Common mistakes

- Blocking on async code (`.Result`, `.Wait()`), which leads to thread-pool starvation.
- One `DbContext` and one database shared by several services.
- A long-lived `DbContext` (a singleton) shared between requests.

## Examples

**A minimal API endpoint with EF Core:**

```csharp
var builder = WebApplication.CreateBuilder(args);
builder.Services.AddDbContext<OrdersDb>(o =>
    o.UseNpgsql(builder.Configuration.GetConnectionString("Orders")));
var app = builder.Build();

app.MapPost("/orders", async (NewOrder order, OrdersDb db) =>
{
    db.Orders.Add(new Order(order.ProductId, order.Quantity));
    await db.SaveChangesAsync();
    return Results.Created();
});

app.Run();
```
