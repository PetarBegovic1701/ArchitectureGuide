import os

from celery import Celery
from sendgrid import SendGridAPIClient
from shop_common.emails import confirmation

app = Celery("mailer", broker=os.environ["BROKER_URL"])


@app.task(name="mailer.send_confirmation", bind=True, max_retries=5)
def send_confirmation(self, order_id: int) -> None:
    SendGridAPIClient(os.environ["SENDGRID_API_KEY"]).send(confirmation(order_id))
