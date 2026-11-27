// Embed the installed catalog once. Pressing Tab never runs npm or opens a provider.
export function shellCompletion(shell, { commands, models, splitModels, flags, askFlags = [], doctorFlags = [], peersFlags = [] }) {
  const words = items => {
    if (!items.every(item => /^[a-zA-Z0-9_.-]+$/.test(item))) throw Error('Invalid completion word');
    return [...new Set(items)].join(' ');
  };
  const modes = ['--contribute', '--share-files', '--connect-only', '--execution-mode'];
  const namedFlags = flags.filter(flag => !modes.includes(flag));
  const common = ['--weights', ...namedFlags.filter(flag => !['--partition-index', '--ordered-config', '--canonical', '--readiness-log'].includes(flag))];
  const cases = {
    help: [commands.concat('options'), []],
    models: [[], ['--help']],
    doctor: [[], doctorFlags],
    completion: [['bash', 'zsh', 'fish'], ['--help']],
    ask: [models, askFlags],
    peers: [models, peersFlags],
    split: [splitModels, ['--stage', '--weights', ...namedFlags]],
    serve: [models, common],
    connect: [models, common],
    share: [models, common],
  };
  const pathFlags = ['--weights', '--model-directory', '--identity-file', '--room-token-file', '--owner-policy', '--model-config',
    '--ordered-config', '--cache-directory', '--rtc-config-file', '--earning-config', '--readiness-log', '--shader-cache-root',
    '--browser-search-profile', '--runtime-source-config'];
  const valueFlags = [...new Set([...pathFlags, ...flags, ...askFlags, ...doctorFlags, ...peersFlags, '--stage'])]
    .filter(flag => !['--help', '--contribute', '--share-files', '--connect-only', '--canonical', '--web-search', '--no-browser-search', '--json'].includes(flag));
  // Count positional words already entered, skipping flag values so '--room lab' does
  // not consume the model slot. Values are never evaluated or sent anywhere.
  const root = words([...commands, ...models, '--help']);
  if (shell === 'fish') {
    const fishCases = Object.entries(cases).map(([name, [positional, options]]) =>
      `        case ${name}\n            set choices ${words(options)}\n            if test $count_args -eq 0; set -a choices ${words(positional)}; end`).join('\n');
    return `function __reploid_words
    set -l tokens (commandline -opc)
    set -e tokens[1]
    if test "$argv[1]" = npx; set -e tokens[1]; end
    if not set -q tokens[1]; printf '%s\\n' ${root}; return; end
    set -l cmd $tokens[1]
    set -e tokens[1]
    set -l expecting
    set -l count_args 0
    for token in $tokens
        if test -n "$expecting"
            set expecting
        else if contains -- $token ${words(valueFlags)}
            set expecting $token
        else if not string match -q -- '-*' $token
            set count_args (math $count_args + 1)
        end
    end
    set -l choices
    if test -n "$expecting"
        switch $expecting
        case ${words(pathFlags)}
            __fish_complete_path (commandline -ct)
            return
        case --model
            if test "$cmd" = split; printf '%s\\n' ${words(splitModels)}; else; printf '%s\\n' ${words(models)}; end
            return
        case --stage --partition-index
            set choices 0 1
        case --execution-mode
            set choices whole-model partition
        end
    else
        switch $cmd
${fishCases}
        case '*'
            set choices --weights ${words(flags)}
        end
    end
    if set -q choices[1]; printf '%s\\n' $choices; end
end
function __reploid_npx_active
    set -l tokens (commandline -opc)
    test "$tokens[2]" = reploid
end
complete -c reploid -f -a '(__reploid_words reploid)'
complete -c npx -n __reploid_npx_active -f -a '(__reploid_words npx)'`;
  }
  const cmdCases = Object.entries(cases).map(([name, [positional, options]]) =>
    `      ${name}) choices='${words(options)}'; if (( count_args == 0 )); then choices="$choices ${words(positional)}"; fi ;;`).join('\n');
  const choices = `local expecting="" token count_args=0 i
  for (( i=start+1; i<end; i++ )); do
    token="${shell === 'zsh' ? '$words[i]' : '${COMP_WORDS[i]}'}"
    if [[ -n "$expecting" ]]; then expecting=""
    else
      case "$token" in
        ${valueFlags.join('|')}) expecting="$token" ;;
        -*) ;;
        *) ((count_args+=1)) ;;
      esac
    fi
  done
  if [[ -n "$expecting" ]]; then
    case "$expecting" in
      ${pathFlags.join('|')}) paths=1 ;;
      --model) if [[ "$cmd" == split ]]; then choices='${words(splitModels)}'; else choices='${words(models)}'; fi ;;
      --stage|--partition-index) choices='0 1' ;;
      --execution-mode) choices='whole-model partition' ;;
    esac
  else
    case "$cmd" in
      '') choices='${root}' ;;
${cmdCases}
      *) choices='--weights ${words(flags)}' ;;
    esac
  fi`;
  if (shell === 'zsh') return `_reploid_complete() {
  local cmd="" choices="" paths=0 start=2 end=$CURRENT
  if [[ "\${words[1]:t}" == npx ]]; then
    if [[ "$words[2]" != reploid || CURRENT -le 2 ]]; then
      "\${_reploid_previous_npx:-_default}" "$@"; return
    fi
    start=3
  fi
  (( CURRENT > start )) && cmd="$words[start]"
  ${choices}
  if (( paths )); then _files; else compadd -- \${=choices}; fi
}
if [[ "\${_comps[npx]-}" != _reploid_complete ]]; then
  typeset -g _reploid_previous_npx="\${_comps[npx]-}"
fi
compdef _reploid_complete reploid npx`;
  return `_reploid_complete() {
  local cmd="" cur="\${COMP_WORDS[COMP_CWORD]}" choices="" paths=0 start=1 end=$COMP_CWORD
  if [[ "\${COMP_WORDS[0]##*/}" == npx ]]; then
    if [[ "\${COMP_WORDS[1]}" != reploid || $COMP_CWORD -lt 2 ]]; then
      if [[ -n "$_reploid_previous_npx" ]]; then "$_reploid_previous_npx" "$@"; fi
      return
    fi
    start=2
  fi
  (( COMP_CWORD > start )) && cmd="\${COMP_WORDS[start]}"
  ${choices}
  COMPREPLY=()
  local word
  if (( paths )); then
    while IFS= read -r word; do COMPREPLY+=("$word"); done < <(compgen -f -- "$cur")
  else
    while IFS= read -r word; do COMPREPLY+=("$word"); done < <(compgen -W "$choices" -- "$cur")
  fi
}
complete -F _reploid_complete reploid
_reploid_spec=$(complete -p npx 2>/dev/null) || _reploid_spec=''
if [[ -z "$_reploid_spec" ]]; then
  complete -o default -F _reploid_complete npx
elif [[ "$_reploid_spec" =~ ' -F '([[:alnum:]_:-]+)' ' && "\${BASH_REMATCH[1]}" != _reploid_complete ]]; then
  _reploid_previous_npx=\${BASH_REMATCH[1]}
  eval "\${_reploid_spec/ -F $_reploid_previous_npx / -F _reploid_complete }"
fi
unset _reploid_spec`;
}
