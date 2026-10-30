import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.config import settings
from app.repository import OrderRepository
from app.tasks import send_confirmation

router = APIRouter(tags=["orders"])


class NewOrder(BaseModel):
    email: str
    product_id: int
    quantity: int


@router.post("/", status_code=201)
def create_order(body: NewOrder, repo: OrderRepository = Depends()):
    product = httpx.get(f"{settings.catalog_url}/api/products/{body.product_id}")
    if product.status_code != 200:
        raise HTTPException(404, "Unknown product")
    order = repo.add(body.email, [(body.product_id, body.quantity)])
    send_confirmation(order.id)
    return {"id": order.id}


@router.get("/{order_id}")
def get_order(order_id: int, repo: OrderRepository = Depends()):
    order = repo.get(order_id)
    if order is None:
        raise HTTPException(404)
    return order
