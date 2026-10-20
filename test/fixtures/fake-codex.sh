typed="$1"
state="$2"
title="$3"
switch="$4"
buf=""
stty -icanon -echo
draw() {
  printf '\033]2;%s\033\\' "$title"
  printf '\033[2J\033[H\033[1;2m› \033[0man earlier prompt\n• an answer\n\n\033[1m›\033[0m %s\n\n  \033[38;5;223mGPT-6-Astra low\033[39m · ~/work\n  \033[1m←\033[0m for agents' "$buf"
  printf '%s' "$buf" > "$state"
}
draw
while IFS= read -r -n1 -d '' c; do
  case "$c" in
    $'\r' | $'\n')
      printf '%s\n' "$buf" >> "$typed"
      if [ "$buf" = /new ]; then title=work; else title='Kiwi started | work'; fi
      buf=""
      ;;
    $'\x7f' | $'\b') buf="${buf%?}" ;;
    *) buf="$buf$c" ;;
  esac
  if [ -n "$switch" ] && [ "$buf" = "$switch" ]; then title='Something else | work'; fi
  draw
done
