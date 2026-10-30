#!/bin/sh
# Builds the Linux downloads into thumbnailers/linux/dist: a .deb (installs under /usr) and a
# .tar.gz with install.sh for other distributions.
set -e
cd "$(dirname "$0")"
VERSION=1.1.0
rm -rf dist && mkdir -p dist
# tarball
T=dist/svgcinema-thumbnails
mkdir -p "$T"
cp -r svgcinema-thumbnailer svgcinema.thumbnailer svgcinema-mime.xml install.sh uninstall.sh icons "$T"/
tar -C dist -czf dist/svgcinema-thumbnails-linux.tar.gz svgcinema-thumbnails
rm -rf "$T"
# .deb
D=dist/deb
install -Dm755 svgcinema-thumbnailer "$D/usr/bin/svgcinema-thumbnailer"
install -Dm644 svgcinema.thumbnailer "$D/usr/share/thumbnailers/svgcinema.thumbnailer"
install -Dm644 svgcinema-mime.xml "$D/usr/share/mime/packages/svgcinema.xml"
for s in 16 24 32 48 64 128 256; do
  install -Dm644 "icons/${s}x${s}/application-x-svgcinema-project.png" "$D/usr/share/icons/hicolor/${s}x${s}/mimetypes/application-x-svgcinema-project.png"
done
mkdir -p "$D/DEBIAN"
cat > "$D/DEBIAN/control" <<CTRL
Package: svgcinema-thumbnails
Version: $VERSION
Architecture: all
Maintainer: SVGcinema <noreply@users.noreply.github.com>
Depends: unzip | python3
Section: graphics
Priority: optional
Homepage: https://asafco83.github.io/svgcinema/
Description: Thumbnails for SVGcinema projects in file managers
 Shows the first frame of .SVGcinema animation projects as their thumbnail
 in GNOME Files, Nemo, Caja, Thunar and other file managers that use
 freedesktop thumbnailers.
CTRL
cat > "$D/DEBIAN/postinst" <<'POST'
#!/bin/sh
command -v update-mime-database >/dev/null 2>&1 && update-mime-database /usr/share/mime || true
command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -q -t /usr/share/icons/hicolor || true
POST
cp "$D/DEBIAN/postinst" "$D/DEBIAN/postrm"
chmod 755 "$D/DEBIAN/postinst" "$D/DEBIAN/postrm"
dpkg-deb --root-owner-group --build "$D" dist/svgcinema-thumbnails.deb >/dev/null
rm -rf "$D"
ls -la dist
