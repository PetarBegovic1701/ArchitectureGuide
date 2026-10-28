import express from 'express';
import products from './routes/products';
import orders from './routes/orders';

const app = express();
app.use(express.json());
app.use('/api/products', products);
app.use('/api/orders', orders);

app.listen(Number(process.env.PORT ?? 3000));
