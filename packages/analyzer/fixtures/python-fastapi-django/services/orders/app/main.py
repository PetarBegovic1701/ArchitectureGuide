from fastapi import FastAPI

from app.api import orders

app = FastAPI(title="Orders")
app.include_router(orders.router, prefix="/orders")
