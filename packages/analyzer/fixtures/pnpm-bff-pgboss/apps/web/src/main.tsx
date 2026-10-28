import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Events } from './Events';
import { Checkout } from './Checkout';

const router = createBrowserRouter([
  { path: '/', element: <Events /> },
  { path: '/checkout/:eventId', element: <Checkout /> },
]);

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={new QueryClient()}>
    <RouterProvider router={router} />
  </QueryClientProvider>,
);
