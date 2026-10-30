using MassTransit;

var builder = Host.CreateApplicationBuilder(args);
builder.Services.AddMassTransit(x =>
{
    x.AddConsumer<OrderPlacedConsumer>();
    x.UsingRabbitMq((context, cfg) =>
    {
        cfg.Host(builder.Configuration["RABBITMQ_URL"]);
        cfg.ConfigureEndpoints(context);
    });
});
builder.Build().Run();
