#!/bin/sh
# Installs the SVGcinema thumbnailer for every user of this computer (needs sudo): the script in
# /usr/local/bin (file managers run thumbnailers in a sandbox that only sees system folders), the
# .SVGcinema file type and the thumbnailer entry under /usr/local/share. Run ./uninstall.sh to remove.
set -e
cd "$(dirname "$0")"
SUDO=""; [ "$(id -u)" -eq 0 ] || SUDO="sudo"
$SUDO install -Dm755 svgcinema-thumbnailer /usr/local/bin/svgcinema-thumbnailer
$SUDO install -Dm644 svgcinema.thumbnailer /usr/local/share/thumbnailers/svgcinema.thumbnailer
$SUDO install -Dm644 svgcinema-mime.xml /usr/local/share/mime/packages/svgcinema.xml
command -v update-mime-database >/dev/null 2>&1 && $SUDO update-mime-database /usr/local/share/mime
# forget earlier "no thumbnail" results, so existing projects get one
rm -rf "${XDG_CACHE_HOME:-$HOME/.cache}/thumbnails/fail" 2>/dev/null || true
echo "SVGcinema thumbnails installed. Reopen your file manager window to see them."
