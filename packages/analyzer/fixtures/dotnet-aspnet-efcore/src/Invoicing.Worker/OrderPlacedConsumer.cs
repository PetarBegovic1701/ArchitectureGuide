using MassTransit;
using Shop.Contracts;
using Stripe;

public sealed class OrderPlacedConsumer : IConsumer<OrderPlaced>
{
    public async Task Consume(ConsumeContext<OrderPlaced> context)
    {
        var invoices = new InvoiceService();
        await invoices.CreateAsync(new InvoiceCreateOptions { Customer = context.Message.OrderId.ToString() });
    }
}
