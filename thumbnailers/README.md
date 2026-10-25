# SVGcinema thumbnails

Small add-ons that show the first frame of `.SVGcinema` projects as their thumbnail in the file
manager. SVGcinema saves that frame in every project as `thumbnail.png`: the zip's first entry,
stored uncompressed, 512 px on its long side. The add-ons only read it.

Downloads (built by `.github/workflows/thumbnailers.yml`, published to the rolling `thumbnails`
release):

- Windows: `SVGcinema-Thumbnails-Setup.exe`
- Linux: `svgcinema-thumbnails.deb` or `svgcinema-thumbnails-linux.tar.gz`

## Windows (`windows/`)

- `svgcinema-thumbs.cpp`: a thumbnail handler (`IThumbnailProvider` + `IInitializeWithStream`).
  It finds `thumbnail.png` (first entry, or through the zip's central directory) and decodes it with
  WIC. Windows runs it in a separate host process, not inside Explorer.
- `build.cmd`: builds it for x64 and ARM64 with MSVC (static runtime).
- `installer.iss`: an Inno Setup installer.
  - Installs for the current user (HKCU), with no administrator rights.
  - Registers the handler for `.svgcinema` and under `SystemFileAssociations`, so it works whatever
    app opens the files.
  - Uninstalls from Settings › Apps.
  - The installer is unsigned, so SmartScreen warns about an unknown publisher.
- `test/harness.cpp`: loads the DLL the way the shell does, asks for a thumbnail and writes it as a PPM.
  It runs under Wine for checks without Windows:
  `x86_64-w64-mingw32-g++` for both, then `wine64 harness.exe svgcinema-thumbs.dll file.SVGcinema 256 out.ppm`.

## Linux (`linux/`)

- `svgcinema-thumbnailer`: copies `thumbnail.png` out of the project. It uses `unzip`, else
  `python3`, else `bsdtar`.
- `svgcinema.thumbnailer`: the freedesktop thumbnailer entry.
- `svgcinema-mime.xml`: the `application/x-svgcinema-project` file type for `*.svgcinema`.
- Works in GNOME Files, Nemo, Caja, Thunar (tumbler) and other file managers that use freedesktop
  thumbnailers. KDE Dolphin uses its own plugins and is not covered.
- `package.sh`: builds the `.deb` (installs under `/usr`) and the `.tar.gz`. The `.tar.gz` contains
  `install.sh` / `uninstall.sh`, which install under `/usr/local` with sudo: file managers run
  thumbnailers in a sandbox that only sees system folders.
