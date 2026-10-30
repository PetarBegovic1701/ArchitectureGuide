def confirmation(order_id: int) -> dict:
    return {"subject": f"Order {order_id}", "template": "confirmation"}
