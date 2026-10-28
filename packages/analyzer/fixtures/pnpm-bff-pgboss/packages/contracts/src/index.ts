import { z } from 'zod';

export const CreateOrder = z.object({ eventId: z.string(), seats: z.number().int().positive() });
export type CreateOrder = z.infer<typeof CreateOrder>;
