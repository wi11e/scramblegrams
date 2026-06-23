#!/bin/bash
set -e

IMAGE="scramblegrams-tools"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

build_if_needed() {
  if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
    echo "🔨 Building tools image..."
    docker build -t "$IMAGE" -f "$SCRIPT_DIR/Dockerfile" "$ROOT"
  fi
}

case "${1:-}" in
  setup)
    build_if_needed
    echo "📥 Downloading english-frequency.txt..."
    docker run --rm -v "$SCRIPT_DIR:/out" "$IMAGE" \
      curl -sL "https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/en/en_50k.txt" \
      -o /out/english-frequency.txt
    echo "✅ Done — $(wc -l < "$SCRIPT_DIR/english-frequency.txt") words downloaded"
    ;;

  puzzle)
    build_if_needed
    shift
    docker run --rm -it -v "$ROOT:/app" "$IMAGE" node tools/generate-puzzle.js "$@"
    ;;

  suggest)
    build_if_needed
    shift
    docker run --rm -it -v "$ROOT:/app" "$IMAGE" node tools/suggest-words.js "$@"
    ;;

  week)
    build_if_needed
    shift
    START_DATE="${1:-$(date -u +%Y-%m-%d)}"
    FILE="${2:-$SCRIPT_DIR/wordsets.txt}"
    DIFFICULTY="${3:-3}"

    # --suggest: auto-generate 7 word sets instead of reading from a file
    if [ "$FILE" = "--suggest" ]; then
      echo "🔍  Suggesting word sets for 7 days…"
      TEMP_FILE=$(mktemp)
      docker run --rm -v "$ROOT:/app" "$IMAGE" \
        node tools/suggest-words.js --plain 7 > "$TEMP_FILE"
      FILE="$TEMP_FILE"
      echo "✅  Word sets generated"
      echo ""
    fi

    if [ ! -f "$FILE" ]; then
      echo "❌  Word sets file not found: $FILE"
      echo ""
      echo "Options:"
      echo "  ./tools/run.sh week $START_DATE --suggest            auto-generate word sets"
      echo "  ./tools/run.sh week $START_DATE tools/wordsets.txt   use your own file"
      echo ""
      echo "See tools/wordsets.example.txt for the file format."
      exit 1
    fi

    day=0
    total=0
    while IFS= read -r line || [ -n "$line" ]; do
      # Skip comments and blank lines
      [[ "$line" =~ ^[[:space:]]*# ]] && continue
      [[ -z "${line// }" ]]            && continue

      PUZZLE_DATE=$(date -u -d "$START_DATE + $day days" +%Y-%m-%d)

      echo ""
      echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
      echo "  Day $((day + 1)) of week — $PUZZLE_DATE"
      echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

      # shellcheck disable=SC2086
      docker run --rm -v "$ROOT:/app" "$IMAGE" \
        node tools/generate-puzzle.js $line \
        --date "$PUZZLE_DATE" \
        --difficulty "$DIFFICULTY"

      day=$((day + 1))
      total=$((total + 1))
    done < "$FILE"

    echo ""
    echo "✅  Generated $total puzzles starting $START_DATE"
    echo "   Commit puzzles.json to publish them."
    ;;

  rebuild)
    docker rmi -f "$IMAGE" 2>/dev/null || true
    echo "🔨 Rebuilding tools image..."
    docker build -t "$IMAGE" -f "$SCRIPT_DIR/Dockerfile" "$ROOT"
    echo "✅ Done"
    ;;

  *)
    echo ""
    echo "Usage: ./tools/run.sh <command> [args]"
    echo ""
    echo "  setup                          Download english-frequency.txt (run once)"
    echo "  puzzle WORD1 WORD2 ...         Generate a single puzzle"
    echo "  week [start-date] [file] [diff] Generate a week of puzzles from a word sets file"
    echo "  suggest                        Suggest word sets"
    echo "  rebuild                        Rebuild the Docker image"
    echo ""
    echo "Examples:"
    echo "  ./tools/run.sh setup"
    echo "  ./tools/run.sh puzzle WARDEN DRAWING PLANETS SPORTING BLANKET --difficulty 3"
    echo "  ./tools/run.sh week 2026-06-24 --suggest               # auto-generate word sets"
    echo "  ./tools/run.sh week 2026-06-24                        # uses tools/wordsets.txt, difficulty 3"
    echo "  ./tools/run.sh week 2026-06-24 tools/wordsets.txt 2   # custom file, difficulty 2"
    echo "  ./tools/run.sh suggest --count 4 --top 20"
    echo ""
    ;;
esac
