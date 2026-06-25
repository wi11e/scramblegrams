#!/bin/bash
set -e

IMAGE="scramblegrams-generator"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

build_if_needed() {
  if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
    echo "🔨 Building generator image..."
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

  generate)
    build_if_needed
    shift
    docker run --rm -it -v "$ROOT:/app" "$IMAGE" node generator/generate-puzzle.js "$@"
    ;;

  rebuild)
    docker rmi -f "$IMAGE" 2>/dev/null || true
    echo "🔨 Rebuilding generator image..."
    docker build -t "$IMAGE" -f "$SCRIPT_DIR/Dockerfile" "$ROOT"
    echo "✅ Done"
    ;;

  *)
    echo ""
    echo "Usage: ./generator/run.sh <command> [args]"
    echo ""
    echo "  setup                                   Download english-frequency.txt (run once)"
    echo "  generate --from YYYY-MM-DD --to YYYY-MM-DD  Generate puzzles for a date range"
    echo "  rebuild                                 Rebuild the Docker image"
    echo ""
    echo "Examples:"
    echo "  ./generator/run.sh setup"
    echo "  ./generator/run.sh generate --from 2026-07-01 --to 2027-06-30"
    echo "  ./generator/run.sh generate --from 2026-07-01 --to 2026-07-31  # one month"
    echo ""
    ;;
esac
