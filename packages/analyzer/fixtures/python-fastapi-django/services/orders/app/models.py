from datetime import datetime

from sqlalchemy import ForeignKey, Index, String
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class Order(Base):
    __tablename__ = "orders"
    __table_args__ = {"schema": "orders"}

    id: Mapped[int] = mapped_column(primary_key=True)
    customer_email: Mapped[str] = mapped_column(String(200), index=True)
    created_at: Mapped[datetime]


class OrderLine(Base):
    __tablename__ = "order_lines"
    __table_args__ = (Index("ix_order_lines_order", "order_id"), {"schema": "orders"})

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.orders.id"))
    product_id: Mapped[int]
    quantity: Mapped[int]
