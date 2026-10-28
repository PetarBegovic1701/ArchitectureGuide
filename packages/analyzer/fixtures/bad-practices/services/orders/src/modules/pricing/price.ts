// RNP-018: pricing and discounts import each other.
import { discountFor } from '../discounts/discount';

export const priceOf = (base: number) => base - discountFor(base);
