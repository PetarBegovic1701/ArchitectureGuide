namespace Orders.Domain;

public sealed class Order
{
    public int Id { get; private set; }
    public string Email { get; private set; } = "";
    public List<OrderLine> Lines { get; } = [];

    public static Order Create(string email, int productId, int quantity)
    {
        var order = new Order { Email = email };
        order.Lines.Add(new OrderLine { ProductId = productId, Quantity = quantity });
        return order;
    }
}

public sealed class OrderLine
{
    public int Id { get; set; }
    public int OrderId { get; set; }
    public int ProductId { get; set; }
    public int Quantity { get; set; }
}
