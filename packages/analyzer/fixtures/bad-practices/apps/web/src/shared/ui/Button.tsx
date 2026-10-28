// RNP-013: the shared layer imports from a feature (a higher layer).
import { useCartCount } from '../../features/cart/model/count';

export function Button({ label }: { label: string }) {
  return <button>{label} ({useCartCount()})</button>;
}
