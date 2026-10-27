import { z } from 'zod';
import type { RelationRule, RelationType } from './types';

/** How concurrent writers are kept from overwriting each other (learning topic: concurrency). */
export const ConcurrencyControlSchema = z.enum([
  'none',
  'optimistic-version',
  'row-lock',
  'advisory-lock',
  'serializable-retry',
]);
export const IsolationLevelSchema = z.enum(['read-committed', 'repeatable-read', 'serializable']);
export const DeliveryGuaranteeSchema = z.enum([
  'at-most-once',
  'at-least-once',
  'effectively-once',
]);

const callProperties = z
  .object({
    auth: z.enum(['none', 'session-cookie', 'bearer-token', 'api-key', 'mtls']),
    idempotent: z.boolean(),
    idempotencyKey: z.boolean(),
    timeoutMs: z.number().int().positive(),
    retries: z.number().int().nonnegative(),
  })
  .partial();

/** Generic relation types (Implementation.md §10.2). */
export const CORE_RELATION_TYPES: RelationType[] = [
  {
    id: 'calls',
    name: 'calls',
    mode: 'sync',
    line: { width: 1.5, marker: 'arrow' },
    defaultPriority: 10,
    propertySchema: callProperties,
    docs: 'Synchronous request/response. Set `protocol` (http, graphql, trpc, websocket, grpc).',
  },
  {
    id: 'reads',
    name: 'reads',
    mode: 'sync',
    line: { width: 1, marker: 'arrow' },
    defaultPriority: 20,
    propertySchema: z
      .object({
        isolation: IsolationLevelSchema,
        consistency: z.enum(['strong', 'eventual']),
        cached: z.boolean(),
      })
      .partial(),
    docs: 'Reads data from a store. Set `via` to the data-access library.',
  },
  {
    id: 'writes',
    name: 'writes',
    mode: 'sync',
    line: { width: 2.5, marker: 'arrow' },
    defaultPriority: 21,
    propertySchema: z
      .object({
        isolation: IsolationLevelSchema,
        concurrencyControl: ConcurrencyControlSchema,
        idempotencyKey: z.boolean(),
        batch: z.boolean(),
      })
      .partial(),
    docs: 'Writes data to a store. Set `via` to the data-access library, and `concurrencyControl` when several writers can change the same rows.',
  },
  {
    id: 'publishes',
    name: 'publishes',
    mode: 'async',
    line: { dash: '6 4', width: 1.5, marker: 'open-arrow' },
    defaultPriority: 30,
    propertySchema: z.object({ deliveryGuarantee: DeliveryGuaranteeSchema }).partial(),
    docs: 'Sends messages or events to a queue, topic or bus.',
  },
  {
    id: 'consumes',
    name: 'consumes',
    mode: 'async',
    line: { dash: '6 4', width: 1.5, marker: 'open-arrow' },
    defaultPriority: 31,
    propertySchema: z
      .object({
        concurrency: z.number().int().positive(),
        ordering: z.enum(['none', 'per-key', 'strict']),
        deliveryGuarantee: DeliveryGuaranteeSchema,
      })
      .partial(),
    docs: 'Receives messages from a queue, topic or bus.',
  },
  {
    id: 'depends-on',
    name: 'depends on',
    mode: 'static',
    line: { dash: '2 3', width: 1, marker: 'open-arrow' },
    defaultPriority: 40,
    docs: 'Compile-time import of another module or package.',
  },
  {
    id: 'implements',
    name: 'implements',
    mode: 'static',
    line: { dash: '2 3', width: 1, marker: 'triangle-hollow' },
    defaultPriority: 41,
    hint: 'Only adapters implement ports.',
    docs: 'An adapter realizes a port (interface).',
  },
  {
    id: 'uses-port',
    name: 'uses port',
    mode: 'static',
    line: { dash: '2 3', width: 1, marker: 'open-arrow' },
    defaultPriority: 42,
    docs: 'Depends on an interface instead of a concrete implementation.',
  },
  {
    id: 'renders',
    name: 'renders',
    mode: 'static',
    line: { width: 1, marker: 'diamond-tail' },
    defaultPriority: 50,
    docs: 'UI composition: a page or component renders another component.',
  },
  {
    id: 'navigates',
    name: 'navigates to',
    mode: 'sync',
    line: { width: 1, marker: 'arrow', curved: true },
    defaultPriority: 51,
    docs: 'UI navigation from one page to another.',
  },
  {
    id: 'emits',
    name: 'emits',
    mode: 'async',
    line: { dash: '6 4', width: 1, marker: 'triangle-hollow' },
    defaultPriority: 60,
    docs: 'Raises a domain or integration event.',
  },
  {
    id: 'handles',
    name: 'handles',
    mode: 'async',
    line: { dash: '6 4', width: 1, marker: 'open-arrow' },
    defaultPriority: 61,
    docs: 'Reacts to an event.',
  },
  {
    id: 'authenticates-with',
    name: 'authenticates with',
    mode: 'sync',
    line: { dash: '8 3 2 3', width: 1, marker: 'arrow' },
    defaultPriority: 70,
    propertySchema: z
      .object({
        flow: z.enum([
          'password',
          'oidc-code-pkce',
          'oauth-client-credentials',
          'magic-link',
          'passkey',
          'api-key',
        ]),
        tokenType: z.enum(['session', 'jwt', 'opaque']),
      })
      .partial(),
    docs: 'Uses an auth provider to sign in users or verify tokens.',
  },
];

/** Generic allow and deny rules (Implementation.md §10.3, §10.4). */
export const CORE_RELATION_RULES: RelationRule[] = [
  // Deny rules: checked before allow rules, the first matching message is shown.
  {
    type: '*',
    deny: { from: ['category:group'] },
    message: 'Groups are containers. Connect the elements inside them.',
  },
  {
    type: '*',
    deny: { to: ['category:group'] },
    message: 'Groups are containers. Connect the elements inside them.',
  },
  {
    type: 'calls',
    deny: { from: ['category:data-at-rest'] },
    message: 'A data store does not call anything. Did you mean the service reads or writes it?',
  },
  {
    type: 'calls',
    deny: { from: ['category:data-in-motion'] },
    message: 'Queues do not call consumers. The consumer consumes the queue.',
  },
  {
    type: 'implements',
    deny: { from: ['category:port'] },
    message: 'Reversed. Adapters implement ports.',
  },
  {
    type: ['reads', 'writes'],
    deny: { from: ['category:domain-core', 'category:domain-object'] },
    message: 'Domain objects have no I/O. Put a repository (adapter) behind a port.',
  },
  {
    type: '*',
    deny: { from: ['category:event'] },
    message: 'Events are facts. They do not depend on anything. Point the relation at the event.',
  },

  // Allow rules.
  {
    type: 'calls',
    from: [
      'category:actor',
      'category:ui',
      'category:deployable',
      'category:module',
      'category:routing',
      'category:adapter',
    ],
    // Adapters are called directly in layered designs (use case → repository).
    to: [
      'category:deployable',
      'category:module',
      'category:adapter',
      'category:routing',
      'category:external',
    ],
  },
  {
    type: ['reads', 'writes'],
    from: ['category:deployable', 'category:module', 'category:adapter'],
    to: ['category:data-at-rest'],
  },
  {
    type: 'publishes',
    from: ['category:deployable', 'category:module', 'category:adapter', 'category:data-at-rest'],
    to: ['category:data-in-motion'],
  },
  {
    type: 'consumes',
    from: ['category:deployable', 'category:module', 'category:adapter'],
    to: ['category:data-in-motion'],
  },
  {
    type: 'depends-on',
    from: ['category:module', 'category:deployable', 'category:adapter', 'category:domain-core'],
    to: [
      'category:module',
      'category:adapter',
      'category:port',
      'category:domain-core',
      'category:domain-object',
      'category:schema',
    ],
  },
  // A data shape (DTO, API schema) may be composed of other data shapes.
  { type: 'depends-on', from: ['category:schema'], to: ['category:schema'] },
  // An adapter usually also imports its port; "implements" is the more useful default.
  { type: 'implements', from: ['category:adapter'], to: ['category:port'], priority: 35 },
  {
    type: 'uses-port',
    from: ['category:module', 'category:domain-core'],
    to: ['category:port'],
  },
  {
    type: 'renders',
    from: ['category:ui', 'category:module'],
    to: ['category:ui', 'category:module'],
  },
  { type: 'navigates', from: ['category:ui'], to: ['category:ui'] },
  {
    type: 'emits',
    from: ['category:domain-core', 'category:domain-object', 'category:module'],
    to: ['category:event'],
  },
  { type: 'handles', from: ['category:module', 'category:deployable'], to: ['category:event'] },
  {
    type: 'authenticates-with',
    from: ['category:ui', 'category:deployable', 'category:routing', 'category:module'],
    to: ['category:security', 'category:external'],
  },
];
