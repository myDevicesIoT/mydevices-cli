/**
 * CLI Version
 *
 * Update this constant when releasing a new version.
 * This should match the version in package.json.
 */
export const VERSION = '1.0.0';

/**
 * Get the current CLI version
 */
export function getCurrentVersion(): string {
  return VERSION;
}
