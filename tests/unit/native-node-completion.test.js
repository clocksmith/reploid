// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { shellCompletion } from '../../server/native-node-completion.js';

const catalog = {
  commands: ['ask', 'doctor', 'serve', 'split', 'completion'], models: ['2b', '35b'], splitModels: ['2b'],
  flags: ['--room', '--model', '--help'], askFlags: ['--room', '--model', '--help'],
  doctorFlags: ['--signaling-url', '--origin', '--help'],
};
const cases = {
  bash: `
_original_npx() { COMPREPLY=(untouched); }
complete -F _original_npx npx
SCRIPT
check() {
  COMP_WORDS=("$@")
  COMP_CWORD=$(($# - 1))
  _reploid_complete
  printf '%s\\n' "\${COMPREPLY[@]}"
}
check npx reploid doctor --
check reploid split 2b --stage ''
check reploid ask --room example 3
check npx other ''
`,
  zsh: `
autoload -Uz compinit; compinit -D
_original_npx() { print untouched; }
compdef _original_npx npx
SCRIPT
check() {
  local -a words=("$@")
  local CURRENT=$# PREFIX="$argv[-1]"
  _reploid_complete
}
compadd() { shift; local word; for word; do if [[ "$word" == "$PREFIX"* ]]; then print -r -- "$word"; fi; done; }
check npx reploid doctor --
check reploid split 2b --stage ''
check reploid ask --room example 3
check npx other ''
`,
  fish: `
complete -c npx -f -a untouched -n 'string match -q other -- (commandline -opc)[2]'
SCRIPT
complete -C 'npx reploid doctor --'
complete -C 'reploid split 2b --stage '
complete -C 'reploid ask --room example 3'
complete -C 'npx other '
`,
};

for (const [shell, commands] of Object.entries(cases)) {
  const available = spawnSync(shell, ['--version']).status === 0;
  it.skipIf(!available)(`completes the bundled catalog, stages and relevant flags in ${shell} and preserves other npx completions`, () => {
    const script = commands.replace('SCRIPT', () => shellCompletion(shell, catalog));
    const args = { bash: ['--noprofile', '--norc'], zsh: ['-f'], fish: ['--no-config'] }[shell];
    const result = spawnSync(shell, args, { input: script, encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim().split('\n').sort()).toEqual(['--help', '--origin', '--signaling-url', '0', '1', '35b', 'untouched'].sort());
  });
}
