#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
printf '\033]0;Cue 서버 API 키 설정\007'
printf '\nCue 서버용 OpenAI API 키를 입력하세요. 화면에는 표시되지 않습니다.\n'
printf 'API 키: '
IFS= read -r -s cue_secret
printf '\n'
if [ -z "$cue_secret" ]; then
  printf '빈 키는 저장하지 않았습니다.\n'
  read -r -p 'Enter를 누르면 창을 닫습니다.' _
  exit 1
fi
umask 077
cue_env_tmp=$(mktemp .env.XXXXXX)
if [ -f .env ]; then
  awk '!/^OPENAI_API_KEY=/' .env > "$cue_env_tmp"
fi
printf 'OPENAI_API_KEY=%s\n' "$cue_secret" >> "$cue_env_tmp"
mv "$cue_env_tmp" .env
chmod 600 .env
unset cue_secret
printf '\n키를 server/.env에 저장했습니다. 이 파일은 Git에서 제외됩니다.\n'
if [ "${CUE_SKIP_START:-0}" = 1 ]; then
  printf '실행 중인 서버에는 새 키가 아직 적용되지 않았습니다. 서버를 재시작해 주세요.\n'
  exit 0
fi
if lsof -nP -iTCP:8788 -sTCP:LISTEN >/dev/null 2>&1; then
  printf '8788 포트의 서버가 이미 실행 중입니다. 새 키를 적용하려면 서버를 재시작해 주세요.\n'
  read -r -p 'Enter를 누르면 창을 닫습니다.' _
  exit 0
fi
printf 'Cue 서버를 8788 포트에서 시작합니다. 앱을 사용하는 동안 이 창을 열어 두세요.\n\n'
export PORT=8788
exec npm start
