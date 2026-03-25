#!/usr/bin/env bash
# Download community YARA rules and copy to api/yara_rules/community/.
# Custom rules in api/yara_rules/ are never overwritten.
# Run manually or as part of CI/CD to keep rules current.
#
# Usage: ./infra/yara/update-rules.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
RULES_DIR="$REPO_ROOT/api/yara_rules"
COMMUNITY_DIR="$RULES_DIR/community"
TMP_DIR=$(mktemp -d)
STAGING_DIR=$(mktemp -d)

trap 'rm -rf "$TMP_DIR" "$STAGING_DIR"' EXIT

mkdir -p "$COMMUNITY_DIR"

echo "==> Downloading YARA-Rules community rules..."
git clone --depth 1 https://github.com/Yara-Rules/rules.git "$TMP_DIR/yara-rules" 2>/dev/null

echo "==> Copying malware rules to staging..."
# Copy a curated subset — full repo has thousands of rules, many for executables we don't need
for category in malware document email; do
    src="$TMP_DIR/yara-rules/${category}"
    if [ -d "$src" ]; then
        for f in "$src"/*.yar "$src"/*.yara; do
            [ -f "$f" ] && cp "$f" "$STAGING_DIR/"
        done
    fi
done

echo "==> Downloading Elastic protections-artifacts YARA rules..."
git clone --depth 1 https://github.com/elastic/protections-artifacts.git "$TMP_DIR/elastic" 2>/dev/null

elastic_yara="$TMP_DIR/elastic/yara/rules"
if [ -d "$elastic_yara" ]; then
    for f in "$elastic_yara"/*.yar "$elastic_yara"/*.yara; do
        [ -f "$f" ] && cp "$f" "$STAGING_DIR/"
    done
fi

echo "==> Validating staged rules (compilation check)..."
# Merge custom + community rules in a temp dir and compile them all together.
# This catches syntax errors BEFORE overwriting production rules.
VALIDATE_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR" "$STAGING_DIR" "$VALIDATE_DIR"' EXIT

# Copy existing custom rules (top-level .yar files, not community/)
for f in "$RULES_DIR"/*.yar "$RULES_DIR"/*.yara; do
    [ -f "$f" ] && cp "$f" "$VALIDATE_DIR/"
done
# Copy staged community rules
for f in "$STAGING_DIR"/*.yar "$STAGING_DIR"/*.yara; do
    [ -f "$f" ] && cp "$f" "$VALIDATE_DIR/"
done

# Compile all rules to check for errors
if python3 -c "
import yara, os, sys
rules_dir = sys.argv[1]
filepaths = {}
for f in sorted(os.listdir(rules_dir)):
    if f.endswith(('.yar', '.yara')):
        name = os.path.splitext(f)[0]
        filepaths[name] = os.path.join(rules_dir, f)
if not filepaths:
    print('ERROR: No rule files found in staging', file=sys.stderr)
    sys.exit(1)
try:
    yara.compile(filepaths=filepaths)
    print(f'OK: {len(filepaths)} rule file(s) compiled successfully')
except yara.SyntaxError as e:
    print(f'ERROR: YARA compilation failed: {e}', file=sys.stderr)
    sys.exit(1)
" "$VALIDATE_DIR"; then
    echo "==> Validation passed. Deploying community rules..."
    # Only overwrite community directory, never custom rules
    rm -rf "$COMMUNITY_DIR"
    mkdir -p "$COMMUNITY_DIR"
    for f in "$STAGING_DIR"/*.yar "$STAGING_DIR"/*.yara; do
        [ -f "$f" ] && cp "$f" "$COMMUNITY_DIR/"
    done
else
    echo "==> ERROR: Validation failed. Community rules NOT updated."
    exit 1
fi

echo "==> Done. Rules directory: $RULES_DIR"
echo "    Custom rule files: $(find "$RULES_DIR" -maxdepth 1 -name '*.yar' -o -name '*.yara' | wc -l)"
echo "    Community rule files: $(find "$COMMUNITY_DIR" -name '*.yar' -o -name '*.yara' | wc -l)"
echo ""
echo "Remember to rebuild the Docker image to include updated rules."
