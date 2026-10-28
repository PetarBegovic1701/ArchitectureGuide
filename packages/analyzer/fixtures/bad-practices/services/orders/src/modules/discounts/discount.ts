import { priceOf } from '../pricing/price';

export const discountFor = (base: number) => (base > 100 ? priceOf(base / 10) : 0);
