import type { Detector } from '../context';
import { INFRA_DETECTORS } from './infra';
import { NODE_DETECTORS } from './node';
import { PG_DETECTORS } from './pg';
import { REACT_DETECTORS } from './react';
import { DOTNET_DEPLOYABLE_DETECTORS, DOTNET_DETECTORS } from './dotnet';
import { LIBRARY_DETECTORS } from './libraries';
import { PYTHON_DEPLOYABLE_DETECTORS, PYTHON_DETECTORS } from './python';
import { WORKSPACE_DETECTORS, WORKSPACE_LIBS } from './workspace';

/**
 * The detectors of the react-node-postgres profile, with Python and .NET backends (Implementation.md §19.4), in run order:
 * package detectors first (each runs over all packages before the next one starts, so
 * later ones see the deployables), then the repository detectors.
 */
export const DETECTORS: Detector[] = [
  ...WORKSPACE_DETECTORS,
  ...PYTHON_DEPLOYABLE_DETECTORS,
  ...DOTNET_DEPLOYABLE_DETECTORS,
  ...WORKSPACE_LIBS,
  ...LIBRARY_DETECTORS,
  ...REACT_DETECTORS,
  ...NODE_DETECTORS,
  ...PYTHON_DETECTORS,
  ...DOTNET_DETECTORS,
  ...PG_DETECTORS,
  ...INFRA_DETECTORS,
];
