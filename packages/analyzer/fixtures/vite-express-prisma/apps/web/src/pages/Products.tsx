import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';

export function Component() {
  const { data } = useQuery({
    queryKey: ['products'],
    queryFn: async () => (await api.get('/products')).data,
  });
  return <ul>{data?.map((p: { id: string; name: string }) => <li key={p.id}>{p.name}</li>)}</ul>;
}
