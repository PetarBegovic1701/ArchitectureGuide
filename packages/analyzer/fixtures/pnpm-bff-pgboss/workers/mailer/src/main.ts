import PgBoss from 'pg-boss';
import sendgrid from '@sendgrid/mail';

const boss = new PgBoss(process.env.DATABASE_URL!);
await boss.start();

await boss.work('order-confirmation', async ([job]) => {
  await sendgrid.send({ to: 'buyer@example.com', from: 'tickets@example.com', subject: 'Your order', text: String(job?.data) });
});
