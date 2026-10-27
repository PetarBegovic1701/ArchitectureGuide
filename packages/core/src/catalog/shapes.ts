import type { CategoryId, Category, ShapeId } from './types';

export interface ShapeSpec {
  id: ShapeId;
  /** Default size in px. */
  width: number;
  height: number;
  resizable: boolean;
  description: string;
}

export const SHAPES: Record<ShapeId, ShapeSpec> = {
  rect: {
    id: 'rect',
    width: 160,
    height: 80,
    resizable: true,
    description: 'Rectangle, 4px radius',
  },
  rounded: {
    id: 'rounded',
    width: 140,
    height: 64,
    resizable: true,
    description: 'Rectangle, 16px radius',
  },
  window: {
    id: 'window',
    width: 160,
    height: 100,
    resizable: true,
    description: 'Rectangle with a title bar',
  },
  hexagon: {
    id: 'hexagon',
    width: 120,
    height: 104,
    resizable: false,
    description: 'Flat-top hexagon',
  },
  'hexagon-sm': {
    id: 'hexagon-sm',
    width: 84,
    height: 72,
    resizable: false,
    description: 'Small hexagon',
  },
  circle: { id: 'circle', width: 56, height: 56, resizable: false, description: 'Circle' },
  plug: {
    id: 'plug',
    width: 120,
    height: 64,
    resizable: true,
    description: 'Rounded square with a plug notch',
  },
  cylinder: {
    id: 'cylinder',
    width: 110,
    height: 90,
    resizable: true,
    description: 'Vertical cylinder',
  },
  'cylinder-dashed': {
    id: 'cylinder-dashed',
    width: 90,
    height: 72,
    resizable: true,
    description: 'Vertical cylinder, dashed outline',
  },
  pipe: { id: 'pipe', width: 150, height: 56, resizable: true, description: 'Horizontal cylinder' },
  triangle: { id: 'triangle', width: 80, height: 70, resizable: false, description: 'Triangle' },
  diamond: { id: 'diamond', width: 100, height: 100, resizable: false, description: 'Diamond' },
  octagon: { id: 'octagon', width: 90, height: 90, resizable: false, description: 'Octagon' },
  actor: { id: 'actor', width: 60, height: 80, resizable: false, description: 'Head and body' },
  cloud: { id: 'cloud', width: 150, height: 90, resizable: true, description: 'Cloud' },
  gear: {
    id: 'gear',
    width: 120,
    height: 64,
    resizable: true,
    description: 'Rounded rectangle with a gear badge',
  },
  container: {
    id: 'container',
    width: 240,
    height: 160,
    resizable: true,
    description: 'Dashed rectangle with a title tab',
  },
};

export const CATEGORIES: Record<CategoryId, Category> = {
  deployable: {
    id: 'deployable',
    name: 'Deployable unit',
    shape: 'rect',
    defaultLayer: 'application',
  },
  module: { id: 'module', name: 'Code module', shape: 'rounded', defaultLayer: 'application' },
  ui: { id: 'ui', name: 'UI surface', shape: 'window', defaultLayer: 'presentation' },
  'domain-core': {
    id: 'domain-core',
    name: 'Domain core',
    shape: 'hexagon',
    defaultLayer: 'domain',
  },
  'domain-object': {
    id: 'domain-object',
    name: 'Domain object',
    shape: 'hexagon-sm',
    defaultLayer: 'domain',
  },
  port: { id: 'port', name: 'Port / interface', shape: 'circle', defaultLayer: 'domain' },
  adapter: { id: 'adapter', name: 'Adapter', shape: 'plug', defaultLayer: 'infrastructure' },
  'data-at-rest': {
    id: 'data-at-rest',
    name: 'Data at rest',
    shape: 'cylinder',
    defaultLayer: 'data',
  },
  'data-in-motion': {
    id: 'data-in-motion',
    name: 'Data in motion',
    shape: 'pipe',
    defaultLayer: 'data',
  },
  'client-state': {
    id: 'client-state',
    name: 'Client state',
    shape: 'cylinder-dashed',
    defaultLayer: 'presentation',
  },
  event: { id: 'event', name: 'Event', shape: 'triangle', defaultLayer: 'domain' },
  routing: {
    id: 'routing',
    name: 'Traffic routing',
    shape: 'diamond',
    defaultLayer: 'infrastructure',
  },
  security: {
    id: 'security',
    name: 'Security boundary',
    shape: 'octagon',
    defaultLayer: 'infrastructure',
  },
  actor: { id: 'actor', name: 'Actor', shape: 'actor' },
  external: { id: 'external', name: 'External system', shape: 'cloud', defaultLayer: 'external' },
  group: { id: 'group', name: 'Group', shape: 'container' },
  'cross-cutting': {
    id: 'cross-cutting',
    name: 'Cross-cutting concern',
    shape: 'gear',
    defaultLayer: 'infrastructure',
  },
};
