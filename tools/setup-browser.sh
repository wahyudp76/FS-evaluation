#!/bin/bash
# Setup headless Chrome untuk uji/verifikasi dashboard (dipakai agen).
# Pakai: bash tools/setup-browser.sh
set -euo pipefail
WORK=${WORK:-/tmp}
mkdir -p "$WORK/node" "$WORK/debs" "$WORK/libs"

echo "== 1. npm deps (puppeteer + papaparse) =="
cd "$WORK/node"
[ -d node_modules/puppeteer ] || npm install --silent puppeteer@23 papaparse@5 >/dev/null
echo "puppeteer: $(node -e "console.log(require('$WORK/node/node_modules/puppeteer/package.json').version)")"

echo "== 2. library sistem untuk Chrome (tanpa root) =="
cd "$WORK/debs"
PKGS="libnspr4 libnss3 libexpat1 libcups2t64 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libasound2t64 libx11-6 libxcb1 libxext6 libxau6 libxdmcp6 libbsd0 libselinux1 libffi8 libpcre2-8-0 libzstd1 libjpeg62-turbo libpng16-16t64 libwebp7 libcap2 libxcb-render0 libxcb-shm0 libxrender1 libgcc-s1 libtinfo6 zlib1g libgraphite2-3 libfribidi0 libmount1 libblkid1 libsystemd0 libtiff6 libbrotli1 libatk1.0-0t64 libatspi2.0-0t64 libavahi-client3 libavahi-common3"
for p in $PKGS; do
  [ -f "$(ls ${p}_*.deb 2>/dev/null | head -1)" ] 2>/dev/null && continue
  apt-get download "$p" >/dev/null 2>&1 || true
done
# apt tidak bisa dipakai di sandbox ini -> ambil langsung dari pool Debian
POOL="nss:libnss3 nspr:libnspr4 expat:libexpat1 cups:libcups2t64 libdrm:libdrm2 libxkbcommon:libxkbcommon0 libxcomposite:libxcomposite1 libxdamage:libxdamage1 libxfixes:libxfixes3 libxrandr:libxrandr2 alsa-lib:libasound2t64 libx11:libx11-6 libxcb:libxcb1 libxext:libxext6 libxau:libxau6 libxdmcp:libxdmcp6 libbsd:libbsd0 libselinux:libselinux1 libffi:libffi8 pcre2:libpcre2-8-0 libzstd:libzstd1 libjpeg-turbo:libjpeg62-turbo libpng1.6:libpng16-16t64 libwebp:libwebp7 libcap2:libcap2 libxcb:libxcb-render0 libxcb:libxcb-shm0 libxrender:libxrender1 gcc-14:libgcc-s1 ncurses:libtinfo6 zlib:zlib1g graphite2:libgraphite2-3 fribidi:libfribidi0 util-linux:libmount1 util-linux:libblkid1 systemd:libsystemd0 tiff:libtiff6 brotli:libbrotli1 at-spi2-core:libatk1.0-0t64 at-spi2-core:libatk-bridge2.0-0t64 at-spi2-core:libatspi2.0-0t64 avahi:libavahi-client3 avahi:libavahi-common3 dbus:libdbus-1-3"
for spec in $POOL; do
  src=${spec%%:*}; pat=${spec##*:}
  [ -n "$(ls ${pat}_*.deb 2>/dev/null | head -1)" ] && continue
  sub=${src:0:4}; case "$src" in lib*) ;; *) sub=${src:0:1};; esac
  listing=$(curl -s "https://deb.debian.org/debian/pool/main/$sub/$src/" | grep -o "href=\"[^\"]*${pat}_[^\"]*_amd64.deb\"" | sed 's/href="//;s/"//' | grep -E 'deb13|deb12' | sort -V | tail -1)
  [ -n "$listing" ] && curl -sO "https://deb.debian.org/debian/pool/main/$sub/$src/$listing"
done
# pool fallback (beberapa paket tidak tersedia via apt download)
fetch_pool () { # $1=pattern $2=src-package
  local pat=$1 src=$2 sub listing
  if ls ${pat}_*.deb >/dev/null 2>&1; then return; fi
  sub=${src:0:4}; [[ $src != lib* ]] && sub=${src:0:1}
  listing=$(curl -s "https://deb.debian.org/debian/pool/main/$sub/$src/" | grep -o "href=\"[^\"]*${pat}_[^\"]*_amd64.deb\"" | sed 's/href="//;s/"//' | grep deb13 | sort -V | tail -1 || true)
  [ -n "$listing" ] && curl -sO "https://deb.debian.org/debian/pool/main/$sub/$src/$listing" || true
}
fetch_pool libatk-bridge2.0-0t64 at-spi2-core
fetch_pool libatk1.0-0t64 at-spi2-core
fetch_pool libatspi2.0-0t64 at-spi2-core
fetch_pool libavahi-client3 avahi
fetch_pool libavahi-common3 avahi
for f in *.deb; do dpkg-deb -x "$f" "$WORK/libs" 2>/dev/null || true; done

echo "== 3. verifikasi Chrome =="
export LD_LIBRARY_PATH="$WORK/libs/usr/lib/x86_64-linux-gnu:$WORK/libs/lib/x86_64-linux-gnu"
CHROME=$(node -e "console.log(require('$WORK/node/node_modules/puppeteer').executablePath())")
MISSING=$(ldd "$CHROME" 2>/dev/null | grep -c "not found" || true)
echo "chrome: $CHROME"
echo "lib hilang: $MISSING"
"$CHROME" --version
echo "SELESAI. Jalankan node dengan: export LD_LIBRARY_PATH=$WORK/libs/usr/lib/x86_64-linux-gnu:$WORK/libs/lib/x86_64-linux-gnu"
