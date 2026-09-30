#!/usr/bin/env bash
# The gate: typecheck + full test suite. "Done" means this passes.
set -euo pipefail
cd "$(dirname "$0")/.."
npm run --silent validate
