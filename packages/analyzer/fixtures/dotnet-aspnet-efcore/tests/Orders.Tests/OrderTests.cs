using Orders.Domain;
using Xunit;

public class OrderTests
{
    [Fact]
    public void Create_adds_a_line() => Assert.Single(Order.Create("a@b.c", 1, 2).Lines);
}
