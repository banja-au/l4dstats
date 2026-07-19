#!/usr/bin/env bash
set -euo pipefail

readonly UNTITLED_PARSER_COMMIT="c7bd376e68cbf693071a652847eccb1d9d76eca7"
readonly REPOSITORY_URL="https://github.com/UncraftedName/UntitledParser.git"

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <directory-containing-dem-files>" >&2
  exit 2
fi

if ! command -v dotnet >/dev/null 2>&1; then
  echo "dotnet is required. Install a .NET 7 SDK from https://dotnet.microsoft.com/download/dotnet/7.0" >&2
  exit 1
fi

readonly REPOSITORY_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly CORPUS_PATH="$(cd "$1" && pwd)"
readonly TOOL_PATH="$REPOSITORY_ROOT/data/reference-validation/UntitledParser"
readonly OUTPUT_PATH="$REPOSITORY_ROOT/data/reference-validation/output"
readonly DUMP_PATH="$OUTPUT_PATH/untitled-parser-dumps"

mkdir -p "$(dirname "$TOOL_PATH")" "$DUMP_PATH"
find "$DUMP_PATH" -maxdepth 1 -type f -name '*--demo-dump.txt' -delete

if [[ ! -d "$TOOL_PATH/.git" ]]; then
  git clone "$REPOSITORY_URL" "$TOOL_PATH"
fi

git -C "$TOOL_PATH" fetch --quiet origin "$UNTITLED_PARSER_COMMIT"
git -C "$TOOL_PATH" checkout --quiet --detach "$UNTITLED_PARSER_COMMIT"

dotnet run \
  --project "$TOOL_PATH/ConsoleApp/ConsoleApp.csproj" \
  --framework net7.0 \
  --configuration Release \
  -- \
  "$CORPUS_PATH" \
  --recursive \
  --demo-dump \
  --output-folder "$DUMP_PATH" \
  | tee "$OUTPUT_PATH/untitled-parser.log"

pnpm --dir "$REPOSITORY_ROOT" --filter @l4dstats/cli dev corpus "$CORPUS_PATH" \
  >"$OUTPUT_PATH/l4dstats-corpus.json"

git -C "$TOOL_PATH" rev-parse HEAD >"$OUTPUT_PATH/untitled-parser.commit"

node "$REPOSITORY_ROOT/scripts/compare-untitled-framing.mjs" \
  "$DUMP_PATH" \
  "$OUTPUT_PATH/l4dstats-corpus.json" \
  "$OUTPUT_PATH/untitled-parser.commit" \
  >"$OUTPUT_PATH/untitled-framing-report.json"

if command -v sha256sum >/dev/null 2>&1; then
  while IFS= read -r artifact; do
    sha256sum "$artifact"
  done < <(find "$OUTPUT_PATH" -type f ! -name SHA256SUMS | LC_ALL=C sort) \
    >"$OUTPUT_PATH/SHA256SUMS"
else
  while IFS= read -r artifact; do
    shasum -a 256 "$artifact"
  done < <(find "$OUTPUT_PATH" -type f ! -name SHA256SUMS | LC_ALL=C sort) \
    >"$OUTPUT_PATH/SHA256SUMS"
fi

echo "Reference outputs: $OUTPUT_PATH"
echo "Independent outer-framing comparison passed. See untitled-framing-report.json."
