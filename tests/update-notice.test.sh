#!/usr/bin/env bash
# Tests hooks/update-notice against a scratch plugin root and a plugin.json served from a file, standing in for GitHub.
set -uo pipefail
hook="$(cd "$(dirname "$0")/.." && pwd)/hooks/update-notice"
failures=0

setup() {
  dir=$(mktemp -d); mkdir -p "$dir/root/.claude-plugin" "$dir/data"
  printf '{"name": "packrat", "version": "%s"}' "$1" > "$dir/root/.claude-plugin/plugin.json"
  printf '{"name": "packrat", "version": "%s"}' "$2" > "$dir/latest.json"
}
run() { CLAUDE_PLUGIN_ROOT="$dir/root" CLAUDE_PLUGIN_DATA="$dir/data" PACKRAT_PLUGIN_LATEST_URL="${1:-file://$dir/latest.json}" "$hook"; }
expect() { if [[ "$2" == *"$3"* ]]; then echo "ok    $1"; else echo "FAIL  $1: wanted \"$3\" in: $2"; failures=$((failures + 1)); fi; }
expect_empty() { if [ -z "$2" ]; then echo "ok    $1"; else echo "FAIL  $1: wanted nothing, got: $2"; failures=$((failures + 1)); fi; }

setup 0.3.2 0.3.10
out=$(run)
expect "a newer release is announced" "$out" "Packrat plugin 0.3.10 is out (you have 0.3.2)."
expect "with the command that updates it" "$out" "claude plugin update packrat@packrat"
printf '{"version": "0.3.11"}' > "$dir/latest.json"
expect "and GitHub is asked once a day" "$(run)" "0.3.10 is out"

setup 0.3.2 0.3.2
expect_empty "the newest says nothing" "$(run)"
setup 0.4.0 0.3.9
expect_empty "a version ahead of main says nothing" "$(run)"
setup 0.3.2 0.3.3
expect_empty "a GitHub that cannot be reached says nothing" "$(run "file://$dir/missing.json")"
expect_empty "and is not asked again that day" "$(run)"

[ "$failures" -eq 0 ] && echo "all passed" || { echo "$failures failed"; exit 1; }
