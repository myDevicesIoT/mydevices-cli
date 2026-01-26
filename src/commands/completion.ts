import { Command } from 'commander';

// ============================================================================
// Completion Scripts
// ============================================================================

const COMMANDS = [
  'auth',
  'companies',
  'locations',
  'users',
  'devices',
  'rules',
  'config',
  'templates',
  'codecs',
  'registry',
  'gateways',
  'completion',
];

const SUBCOMMANDS: Record<string, string[]> = {
  auth: ['login', 'logout', 'whoami', 'token'],
  companies: ['list', 'get', 'create', 'update', 'delete', 'count'],
  locations: ['list', 'get', 'create', 'update', 'delete', 'count'],
  users: ['list', 'get', 'create', 'update', 'delete', 'count', 'permissions'],
  devices: ['list', 'get', 'create', 'update', 'delete', 'count', 'readings', 'command'],
  rules: ['list', 'get', 'count'],
  config: ['get', 'set', 'list', 'reset'],
  templates: ['list', 'get', 'create', 'update', 'delete', 'assign-codec', 'scaffold-decoder', 'datatypes', 'capabilities'],
  codecs: ['list', 'get', 'create', 'update', 'delete', 'decode', 'encode'],
  registry: ['list', 'get', 'create', 'unpair', 'networks'],
  gateways: ['list', 'get', 'pings', 'stats'],
  completion: ['bash', 'zsh', 'fish'],
};

function generateBashCompletion(): string {
  return `# mydevices bash completion
# Add to ~/.bashrc or ~/.bash_profile:
#   eval "$(mydevices completion bash)"
# Or save to a file:
#   mydevices completion bash > /etc/bash_completion.d/mydevices

_mydevices_completions() {
    local cur prev commands
    COMPREPLY=()
    cur="\${COMP_WORDS[COMP_CWORD]}"
    prev="\${COMP_WORDS[COMP_CWORD-1]}"

    # Top-level commands
    commands="${COMMANDS.join(' ')}"

    # Subcommands for each command
    case "\${COMP_WORDS[1]}" in
${Object.entries(SUBCOMMANDS).map(([cmd, subs]) => `        ${cmd})
            COMPREPLY=( $(compgen -W "${subs.join(' ')}" -- "\${cur}") )
            return 0
            ;;`).join('\n')}
    esac

    # Complete top-level commands
    if [[ \${COMP_CWORD} -eq 1 ]]; then
        COMPREPLY=( $(compgen -W "\${commands}" -- "\${cur}") )
        return 0
    fi

    # Complete common options
    if [[ "\${cur}" == -* ]]; then
        COMPREPLY=( $(compgen -W "--help --json --limit --page" -- "\${cur}") )
        return 0
    fi
}

complete -F _mydevices_completions mydevices
`;
}

function generateZshCompletion(): string {
  return `#compdef mydevices
# mydevices zsh completion
# Add to ~/.zshrc:
#   eval "$(mydevices completion zsh)"
# Or save to a file in your fpath:
#   mydevices completion zsh > ~/.zsh/completions/_mydevices

_mydevices() {
    local -a commands
    local -a subcommands

    commands=(
${COMMANDS.map(cmd => `        '${cmd}:${getCommandDescription(cmd)}'`).join('\n')}
    )

    _arguments -C \\
        '1: :->command' \\
        '*: :->args' \\
        && return 0

    case "$state" in
        command)
            _describe -t commands 'mydevices commands' commands
            ;;
        args)
            case "$words[2]" in
${Object.entries(SUBCOMMANDS).map(([cmd, subs]) => `                ${cmd})
                    subcommands=(${subs.map(s => `'${s}'`).join(' ')})
                    _describe -t subcommands '${cmd} subcommands' subcommands
                    ;;`).join('\n')}
            esac
            ;;
    esac
}

_mydevices "$@"
`;
}

function generateFishCompletion(): string {
  return `# mydevices fish completion
# Add to ~/.config/fish/completions/mydevices.fish:
#   mydevices completion fish > ~/.config/fish/completions/mydevices.fish

# Disable file completion by default
complete -c mydevices -f

# Top-level commands
${COMMANDS.map(cmd => `complete -c mydevices -n "__fish_use_subcommand" -a "${cmd}" -d "${getCommandDescription(cmd)}"`).join('\n')}

# Subcommands
${Object.entries(SUBCOMMANDS).map(([cmd, subs]) =>
  subs.map(sub => `complete -c mydevices -n "__fish_seen_subcommand_from ${cmd}" -a "${sub}"`).join('\n')
).join('\n')}

# Common options
complete -c mydevices -l help -s h -d "Show help"
complete -c mydevices -l json -d "Output as JSON"
complete -c mydevices -l limit -s l -d "Results per page"
complete -c mydevices -l page -s p -d "Page number"
`;
}

function getCommandDescription(cmd: string): string {
  const descriptions: Record<string, string> = {
    auth: 'Authentication commands',
    companies: 'Manage companies',
    locations: 'Manage locations',
    users: 'Manage users',
    devices: 'Manage devices',
    rules: 'Manage rules',
    config: 'CLI configuration',
    templates: 'Manage device templates',
    codecs: 'Manage codecs',
    registry: 'Device registry (pre-provisioning)',
    gateways: 'View gateway information',
    completion: 'Generate shell completions',
  };
  return descriptions[cmd] || cmd;
}

// ============================================================================
// Main Completion Command
// ============================================================================

export function createCompletionCommands(): Command {
  const completion = new Command('completion')
    .description('Generate shell completion scripts')
    .argument('<shell>', 'Shell type (bash, zsh, fish)')
    .action((shell: string) => {
      switch (shell.toLowerCase()) {
        case 'bash':
          console.log(generateBashCompletion());
          break;
        case 'zsh':
          console.log(generateZshCompletion());
          break;
        case 'fish':
          console.log(generateFishCompletion());
          break;
        default:
          console.error(`Unknown shell: ${shell}`);
          console.error('Supported shells: bash, zsh, fish');
          process.exit(1);
      }
    });

  return completion;
}
