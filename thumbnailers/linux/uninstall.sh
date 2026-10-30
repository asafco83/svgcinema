#!/bin/sh
# Removes what install.sh added.
SUDO=""; [ "$(id -u)" -eq 0 ] || SUDO="sudo"
$SUDO rm -f /usr/local/bin/svgcinema-thumbnailer /usr/local/share/thumbnailers/svgcinema.thumbnailer /usr/local/share/mime/packages/svgcinema.xml
$SUDO rm -f /usr/local/share/icons/hicolor/*/mimetypes/application-x-svgcinema-project.png
command -v update-mime-database >/dev/null 2>&1 && $SUDO update-mime-database /usr/local/share/mime
echo "SVGcinema thumbnails removed."
