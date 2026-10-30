from celery import Celery

from app.config import settings

celery = Celery("orders", broker=settings.broker_url)


def send_confirmation(order_id: int) -> None:
    celery.send_task("mailer.send_confirmation", args=[order_id])
