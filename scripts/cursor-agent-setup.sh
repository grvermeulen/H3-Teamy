#!/usr/bin/env bash
set -euo pipefail

# Non-interactive shells (zoals Cursor Agents) laden vaak geen nvm/fnm; dan ontbreekt npm op PATH.
if [[ -z "${NVM_DIR:-}" && -d "${HOME}/.nvm" ]]; then
  export NVM_DIR="${HOME}/.nvm"
fi
if [[ -n "${NVM_DIR:-}" && -s "${NVM_DIR}/nvm.sh" ]]; then
  # shellcheck source=/dev/null
  . "${NVM_DIR}/nvm.sh"
fi
if command -v fnm >/dev/null 2>&1; then
  eval "$(fnm env)"
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "cursor-agent-setup: npm niet gevonden. Installeer Node.js 22 (engines in package.json) of zet npm op PATH." >&2
  exit 1
fi

npm ci --legacy-peer-deps --ignore-scripts \
  || npm install --legacy-peer-deps --ignore-scripts

npm run prisma:generate
