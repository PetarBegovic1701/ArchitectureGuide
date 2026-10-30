using MassTransit;
using Microsoft.EntityFrameworkCore;
using Orders.Infrastructure;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddDbContext<OrdersDbContext>(o =>
    o.UseNpgsql(builder.Configuration.GetConnectionString("Orders")));
builder.Services.AddHttpClient("catalog", c =>
    c.BaseAddress = new Uri(builder.Configuration["CATALOG_URL"]!));
builder.Services.AddMassTransit(x =>
    x.UsingRabbitMq((context, cfg) => cfg.Host(builder.Configuration["RABBITMQ_URL"])));
builder.Services.AddAuthentication().AddJwtBearer();
builder.Services.AddControllers();

var app = builder.Build();
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();
app.MapGet("/health", () => Results.Ok());
app.Run();
