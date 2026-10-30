using Microsoft.EntityFrameworkCore;
using Orders.Application;
using Orders.Domain;

namespace Orders.Infrastructure;

public sealed class OrderRepository(OrdersDbContext db) : IOrderRepository
{
    public async Task<int> AddAsync(Order order)
    {
        db.Orders.Add(order);
        await db.SaveChangesAsync();
        return order.Id;
    }

    public Task<Order?> FindAsync(int id) =>
        db.Orders.Include(o => o.Lines).FirstOrDefaultAsync(o => o.Id == id);
}
