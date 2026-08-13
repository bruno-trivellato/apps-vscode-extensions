#!/usr/bin/env bash
# Publish brunos-knowledge-base-toolkit to the VS Code Marketplace.
#
# Usage:
#   export VSCE_PAT='your-azure-devops-token'   # never hardcode it in a file
#   ./publish.sh                                # publishes current version
#   ./publish.sh patch                          # bump patch + publish (also minor|major)
#
# The token is read from the VSCE_PAT env var and passed straight to vsce.
# It is never written to disk by this script.
set -euo pipefail

cd "$(dirname "$0")"

if [[ -z "${VSCE_PAT:-}" ]]; then
  # Try macOS Keychain (see README for how to store it once).
  VSCE_PAT=$(security find-generic-password -s vsce-pat -w 2>/dev/null || true)
fi

if [[ -z "${VSCE_PAT:-}" ]]; then
  # Fall back to a secure prompt — input is hidden, never echoed or stored on disk.
  read -r -s -p "Paste your Azure DevOps PAT (Marketplace > Manage): " VSCE_PAT
  echo
fi
export VSCE_PAT

if [[ -z "${VSCE_PAT:-}" || "$VSCE_PAT" == "paste-your-token-here" ]]; then
  echo "ERROR: no real token provided." >&2
  exit 1
fi

PUBLISHER=$(node -p "require('./package.json').publisher")
if [[ "$PUBLISHER" == "bruno" || -z "$PUBLISHER" ]]; then
  echo "ERROR: package.json publisher ('$PUBLISHER') is not a real Marketplace publisher id." >&2
  exit 1
fi

echo ">> Installing deps…"
npm install --no-audit --no-fund

BUMP="${1:-}"
echo ">> Publishing as publisher '$PUBLISHER'${BUMP:+ (version bump: $BUMP)}…"
npx --yes @vscode/vsce publish $BUMP -p "$VSCE_PAT"

echo ">> Done. Check: https://marketplace.visualstudio.com/items?itemName=$PUBLISHER.brunos-knowledge-base-toolkit"
