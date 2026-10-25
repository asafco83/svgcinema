// SVGcinema thumbnails for Windows Explorer.
//
// A thumbnail handler (IThumbnailProvider) for .SVGcinema project files. A project file is a zip;
// SVGcinema writes the first frame of the animation as `thumbnail.png`, the zip's first entry, stored
// uncompressed. This handler reads that picture straight from the file (no unpacking) and hands it
// to Explorer. Windows runs thumbnail handlers outside Explorer (in a separate host process), so a
// damaged file can't take Explorer down.
//
// Registration is per user (HKEY_CURRENT_USER), done by the installer; DllRegisterServer does the
// same for development (regsvr32 svgcinema-thumbs.dll).
#include <windows.h>
#include <shlobj.h>
#include <shlwapi.h>
#include <thumbcache.h>
#include <wincodec.h>
#include <new>
#include <vector>

// {63935DE2-C1BD-42DA-8535-64972BEE12AE}
static const CLSID CLSID_SvgcinemaThumbs = {0x63935de2, 0xc1bd, 0x42da, {0x85, 0x35, 0x64, 0x97, 0x2b, 0xee, 0x12, 0xae}};
static const wchar_t *CLSID_STR = L"{63935DE2-C1BD-42DA-8535-64972BEE12AE}";
// the shell's thumbnail handler category
static const wchar_t *THUMB_SHELLEX = L"{E357FCCD-A995-4576-B01F-234630154E96}";

static long g_refs = 0;
static HMODULE g_module = nullptr;

// ---------------------------------------------------------------------------------------- zip reading

static const char THUMB_NAME[] = "thumbnail.png";
static const ULONG THUMB_NAME_LEN = sizeof(THUMB_NAME) - 1;
static const ULONG MAX_THUMB = 16 * 1024 * 1024;

static UINT16 u16(const BYTE *p) { return (UINT16)(p[0] | (p[1] << 8)); }
static UINT32 u32(const BYTE *p) { return (UINT32)p[0] | ((UINT32)p[1] << 8) | ((UINT32)p[2] << 16) | ((UINT32)p[3] << 24); }

static HRESULT seekTo(IStream *s, ULONGLONG pos) {
  LARGE_INTEGER li;
  li.QuadPart = (LONGLONG)pos;
  return s->Seek(li, STREAM_SEEK_SET, nullptr);
}
static bool readAt(IStream *s, ULONGLONG pos, BYTE *buf, ULONG n) {
  if (FAILED(seekTo(s, pos))) return false;
  ULONG got = 0;
  while (got < n) {
    ULONG r = 0;
    HRESULT hr = s->Read(buf + got, n - got, &r);
    if (FAILED(hr) || r == 0) return false;
    got += r;
  }
  return true;
}
// the stored (uncompressed) data of the entry whose local header is at `lho`
static bool readEntry(IStream *s, ULONGLONG lho, UINT32 size, std::vector<BYTE> &out) {
  BYTE lh[30];
  if (!readAt(s, lho, lh, 30) || u32(lh) != 0x04034b50) return false;
  if (size == 0 || size > MAX_THUMB) return false;
  out.resize(size);
  return readAt(s, lho + 30 + u16(lh + 26) + u16(lh + 28), out.data(), size);
}
// thumbnail.png: first the quick way (the first entry), then through the zip's central directory
static bool findThumbnail(IStream *s, std::vector<BYTE> &out) {
  BYTE lh[30 + THUMB_NAME_LEN];
  if (readAt(s, 0, lh, sizeof(lh)) && u32(lh) == 0x04034b50 && u16(lh + 8) == 0 && !(u16(lh + 6) & 8) &&
      u16(lh + 26) == THUMB_NAME_LEN && memcmp(lh + 30, THUMB_NAME, THUMB_NAME_LEN) == 0)
    return readEntry(s, 0, u32(lh + 18), out);
  STATSTG st = {};
  if (FAILED(s->Stat(&st, STATFLAG_NONAME))) return false;
  ULONGLONG len = st.cbSize.QuadPart;
  if (len < 22) return false;
  ULONG tail = (ULONG)(len < 22 + 65535 ? len : 22 + 65535);
  std::vector<BYTE> t(tail);
  if (!readAt(s, len - tail, t.data(), tail)) return false;
  for (LONG i = (LONG)tail - 22; i >= 0; i--) {
    if (u32(&t[i]) != 0x06054b50) continue;
    UINT16 n = u16(&t[i + 10]);
    UINT32 cdSize = u32(&t[i + 12]), cdOff = u32(&t[i + 16]);
    if ((ULONGLONG)cdOff + cdSize > len || cdSize > 64 * 1024 * 1024) return false;
    std::vector<BYTE> cd(cdSize);
    if (!readAt(s, cdOff, cd.data(), cdSize)) return false;
    ULONG p = 0;
    for (UINT16 k = 0; k < n && p + 46 <= cdSize; k++) {
      if (u32(&cd[p]) != 0x02014b50) return false;
      UINT16 method = u16(&cd[p + 10]), nl = u16(&cd[p + 28]), xl = u16(&cd[p + 30]), cl = u16(&cd[p + 32]);
      UINT32 csz = u32(&cd[p + 20]), lho = u32(&cd[p + 42]);
      if (p + 46 + nl > cdSize) return false;
      if (method == 0 && nl == THUMB_NAME_LEN && memcmp(&cd[p + 46], THUMB_NAME, THUMB_NAME_LEN) == 0)
        return readEntry(s, lho, csz, out);
      p += 46 + nl + xl + cl;
    }
    return false;
  }
  return false;
}

// ---------------------------------------------------------------------------------------- PNG → bitmap

template <class T> static void release(T *&p) {
  if (p) {
    p->Release();
    p = nullptr;
  }
}
static HRESULT pngToBitmap(const std::vector<BYTE> &png, UINT cx, HBITMAP *phbmp) {
  IWICImagingFactory *f = nullptr;
  IStream *mem = nullptr;
  IWICBitmapDecoder *dec = nullptr;
  IWICBitmapFrameDecode *fr = nullptr;
  IWICBitmapScaler *sc = nullptr;
  IWICFormatConverter *conv = nullptr;
  HRESULT hr = CoCreateInstance(CLSID_WICImagingFactory, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&f));
  if (SUCCEEDED(hr)) {
    mem = SHCreateMemStream(png.data(), (UINT)png.size());
    hr = mem ? S_OK : E_OUTOFMEMORY;
  }
  if (SUCCEEDED(hr)) hr = f->CreateDecoderFromStream(mem, nullptr, WICDecodeMetadataCacheOnDemand, &dec);
  if (SUCCEEDED(hr)) hr = dec->GetFrame(0, &fr);
  UINT w = 0, h = 0;
  if (SUCCEEDED(hr)) hr = fr->GetSize(&w, &h);
  if (SUCCEEDED(hr) && (w == 0 || h == 0)) hr = E_FAIL;
  IWICBitmapSource *src = fr;
  if (SUCCEEDED(hr) && cx > 0 && (w > cx || h > cx)) {
    // fit inside cx × cx (Explorer asks for a square; the picture keeps its proportions)
    double k = (double)cx / (w > h ? w : h);
    UINT tw = (UINT)(w * k + 0.5), th = (UINT)(h * k + 0.5);
    if (tw < 1) tw = 1;
    if (th < 1) th = 1;
    hr = f->CreateBitmapScaler(&sc);
    if (SUCCEEDED(hr)) hr = sc->Initialize(fr, tw, th, WICBitmapInterpolationModeFant);
    if (SUCCEEDED(hr)) {
      src = sc;
      w = tw;
      h = th;
    }
  }
  if (SUCCEEDED(hr)) hr = f->CreateFormatConverter(&conv);
  if (SUCCEEDED(hr))
    hr = conv->Initialize(src, GUID_WICPixelFormat32bppBGRA, WICBitmapDitherTypeNone, nullptr, 0.0, WICBitmapPaletteTypeCustom);
  if (SUCCEEDED(hr)) {
    BITMAPINFO bmi = {};
    bmi.bmiHeader.biSize = sizeof(bmi.bmiHeader);
    bmi.bmiHeader.biWidth = (LONG)w;
    bmi.bmiHeader.biHeight = -(LONG)h;  // top-down
    bmi.bmiHeader.biPlanes = 1;
    bmi.bmiHeader.biBitCount = 32;
    bmi.bmiHeader.biCompression = BI_RGB;
    void *bits = nullptr;
    HBITMAP bmp = CreateDIBSection(nullptr, &bmi, DIB_RGB_COLORS, &bits, nullptr, 0);
    hr = bmp ? S_OK : E_OUTOFMEMORY;
    if (SUCCEEDED(hr)) {
      hr = conv->CopyPixels(nullptr, w * 4, w * 4 * h, (BYTE *)bits);
      if (SUCCEEDED(hr)) *phbmp = bmp;
      else DeleteObject(bmp);
    }
  }
  release(conv);
  release(sc);
  release(fr);
  release(dec);
  release(mem);
  release(f);
  return hr;
}

// ---------------------------------------------------------------------------------------- the handler

class ThumbProvider : public IInitializeWithStream, public IThumbnailProvider {
  long refs = 1;
  IStream *stream = nullptr;

 public:
  ThumbProvider() { InterlockedIncrement(&g_refs); }
  virtual ~ThumbProvider() {
    release(stream);
    InterlockedDecrement(&g_refs);
  }
  IFACEMETHODIMP QueryInterface(REFIID riid, void **ppv) {
    static const QITAB qit[] = {
        QITABENT(ThumbProvider, IInitializeWithStream),
        QITABENT(ThumbProvider, IThumbnailProvider),
        {0, 0},
    };
    return QISearch(this, qit, riid, ppv);
  }
  IFACEMETHODIMP_(ULONG) AddRef() { return InterlockedIncrement(&refs); }
  IFACEMETHODIMP_(ULONG) Release() {
    long r = InterlockedDecrement(&refs);
    if (!r) delete this;
    return r;
  }
  IFACEMETHODIMP Initialize(IStream *s, DWORD) {
    if (stream) return HRESULT_FROM_WIN32(ERROR_ALREADY_INITIALIZED);
    if (!s) return E_INVALIDARG;
    stream = s;
    stream->AddRef();
    return S_OK;
  }
  IFACEMETHODIMP GetThumbnail(UINT cx, HBITMAP *phbmp, WTS_ALPHATYPE *pdwAlpha) {
    if (!phbmp || !pdwAlpha) return E_POINTER;
    *phbmp = nullptr;
    *pdwAlpha = WTSAT_ARGB;
    if (!stream) return E_UNEXPECTED;
    std::vector<BYTE> png;
    if (!findThumbnail(stream, png)) return E_FAIL;  // no picture: Explorer shows the file's icon
    return pngToBitmap(png, cx, phbmp);
  }
};

class Factory : public IClassFactory {
 public:
  IFACEMETHODIMP QueryInterface(REFIID riid, void **ppv) {
    static const QITAB qit[] = {QITABENT(Factory, IClassFactory), {0, 0}};
    return QISearch(this, qit, riid, ppv);
  }
  IFACEMETHODIMP_(ULONG) AddRef() { return 2; }
  IFACEMETHODIMP_(ULONG) Release() { return 1; }
  IFACEMETHODIMP CreateInstance(IUnknown *outer, REFIID riid, void **ppv) {
    *ppv = nullptr;
    if (outer) return CLASS_E_NOAGGREGATION;
    ThumbProvider *p = new (std::nothrow) ThumbProvider();
    if (!p) return E_OUTOFMEMORY;
    HRESULT hr = p->QueryInterface(riid, ppv);
    p->Release();
    return hr;
  }
  IFACEMETHODIMP LockServer(BOOL lock) {
    if (lock) InterlockedIncrement(&g_refs);
    else InterlockedDecrement(&g_refs);
    return S_OK;
  }
};
static Factory g_factory;

// ---------------------------------------------------------------------------------------- DLL exports

BOOL APIENTRY DllMain(HMODULE m, DWORD reason, LPVOID) {
  if (reason == DLL_PROCESS_ATTACH) {
    g_module = m;
    DisableThreadLibraryCalls(m);
  }
  return TRUE;
}
STDAPI DllGetClassObject(REFCLSID clsid, REFIID riid, void **ppv) {
  if (!ppv) return E_POINTER;
  *ppv = nullptr;
  if (!IsEqualCLSID(clsid, CLSID_SvgcinemaThumbs)) return CLASS_E_CLASSNOTAVAILABLE;
  return g_factory.QueryInterface(riid, ppv);
}
STDAPI DllCanUnloadNow() { return g_refs == 0 ? S_OK : S_FALSE; }

static HRESULT setValue(const wchar_t *key, const wchar_t *name, const wchar_t *value) {
  LSTATUS r = RegSetKeyValueW(HKEY_CURRENT_USER, key, name, REG_SZ, value, (DWORD)((wcslen(value) + 1) * sizeof(wchar_t)));
  return HRESULT_FROM_WIN32(r);
}
STDAPI DllRegisterServer() {
  wchar_t path[MAX_PATH];
  if (!GetModuleFileNameW(g_module, path, MAX_PATH)) return HRESULT_FROM_WIN32(GetLastError());
  wchar_t k[256];
  wsprintfW(k, L"Software\\Classes\\CLSID\\%s", CLSID_STR);
  HRESULT hr = setValue(k, nullptr, L"SVGcinema thumbnails");
  wsprintfW(k, L"Software\\Classes\\CLSID\\%s\\InprocServer32", CLSID_STR);
  if (SUCCEEDED(hr)) hr = setValue(k, nullptr, path);
  if (SUCCEEDED(hr)) hr = setValue(k, L"ThreadingModel", L"Apartment");
  wsprintfW(k, L"Software\\Classes\\.svgcinema\\ShellEx\\%s", THUMB_SHELLEX);
  if (SUCCEEDED(hr)) hr = setValue(k, nullptr, CLSID_STR);
  wsprintfW(k, L"Software\\Classes\\SystemFileAssociations\\.svgcinema\\ShellEx\\%s", THUMB_SHELLEX);
  if (SUCCEEDED(hr)) hr = setValue(k, nullptr, CLSID_STR);
  if (SUCCEEDED(hr)) SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, nullptr, nullptr);
  return hr;
}
STDAPI DllUnregisterServer() {
  wchar_t k[256];
  wsprintfW(k, L"Software\\Classes\\CLSID\\%s", CLSID_STR);
  RegDeleteTreeW(HKEY_CURRENT_USER, k);
  wsprintfW(k, L"Software\\Classes\\.svgcinema\\ShellEx\\%s", THUMB_SHELLEX);
  RegDeleteTreeW(HKEY_CURRENT_USER, k);
  wsprintfW(k, L"Software\\Classes\\SystemFileAssociations\\.svgcinema\\ShellEx\\%s", THUMB_SHELLEX);
  RegDeleteTreeW(HKEY_CURRENT_USER, k);
  SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, nullptr, nullptr);
  return S_OK;
}
