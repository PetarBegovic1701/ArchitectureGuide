using Microsoft.EntityFrameworkCore.Migrations;

namespace Orders.Infrastructure.Migrations;

public partial class Initial : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.EnsureSchema(name: "orders");
        migrationBuilder.CreateTable(
            name: "Orders",
            schema: "orders",
            columns: table => new { Id = table.Column<int>(nullable: false), Email = table.Column<string>(nullable: false) });
        migrationBuilder.CreateTable(
            name: "OrderLines",
            schema: "orders",
            columns: table => new { Id = table.Column<int>(nullable: false), OrderId = table.Column<int>(nullable: false) });
    }
}
