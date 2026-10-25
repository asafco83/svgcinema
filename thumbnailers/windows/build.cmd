@echo off
rem Builds svgcinema-thumbs.dll for x64 and ARM64 with Visual Studio's compiler (static runtime, so
rem no Visual C++ redistributable is needed). Output: build\x64 and build\arm64 next to this file.
setlocal
set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
for /f "usebackq tokens=*" %%i in (`"%VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set "VS=%%i"
if not defined VS (echo Visual Studio with C++ tools not found & exit /b 1)
call :build x64 x64 || exit /b 1
call :build x64_arm64 arm64 || exit /b 1
exit /b 0

:build
setlocal
call "%VS%\VC\Auxiliary\Build\vcvarsall.bat" %1 >nul || exit /b 1
set "OUT=%~dp0build\%2"
if not exist "%OUT%" mkdir "%OUT%"
cl /nologo /O2 /MT /EHsc /W3 /DUNICODE /D_UNICODE /LD "%~dp0svgcinema-thumbs.cpp" /Fo"%OUT%\\" /link /DEF:"%~dp0svgcinema-thumbs.def" /OUT:"%OUT%\svgcinema-thumbs.dll" ole32.lib shlwapi.lib shell32.lib windowscodecs.lib gdi32.lib advapi32.lib user32.lib uuid.lib || exit /b 1
endlocal & exit /b 0
