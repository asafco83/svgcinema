#!/bin/sh
# Builds the Linux downloads into thumbnailers/linux/dist: a .deb (installs under /usr) and a
# .tar.gz with install.sh for other distributions.
set -e
cd "$(dirname "$0")"
VERSION=1.0.0
rm -rf dist && mkdir -p dist
# tarball
T=dist/svgcinema-thumbnails
mkdir -p "$T"
cp svgcinema-thumbnailer svgcinema.thumbnailer svgcinema-mime.xml install.sh uninstall.sh "$T"/
tar -C dist -czf dist/svgcinema-thumbnails-linux.tar.gz svgcinema-thumbnails
rm -rf "$T"
# .deb
D=dist/deb
install -Dm755 svgcinema-thumbnailer "$D/usr/bin/svgcinema-thumbnailer"
install -Dm644 svgcinema.thumbnailer "$D/usr/share/thumbnailers/svgcinema.thumbnailer"
install -Dm644 svgcinema-mime.xml "$D/usr/share/mime/packages/svgcinema.xml"
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
POST
cp "$D/DEBIAN/postinst" "$D/DEBIAN/postrm"
chmod 755 "$D/DEBIAN/postinst" "$D/DEBIAN/postrm"
dpkg-deb --root-owner-group --build "$D" dist/svgcinema-thumbnails.deb >/dev/null
rm -rf "$D"
ls -la dist
