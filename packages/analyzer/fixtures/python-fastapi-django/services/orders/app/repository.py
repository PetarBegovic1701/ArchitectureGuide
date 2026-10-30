from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Order, OrderLine


class OrderRepository:
    def __init__(self, session: Session):
        self.session = session

    def add(self, email: str, lines: list[tuple[int, int]]) -> Order:
        order = Order(customer_email=email)
        self.session.add(order)
        self.session.add_all([OrderLine(product_id=p, quantity=q) for p, q in lines])
        self.session.commit()
        return order

    def get(self, order_id: int) -> Order | None:
        return self.session.scalars(select(Order).where(Order.id == order_id)).first()
