using MassTransit;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Orders.Application;
using Shop.Contracts;

namespace Orders.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/[controller]")]
public sealed class OrdersController(PlaceOrder placeOrder, IPublishEndpoint bus) : ControllerBase
{
    [HttpGet("{id:int}")]
    public async Task<IActionResult> Get(int id) => Ok(await placeOrder.FindAsync(id));

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] NewOrder order)
    {
        var id = await placeOrder.RunAsync(order.Email, order.ProductId, order.Quantity);
        await bus.Publish(new OrderPlaced(id));
        return CreatedAtAction(nameof(Get), new { id }, null);
    }
}

public sealed record NewOrder(string Email, int ProductId, int Quantity);
