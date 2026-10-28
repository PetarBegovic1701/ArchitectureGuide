import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { api } from '../api/client';

export function Order() {
  const { id } = useParams();
  const { data } = useQuery({
    queryKey: ['orders', id],
    queryFn: async () => (await api.get(`/orders/${id}`)).data,
  });
  return <p>{data?.status}</p>;
}
