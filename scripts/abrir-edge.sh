#!/usr/bin/env bash
set -euo pipefail

URL="${1:-https://www.microsoft.com}"

open_linux() {
  local browser=""
  for candidate in microsoft-edge microsoft-edge-stable microsoft-edge-beta microsoft-edge-dev; do
    if command -v "$candidate" >/dev/null 2>&1; then
      browser="$candidate"
      break
    fi
  done

  if [[ -z "$browser" ]]; then
    echo "Erro: Microsoft Edge nao foi encontrado no PATH." >&2
    exit 1
  fi

  nohup "$browser" "$URL" >/dev/null 2>&1 &
  echo "Microsoft Edge iniciado: $URL"
}

open_windows_bash() {
  if command -v cmd.exe >/dev/null 2>&1; then
    cmd.exe /c start "" msedge "$URL" >/dev/null 2>&1
    echo "Microsoft Edge iniciado: $URL"
  else
    echo "Erro: cmd.exe nao foi encontrado." >&2
    exit 1
  fi
}

case "$(uname -s)" in
  Linux*) open_linux ;;
  MINGW*|MSYS*|CYGWIN*) open_windows_bash ;;
  *)
    echo "Erro: sistema nao suportado: $(uname -s)" >&2
    exit 1
    ;;
esac
