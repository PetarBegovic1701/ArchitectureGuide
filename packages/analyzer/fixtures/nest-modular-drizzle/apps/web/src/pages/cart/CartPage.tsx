import { useCart } from '../../features/cart/model/cart';

export function CartPage() {
  const items = useCart((s) => s.items);
  return <p>{items.length} items</p>;
}
