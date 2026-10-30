using Dapper;
using Npgsql;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddSingleton(_ => NpgsqlDataSource.Create(builder.Configuration.GetConnectionString("Catalog")!));
var app = builder.Build();

var products = app.MapGroup("/products");
products.MapGet("/", async (NpgsqlDataSource db) =>
{
    await using var conn = await db.OpenConnectionAsync();
    return await conn.QueryAsync<Product>("SELECT id, name, price_cents FROM catalog.products");
});
products.MapGet("/{id:int}", async (int id, NpgsqlDataSource db) =>
{
    await using var conn = await db.OpenConnectionAsync();
    return await conn.QuerySingleOrDefaultAsync<Product>(
        "SELECT id, name, price_cents FROM catalog.products WHERE id = @id", new { id });
});

app.Run();

public sealed record Product(int Id, string Name, int PriceCents);
