// Test harness: loads svgcinema-thumbs.dll the way the shell does (DllGetClassObject), gives it a
// file as a stream, asks for a thumbnail of `cx` pixels and writes it as a PPM (with the size on
// stdout). Runs under Wine in CI-less checks:  wine64 harness.exe dll file cx out.ppm
#include <windows.h>
#include <shlwapi.h>
#include <thumbcache.h>
#include <stdio.h>
static const CLSID CLSID_SvgcinemaThumbs = {0x63935de2, 0xc1bd, 0x42da, {0x85, 0x35, 0x64, 0x97, 0x2b, 0xee, 0x12, 0xae}};
typedef HRESULT(WINAPI *GCO)(REFCLSID, REFIID, void **);
int wmain(int argc, wchar_t **argv) {
  if (argc < 5) return 2;
  CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
  HMODULE m = LoadLibraryW(argv[1]);
  if (!m) { printf("load failed\n"); return 3; }
  GCO gco = (GCO)GetProcAddress(m, "DllGetClassObject");
  IClassFactory *cf = nullptr;
  if (FAILED(gco(CLSID_SvgcinemaThumbs, IID_IClassFactory, (void **)&cf))) { printf("factory failed\n"); return 4; }
  IInitializeWithStream *init = nullptr;
  if (FAILED(cf->CreateInstance(nullptr, __uuidof(IInitializeWithStream), (void **)&init))) { printf("instance failed\n"); return 5; }
  IStream *s = nullptr;
  if (FAILED(SHCreateStreamOnFileEx(argv[2], STGM_READ, 0, FALSE, nullptr, &s))) { printf("open failed\n"); return 6; }
  init->Initialize(s, STGM_READ);
  IThumbnailProvider *tp = nullptr;
  init->QueryInterface(__uuidof(IThumbnailProvider), (void **)&tp);
  HBITMAP bmp = nullptr;
  WTS_ALPHATYPE a;
  HRESULT hr = tp->GetThumbnail((UINT)_wtoi(argv[3]), &bmp, &a);
  if (FAILED(hr) || !bmp) { printf("NO THUMBNAIL hr=%08lx\n", hr); return 0; }
  DIBSECTION ds;
  GetObject(bmp, sizeof(ds), &ds);
  int w = ds.dsBm.bmWidth, h = ds.dsBm.bmHeight;
  printf("THUMBNAIL %dx%d alpha=%d\n", w, h, (int)a);
  FILE *f = _wfopen(argv[4], L"wb");
  fprintf(f, "P6\n%d %d\n255\n", w, h);
  BYTE *px = (BYTE *)ds.dsBm.bmBits;
  for (int y = 0; y < h; y++)
    for (int x = 0; x < w; x++) {
      BYTE *p = px + y * ds.dsBm.bmWidthBytes + x * 4;
      fputc(p[2], f); fputc(p[1], f); fputc(p[0], f);
    }
  fclose(f);
  return 0;
}
