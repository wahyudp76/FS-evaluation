#!/usr/bin/env bash
# Commit & push workspace -> https://github.com/wahyudp76/FS-evaluation (branch main)
# pakai: bash tools/push.sh <GITHUB_PAT> [pesan commit]
set -euo pipefail

PAT="${GITHUB_PAT:-${1:-}}"
MSG="${2:-v1.20.0 — analisa konsumsi listrik kWh pompa elektrik SPE pada tab Performance Wilayah & Index Solar serta dukungan 36 kolom ZPAS637}"
SRC="/home/user"
REPO="${REPO_DIR:-/tmp/fs-eval}"
BRANCH="${REPO_BRANCH:-main}"

if [ -z "$PAT" ]; then
  echo "Pemakaian: GITHUB_PAT=... bash tools/push.sh [pesan commit]" >&2
  exit 2
fi

cleanup() {
  if [ -d "$REPO/.git" ]; then
    git -C "$REPO" remote set-url origin "https://github.com/wahyudp76/FS-evaluation.git" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

if [ -d "$REPO/.git" ]; then
  echo "==> memperbarui clone yang ada: $REPO"
  git -C "$REPO" remote set-url origin "https://github.com/wahyudp76/FS-evaluation.git"
  git -C "$REPO" fetch origin "$BRANCH" --quiet || true
  git -C "$REPO" checkout "$BRANCH" --quiet || true
  git -C "$REPO" reset --hard "origin/$BRANCH" --quiet || true
else
  echo "==> clone baru ke $REPO"
  rm -rf "$REPO"
  git clone --branch "$BRANCH" "https://github.com/wahyudp76/FS-evaluation.git" "$REPO"
fi

echo "==> salin file dari workspace"
for f in index.html app.js sw.js manifest.json README.md .gitignore; do
  [ -f "$SRC/$f" ] && cp "$SRC/$f" "$REPO/$f"
done
rm -rf "$REPO/assets" "$REPO/tools" "$REPO/.github"
cp -r "$SRC/assets" "$REPO/assets"
cp -r "$SRC/tools" "$REPO/tools"
cp -r "$SRC/.github" "$REPO/.github"
rm -rf "$REPO/apps-script"
[ -d "$SRC/apps-script" ] && cp -r "$SRC/apps-script" "$REPO/apps-script"
echo "    root:"; ls -1 "$REPO" | sed 's#.*#      #' | head -n 20

git -C "$REPO" config user.email "wahyudp76@users.noreply.github.com"
git -C "$REPO" config user.name "PG2 Dashboard Bot"
git -C "$REPO" add -A
if git -C "$REPO" diff --cached --quiet; then
  echo "==> tidak ada perubahan untuk di-commit"
else
  git -C "$REPO" commit -m "$MSG"
fi

echo "==> push"
git -C "$REPO" remote set-url origin "https://${PAT}@github.com/wahyudp76/FS-evaluation.git"
git -C "$REPO" push --quiet origin "$BRANCH"
git -C "$REPO" remote set-url origin "https://github.com/wahyudp76/FS-evaluation.git"

echo "==> selesai. Cek: https://github.com/wahyudp76/FS-evaluation/actions"
git -C "$REPO" log --oneline -3
