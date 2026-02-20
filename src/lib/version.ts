import pkg from '../../package.json';

/**
 * Get the current CLI version from package.json
 */
export function getCurrentVersion(): string {
  return pkg.version;
}
