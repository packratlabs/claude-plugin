#!/usr/bin/env bash
# Tests hooks/pr-checks against a scratch checkout on branch cart-cache and a fake packrat that answers as
# the API would: exit 3 for an app it does not verify, a 422 for a draft that says "bad", else success.
set -uo pipefail
hook="$(cd "$(dirname "$0")/.." && pwd)/hooks/pr-checks"
open="gh pr""  create"
open="${open/  / }"
failures=0

setup() {
  dir=$(cd "$(mktemp -d)" && pwd -P); git -C "$dir" init -q -b cart-cache
  cli="$dir/fake-packrat"; draft="$dir/.git/packrat/checks/cart-cache.json"
  cat > "$cli" <<FAKE
#!/usr/bin/env bash
echo "\$*" >> "$dir/asked"
[ -f "$dir/unwatched" ] && { echo "no app is connected" >&2; exit 3; }
file=\$(sed -n 's/.*--file \([^ ]*\).*/\1/p' <<<"\$*"); if [ "\$file" = - ]; then body=\$(cat); else body=\$(cat "\$file"); fi
[[ "\$body" == *bad* ]] && { echo "packrat pr checks set: https://query.packrat.sh answered 422: check 1: after is wrong." >&2; exit 1; }
echo "Declared for \$*"
FAKE
  chmod +x "$cli"
  gh="$dir/fake-gh"; printf '#!/usr/bin/env bash\n[ -f "%s/head" ] && cat "%s/head" || exit 1\n' "$dir" "$dir" > "$gh"; chmod +x "$gh"
}
draft_is() { mkdir -p "$(dirname "$draft")"; printf '%s' "$1" > "$draft"; }
run() { jq -n --arg e "$1" --arg c "$2" --arg d "$dir" --arg out "${3:-}" '{hook_event_name: $e, cwd: $d, tool_input: {command: $c}, tool_response: {stdout: $out}}' | PACKRAT_HOOK_CLI="$cli" PACKRAT_HOOK_GH="$gh" "$hook"; }
expect() { if [[ "$2" == *"$3"* ]]; then echo "ok    $1"; else echo "FAIL  $1: wanted \"$3\" in: $2"; failures=$((failures + 1)); fi; }
expect_empty() { if [ -z "$2" ]; then echo "ok    $1"; else echo "FAIL  $1: wanted nothing, got: $2"; failures=$((failures + 1)); fi; }

setup
out=$(run PreToolUse "git push -u origin cart-cache && $open --title Cache --body-file /tmp/b.md")
expect "no draft stops the pull request" "$out" '"permissionDecision": "deny"'
expect "and says where to write it" "$out" "$draft"

draft_is '[{"title": "Faster", "what": "p95", "after": "1h"}]'
expect_empty "an accepted draft lets it through" "$(run PreToolUse "$open --fill")"
expect "after a dry run" "$(cat "$dir/asked")" "pr checks set --dry-run --file $draft"

draft_is bad
out=$(run PreToolUse "$open --fill")
expect "a refused draft stops it" "$out" '"permissionDecision": "deny"'
expect "and says what to fix" "$out" "check 1: after is wrong."

setup
expect_empty "a commit message is not a pull request" "$(run PreToolUse "git commit -m \"explain why $open needs a draft\"")"
expect_empty "git checkout -b is not a body" "$(run PreToolUse "git checkout -b fix && echo done")"
expect_empty "--web is let through" "$(run PreToolUse "$open --web")"
expect_empty "and none of them asked Packrat" "$(cat "$dir/asked" 2>/dev/null)"

draft_is '[{"title": "Faster", "what": "p95", "after": "1h"}]'
out=$(run PostToolUse "$open --fill" $'https://github.com/acme/shop/pull/482\n')
expect "the draft is declared under the new number" "$(cat "$dir/asked")" "pr checks set https://github.com/acme/shop/pull/482 --file $draft"
expect "and Claude hears it" "$out" "Packrat: Declared for"
draft_is bad
expect "a failed declaration says how to retry" "$(run PostToolUse "$open --fill" 'https://github.com/acme/shop/pull/482')" "Packrat did not declare the checks"

setup
touch "$dir/unwatched"
expect_empty "a repository Packrat does not verify is never stopped" "$(run PreToolUse "$open --fill")"

setup
other=$(cd "$(mktemp -d)" && pwd -P); git -C "$other" init -q -b pane-fix
mkdir -p "$other/.git/packrat/checks"; echo '{"none": "docs"}' > "$other/.git/packrat/checks/pane-fix.json"
expect_empty "a cd into another checkout reads that checkout's draft" "$(run PreToolUse "cd $other && git push -u origin pane-fix && $open --fill")"
expect "and asks Packrat about it" "$(cat "$dir/asked")" "--file $other/.git/packrat/checks/pane-fix.json"
out=$(run PreToolUse "cd $other && cd $dir && $open --fill")
expect "the last cd before gh is the one that counts" "$out" "$draft"

setup
git -C "$dir" remote add origin https://github.com/acme/shop.git
expect_empty "-R naming another repository is let through" "$(run PreToolUse "$open -R acme/elsewhere --fill")"
expect_empty "without asking Packrat" "$(cat "$dir/asked" 2>/dev/null)"
expect "-R naming this repository still wants a draft" "$(run PreToolUse "$open --repo Acme/Shop --fill")" '"permissionDecision": "deny"'

setup
draft_is '[{"title": "Faster", "what": "p95", "after": "1h"}]'
echo cart-cache > "$dir/head"; git -C "$dir" checkout -q -b main
out=$(run PostToolUse "$open --fill && gh pr merge --merge && git checkout main" 'https://github.com/acme/shop/pull/483')
expect "a command that left the branch still declares that branch's draft" "$(cat "$dir/asked")" "pr checks set https://github.com/acme/shop/pull/483 --file $draft"

setup
out=$(run PostToolUse "$open --fill" 'https://github.com/acme/shop/pull/484')
expect "a pull request opened with no draft says none were declared" "$out" "no checks were drafted for cart-cache"
touch "$dir/unwatched"
expect_empty "but not in a repository Packrat does not verify" "$(run PostToolUse "$open --fill" 'https://github.com/acme/shop/pull/484')"

[ "$failures" -eq 0 ] && echo "all passed" || { echo "$failures failed"; exit 1; }
