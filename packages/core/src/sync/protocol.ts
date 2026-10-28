import type { OpError } from '../ops';
import type { Id, Op, Project } from '../schema';

/**
 * Messages on the serve-mode WebSocket (Implementation.md §14.5). Shared by the server and
 * the browser, so both sides agree on the protocol.
 */
export type ClientMessage =
  /** Subscribe to a project. Also the answer to a `state` with origin `file`: "I have it". */
  | { t: 'hello'; projectId: Id }
  | { t: 'ops'; projectId: Id; baseRevision: number; ops: Op[]; clientOpId: string };

export type ChangeOrigin = 'mcp' | 'cli' | 'client' | 'file';

export type ServerMessage =
  | { t: 'state'; project: Project; origin?: ChangeOrigin }
  | { t: 'applied'; clientOpId: string; revision: number }
  | { t: 'ops'; projectId: Id; revision: number; ops: Op[]; origin: ChangeOrigin }
  | { t: 'rejected'; clientOpId: string; errors: OpError[] }
  | { t: 'projects' }
  | { t: 'error'; message: string };
