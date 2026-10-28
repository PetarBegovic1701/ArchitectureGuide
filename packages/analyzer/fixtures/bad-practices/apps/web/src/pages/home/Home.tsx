import { useQuery } from '@tanstack/react-query';
import { Button } from '../../shared/ui/Button';
import { countUsers } from '../../shared/lib/db';

export function Home() {
  const { data } = useQuery({ queryKey: ['users'], queryFn: countUsers });
  return <Button label={`${data} users`} />;
}
