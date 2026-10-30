using Orders.Domain;

namespace Orders.Application;

public interface IOrderRepository
{
    Task<int> AddAsync(Order order);
    Task<Order?> FindAsync(int id);
}

public sealed class PlaceOrder(IOrderRepository orders)
{
    public Task<int> RunAsync(string email, int productId, int quantity) =>
        orders.AddAsync(Order.Create(email, productId, quantity));

    public Task<Order?> FindAsync(int id) => orders.FindAsync(id);
}
