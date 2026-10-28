import type { Detector } from '../context';
import { INFRA_DETECTORS } from './infra';
import { NODE_DETECTORS } from './node';
import { PG_DETECTORS } from './pg';
import { REACT_DETECTORS } from './react';
import { WORKSPACE_DETECTORS } from './workspace';

/**
 * The detectors of the react-node-postgres profile (Implementation.md §19.4), in run order:
 * package detectors first (each runs over all packages before the next one starts, so
 * later ones see the deployables), then the repository detectors.
 */
export const DETECTORS: Detector[] = [
  ...WORKSPACE_DETECTORS,
  ...REACT_DETECTORS,
  ...NODE_DETECTORS,
  ...PG_DETECTORS,
  ...INFRA_DETECTORS,
];
