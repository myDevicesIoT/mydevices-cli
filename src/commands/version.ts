import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { getCurrentVersion } from '../lib/version.js';

const GITHUB_REPO = 'myDevicesIoT/mydevices-cli';

interface GitHubRelease {
  tag_name: string;
  name: string;
  html_url: string;
  published_at: string;
  prerelease: boolean;
  draft: boolean;
}

/**
 * Fetch latest release from GitHub
 */
async function getLatestRelease(): Promise<GitHubRelease | null> {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
      {
        headers: {
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'mydevices-cli',
        },
      }
    );

    if (!response.ok) {
      if (response.status === 404) {
        return null; // No releases yet
      }
      throw new Error(`GitHub API error: ${response.status}`);
    }

    return await response.json() as GitHubRelease;
  } catch {
    return null;
  }
}

/**
 * Parse version string to comparable parts
 */
function parseVersion(version: string): number[] {
  // Remove 'v' prefix if present
  const clean = version.replace(/^v/, '');
  return clean.split('.').map((p) => parseInt(p, 10) || 0);
}

/**
 * Compare two versions
 * Returns: -1 if a < b, 0 if a == b, 1 if a > b
 */
function compareVersions(a: string, b: string): number {
  const partsA = parseVersion(a);
  const partsB = parseVersion(b);

  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const numA = partsA[i] || 0;
    const numB = partsB[i] || 0;

    if (numA < numB) return -1;
    if (numA > numB) return 1;
  }

  return 0;
}

export function createVersionCommands(): Command {
  const version = new Command('version')
    .description('Show version information and check for updates')
    .option('--check', 'Check for updates')
    .option('--json', 'Output as JSON')
    .action(async (options: { check?: boolean; json?: boolean }) => {
      const currentVersion = getCurrentVersion();

      if (!options.check) {
        // Just show current version
        if (options.json) {
          console.log(JSON.stringify({ version: currentVersion }, null, 2));
        } else {
          console.log(`mydevices-cli v${currentVersion}`);
        }
        return;
      }

      // Check for updates
      const spinner = ora('Checking for updates...').start();

      try {
        const release = await getLatestRelease();
        spinner.stop();

        if (!release) {
          if (options.json) {
            console.log(
              JSON.stringify(
                {
                  current: currentVersion,
                  latest: null,
                  updateAvailable: false,
                  message: 'No releases found',
                },
                null,
                2
              )
            );
          } else {
            console.log(`Current version: ${chalk.cyan(`v${currentVersion}`)}`);
            console.log(chalk.yellow('No releases found on GitHub'));
          }
          return;
        }

        const latestVersion = release.tag_name.replace(/^v/, '');
        const comparison = compareVersions(currentVersion, latestVersion);
        const updateAvailable = comparison < 0;

        if (options.json) {
          console.log(
            JSON.stringify(
              {
                current: currentVersion,
                latest: latestVersion,
                updateAvailable,
                releaseUrl: release.html_url,
                publishedAt: release.published_at,
              },
              null,
              2
            )
          );
        } else {
          console.log(`Current version: ${chalk.cyan(`v${currentVersion}`)}`);
          console.log(`Latest version:  ${chalk.cyan(`v${latestVersion}`)}`);
          console.log();

          if (updateAvailable) {
            console.log(
              chalk.yellow('⚠')  + ' ' +
              chalk.yellow('Update available!')
            );
            console.log();
            console.log('To update, run:');
            console.log(chalk.gray('  # Clone and build from source'));
            console.log(chalk.cyan(`  git clone https://github.com/${GITHUB_REPO}.git`));
            console.log(chalk.cyan('  cd mydevices-cli'));
            console.log(chalk.cyan('  bun install'));
            console.log(chalk.cyan('  bun run build'));
            console.log();
            console.log(`Release notes: ${chalk.underline(release.html_url)}`);
          } else if (comparison === 0) {
            console.log(chalk.green('✓') + ' You are using the latest version');
          } else {
            console.log(
              chalk.blue('ℹ') +
              ' You are using a newer version than the latest release'
            );
          }
        }
      } catch (err) {
        spinner.stop();
        console.error(
          chalk.red('Error checking for updates:'),
          err instanceof Error ? err.message : 'Unknown error'
        );
        process.exit(1);
      }
    });

  return version;
}
