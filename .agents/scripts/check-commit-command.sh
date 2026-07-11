#!/bin/bash
set -u

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec python3 "$script_dir/check-commit-command.py" "${1:-}"
