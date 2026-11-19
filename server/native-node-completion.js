/** Generate static completion scripts so Tab never invokes npm or starts a participant. */
export function renderCompletion(shell, { options, models, legacyOptions }) {
  const commandNames = Object.keys(options).join(' ');
  const modelNames = rows => rows.flatMap(({ id, aliases }) => [...aliases, id]).join(' ');
  const all = modelNames(models);
  const split = modelNames(models.filter(row => row.modes.includes('partition')));
  const choices = `_reploid_choices() {
  case "$2" in
    --stage|--partition-index) printf '%s' '0 1'; return ;;
    --weights|--model-directory|--identity-file|--model-config|--ordered-config|--room-token-file) return 1 ;;
    --room|--signaling|--signaling-url|--port) return ;;
  esac
  if [ "$3" -eq 1 ]; then
    printf '%s' '${commandNames} ${all} --help'
    return
  fi
  case "$1" in
    models) printf '%s' '--json --help' ;;
    completion) printf '%s' 'zsh bash fish --help' ;;
    help) printf '%s' '${commandNames}' ;;
${['ask', 'serve', 'contribute'].map(name => `    ${name}) [ "$3" -ne 2 ] || printf '%s ' '${all}'; printf '%s' '${options[name]} --help' ;;`).join('\n')}
    doctor) printf '%s' '${options.doctor} --help' ;;
    split) [ "$3" -ne 2 ] || printf '%s ' '${split}'; printf '%s' '${options.split} --help' ;;
    *) printf '%s' '${legacyOptions} --help' ;;
  esac
}`;

  if (shell === 'bash') {
    return `${choices}
_reploid_complete() {
  local start="\${1:-0}" offset cur prev choices match
  offset=$((COMP_CWORD - start))
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  COMPREPLY=()
  if choices=$(_reploid_choices "\${COMP_WORDS[start+1]}" "$prev" "$offset"); then
    while IFS= read -r match; do COMPREPLY+=("$match"); done < <(compgen -W "$choices" -- "$cur")
  else
    while IFS= read -r match; do COMPREPLY+=("$match"); done < <(compgen -f -- "$cur")
  fi
}
_reploid_installed_complete() { _reploid_complete 0; }
if [[ $(complete -p npx 2>/dev/null) =~ -F[[:space:]]+([^[:space:]]+) ]]; then
  if [[ \${BASH_REMATCH[1]} != _reploid_npx_complete ]]; then
    _reploid_previous_npx="\${BASH_REMATCH[1]}"
  fi
fi
_reploid_npx_complete() {
  local start=1
  while [[ \${COMP_WORDS[start]} == --yes || \${COMP_WORDS[start]} == -y ]]; do (( start++ )); done
  if [[ \${COMP_WORDS[start]} == reploid && $COMP_CWORD -gt $start ]]; then
    _reploid_complete "$start"
  elif [[ -n \${_reploid_previous_npx:-} ]]; then
    "$_reploid_previous_npx" "$@"
  fi
}
complete -F _reploid_installed_complete reploid
complete -o bashdefault -o default -F _reploid_npx_complete npx`;
  }

  if (shell === 'fish') {
    return `function __reploid_fish_args
    set -l words (commandline -opc)
    set -l command $words[1]
    set -e words[1]
    if test "$command" = npx
        while contains -- "$words[1]" --yes -y
            set -e words[1]
        end
        test "$words[1]" = reploid; or return 1
        set -e words[1]
    end
    printf '%s\\n' $words
end
function __reploid_fish_candidates
    set -l args (__reploid_fish_args)
    switch "$args[-1]"
        case --stage --partition-index
            printf '%s\\n' 0 1
            return
        case --room --signaling --port
            return
    end
    if test (count $args) -eq 0
        printf '%s\\n' ${commandNames} ${all} --help
        return
    end
    switch "$args[1]"
        case models
            printf '%s\\n' --json --help
        case completion
            printf '%s\\n' zsh bash fish --help
        case help
            printf '%s\\n' ${commandNames}
${['ask', 'serve', 'contribute', 'split'].map(name => `        case ${name}
            if test (count $args) -eq 1
                printf '%s\\n' ${name === 'split' ? split : all}
            end
            printf '%s\\n' ${options[name]} --help`).join('\n')}
        case doctor
            printf '%s\\n' ${options.doctor} --help
        case '*'
            printf '%s\\n' ${legacyOptions} --help
    end
end
function __reploid_fish_paths
    set -l args (__reploid_fish_args)
    contains -- "$args[-1]" --weights --model-directory --room-token-file --model-config --ordered-config --identity-file
end
complete -c reploid -n 'not __reploid_fish_paths' -f -a '(__reploid_fish_candidates)'
complete -c npx -n '__reploid_fish_args >/dev/null; and not __reploid_fish_paths' -f -a '(__reploid_fish_candidates)'`;
  }

  return `${choices}
_reploid_complete() {
  local choices
  choices=$(_reploid_choices "\${words[2]}" "\${words[CURRENT-1]}" "$((CURRENT - 1))") || { _files; return; }
  [[ -n $choices ]] && compadd -- \${=choices}
}
if [[ -n \${_comps[npx]} && \${_comps[npx]} != _reploid_npx_complete ]]; then
  _reploid_previous_npx="\${_comps[npx]}"
fi
_reploid_npx_complete() {
  local start=2
  while [[ \${words[start]} == --yes || \${words[start]} == -y ]]; do (( start++ )); done
  if [[ \${words[start]} == reploid && $CURRENT -gt $start ]]; then
    local -a words=("\${words[@]:$((start - 1))}")
    local CURRENT=$((CURRENT - start + 1))
    _reploid_complete
  elif [[ -n \${_reploid_previous_npx:-} ]]; then
    "$_reploid_previous_npx" "$@"
  else
    _default
  fi
}
compdef _reploid_complete reploid
compdef _reploid_npx_complete npx`;
}
