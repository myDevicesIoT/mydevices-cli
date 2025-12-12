import { Command } from 'commander';
import ora from 'ora';
import { apiGet } from '../lib/api.js';
import { output, error } from '../lib/output.js';
import type { Rule, ApiResponse, ListOptions } from '../types/index.js';

export function createRulesCommands(): Command {
  const rules = new Command('rules').description('Manage rules and alerts');

  rules
    .command('list')
    .description('List all rules')
    .option('-l, --limit <number>', 'Results per page', '20')
    .option('-p, --page <number>', 'Page number', '0')
    .option('--status <status>', 'Filter by status')
    .option('--json', 'Output as JSON')
    .action(async (options: ListOptions & { status?: string }) => {
      const spinner = ora('Fetching rules...').start();
      try {
        const params: Record<string, unknown> = {
          limit: parseInt(options.limit as unknown as string, 10),
          page: parseInt(options.page as unknown as string, 10),
        };
        if (options.status) params.status = options.status;

        const response = await apiGet<ApiResponse<Rule>>('/v1.0/admin/rules', params);
        spinner.stop();

        const rules = response.rows || [];
        output(rules, {
          json: options.json,
          tableHeaders: ['ID', 'Name', 'Status', 'Created'],
          tableMapper: (r: Rule) => [r.id, r.name, r.status, r.created_at],
          footer: `Total: ${response.count || rules.length} rules`,
        });
      } catch (err) {
        spinner.stop();
        error(err instanceof Error ? err.message : 'Failed to fetch rules');
        process.exit(1);
      }
    });

  rules
    .command('count')
    .description('Get total rule count')
    .action(async () => {
      try {
        const response = await apiGet<{ count: number; application_id?: string }>('/v1.0/admin/rules/count');
        console.log(response.count);
      } catch (err) {
        error(err instanceof Error ? err.message : 'Failed to get count');
        process.exit(1);
      }
    });

  return rules;
}
