import { useMutation } from '@tanstack/react-query';
import { apiFetch } from './api/client';

export function Checkout() {
  const buy = useMutation({ mutationFn: () => apiFetch('/orders', { method: 'POST' }) });
  return <button onClick={() => buy.mutate()}>Buy</button>;
}
