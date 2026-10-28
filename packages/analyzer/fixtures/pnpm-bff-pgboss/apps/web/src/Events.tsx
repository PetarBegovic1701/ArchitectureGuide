import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './api/client';

export function Events() {
  const { data } = useQuery({ queryKey: ['events'], queryFn: () => apiFetch<string[]>('/events') });
  return <ul>{data?.map((e) => <li key={e}>{e}</li>)}</ul>;
}
