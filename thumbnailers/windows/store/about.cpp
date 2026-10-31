// SVGcinema Thumbnails (Microsoft Store package): the app the Start menu shows. It says what the package
// does; opened with a .SVGcinema file (the package registers the file type, for its icon and thumbnail),
// it says where to open projects. Built by build.cmd next to svgcinema-thumbs.dll.
#include <windows.h>
#include <shellapi.h>

int WINAPI wWinMain(HINSTANCE, HINSTANCE, PWSTR cmd, int) {
  const bool file = cmd && *cmd;
  const wchar_t *text =
      file ? L"SVGcinema projects open in the SVGcinema editor, in your browser: ☰ › Open….\n\nOpen the editor now?"
           : L"SVGcinema Thumbnails is installed.\n\nIn File Explorer, your SVGcinema projects (.SVGcinema files) now show their "
             L"first frame as their thumbnail, and the SVGcinema icon where no thumbnail shows. There is nothing else to "
             L"do: you can close this window.\n\nOpen the SVGcinema editor?";
  if (MessageBoxW(nullptr, text, L"SVGcinema Thumbnails", MB_YESNO | MB_ICONINFORMATION) == IDYES)
    ShellExecuteW(nullptr, L"open", L"https://www.svgcinema.com/editor/", nullptr, nullptr, SW_SHOWNORMAL);
  return 0;
}
