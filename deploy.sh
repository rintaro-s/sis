#!/usr/bin/env bash

#ただの化石。リダイレクト

set -euo pipefail

# Backward-compatible wrapper: now we use try-deploy.sh for the default path
DIR=$(cd -- "$(dirname -- "$0")"; pwd)
exec "$DIR/try-deploy.sh" "$@"
