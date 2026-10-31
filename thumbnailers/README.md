# SVGcinema thumbnails

Small add-ons that show the first frame of `.SVGcinema` projects as their thumbnail in the file
manager. SVGcinema saves that frame in every project as `thumbnail.png`: the zip's first entry,
stored uncompressed, 512 px on its long side. The add-ons only read it. They also give the file type
its icon (where no thumbnail shows: lists, details, small icons) and its name: on Windows the
`SVGcinema.Project` file type with `svgcinema-file.ico`, on Linux the mime type's icon
(`application-x-svgcinema-project`, `linux/icons/` in the hicolor theme). Both are made from
`public/brand/svgcinema-icon.png`.

Downloads (built by `.github/workflows/thumbnailers.yml`, published to the rolling `thumbnails`
release):

- Windows: `SVGcinema-Thumbnails-Setup.zip` (the installer `SVGcinema-Thumbnails-Setup.exe`, zipped
  because many web hosts refuse to serve `.exe` files)
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

## Microsoft Store package (Windows)

`windows/store/` builds the same add-on as an MSIX for the Microsoft Store, so it installs without the
unknown-publisher and download warnings an unsigned installer gets (the Store signs it):

- `AppxManifest.xml`: registers `svgcinema-thumbs.dll` as the `.svgcinema` thumbnail handler (COM, run in a
  surrogate process), the file type with its name and icon, and a small app (`about.cpp`) that says what it
  does, as the Start menu needs one.
- `identity.json`: the package identity. Put Partner Center's values here (your app › Product management ›
  Product identity: Package/Identity/Name, Package/Identity/Publisher, Package/Properties/PublisherDisplayName).
- `pack.ps1`: one MSIX per architecture (x64, ARM64) from `build.cmd`'s output, bundled into
  `SVGcinema-Thumbnails.msixbundle`; `test-install.ps1` signs a copy with a throwaway certificate, installs it,
  checks the registration and removes it (CI).

The Thumbnailers workflow uploads the bundle as the `store` artifact (not to the release): upload it to
Partner Center by hand. Raise the version in `pack.ps1` (`-Version`) for each new submission.
