// Embed the installed catalog once. Pressing Tab never runs npm or opens a provider.
export function shellCompletion(shell, { commands, models, splitModels, flags }) {
  const words = items => {
    if (!items.every(item => /^[a-zA-Z0-9_.-]+$/.test(item))) throw Error('Invalid completion word');
    return items.join(' ');
  };
  const choices = `case "$prev" in
    --stage|--partition-index) choices='0 1' ;;
    --execution-mode) choices='whole-model partition' ;;
    --model) choices='${words(models)}' ;;
    --weights|--model-directory|--identity-file|--room-token-file|--owner-policy|--model-config|--ordered-config|--cache-directory) paths=1 ;;
    *) case "$cmd" in
      '') choices='${words(commands)} ${words(models)} --help' ;;
      help) choices='${words(commands)} options' ;;
      models) choices='--help' ;;
      completion) choices='bash zsh' ;;
      *) if [[ "$cur" == -* || "$prev" != "$cmd" ]]; then
           choices='--weights ${words(flags)}'
           if [[ "$cmd" == split ]]; then choices="--stage $choices"; fi
         elif [[ "$cmd" == split ]]; then choices='${words(splitModels)} --stage'
         else choices='${words(models)} --weights'; fi ;;
    esac ;;
  esac`;
  if (shell === 'zsh') return `_reploid_complete() {
  local cmd="" prev cur="$PREFIX" choices="" paths=0 start=2
  if [[ "\${words[1]:t}" == npx ]]; then
    if [[ "$words[2]" != reploid || CURRENT -le 2 ]]; then
      "\${_reploid_previous_npx:-_default}" "$@"; return
    fi
    start=3
  fi
  (( CURRENT > start )) && cmd="$words[start]"
  prev="$words[CURRENT-1]"
  ${choices}
  if (( paths )); then _files; else compadd -- \${=choices}; fi
}
if [[ "\${_comps[npx]-}" != _reploid_complete ]]; then
  typeset -g _reploid_previous_npx="\${_comps[npx]-}"
fi
compdef _reploid_complete reploid npx`;
  return `_reploid_complete() {
  local cmd="" prev cur="\${COMP_WORDS[COMP_CWORD]}" choices="" paths=0 start=1
  if [[ "\${COMP_WORDS[0]##*/}" == npx ]]; then
    if [[ "\${COMP_WORDS[1]}" != reploid || $COMP_CWORD -lt 2 ]]; then
      if [[ -n "$_reploid_previous_npx" ]]; then "$_reploid_previous_npx" "$@"; fi
      return
    fi
    start=2
  fi
  (( COMP_CWORD > start )) && cmd="\${COMP_WORDS[start]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
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
