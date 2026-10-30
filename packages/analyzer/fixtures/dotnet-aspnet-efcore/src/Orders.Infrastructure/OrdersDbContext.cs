using Microsoft.EntityFrameworkCore;
using Orders.Domain;

namespace Orders.Infrastructure;

public sealed class OrdersDbContext(DbContextOptions<OrdersDbContext> options) : DbContext(options)
{
    public DbSet<Order> Orders => Set<Order>();
    public DbSet<OrderLine> OrderLines => Set<OrderLine>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.HasDefaultSchema("orders");
        modelBuilder.Entity<OrderLine>().HasIndex(l => l.OrderId);
    }
}
