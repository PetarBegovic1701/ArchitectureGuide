"""create orders

Revision ID: 0001
"""
import sqlalchemy as sa
from alembic import op

revision = "0001"
down_revision = None


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS orders")
    op.create_table(
        "orders",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("customer_email", sa.String(200), nullable=False),
        sa.Column("created_at", sa.DateTime, nullable=False),
        schema="orders",
    )
    op.create_table(
        "order_lines",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("order_id", sa.Integer, sa.ForeignKey("orders.orders.id")),
        sa.Column("product_id", sa.Integer),
        sa.Column("quantity", sa.Integer),
        schema="orders",
    )


def downgrade() -> None:
    op.drop_table("order_lines", schema="orders")
    op.drop_table("orders", schema="orders")
