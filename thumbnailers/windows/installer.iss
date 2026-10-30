; SVGcinema Thumbnails for Windows: shows the first frame of .SVGcinema projects in File Explorer, and gives
; the file type its icon (where no thumbnail shows: lists, details, small icons) and its name.
; Installs for the current user only (no administrator rights), x64 and ARM64. Built by
; .github/workflows/thumbnailers.yml with Inno Setup 6 after build.cmd.
#define AppVersion "1.1.0"
#define Clsid "{{63935DE2-C1BD-42DA-8535-64972BEE12AE}"
#define ThumbExt "{{E357FCCD-A995-4576-B01F-234630154E96}"

[Setup]
AppId={{9B0C7A8E-4F5D-4C1B-9E2A-5D7C3B1A0F64}
AppName=SVGcinema Thumbnails
AppVersion={#AppVersion}
AppPublisher=SVGcinema
AppPublisherURL=https://asafco83.github.io/svgcinema/
DefaultDirName={localappdata}\Programs\SVGcinema Thumbnails
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible arm64
ArchitecturesInstallIn64BitMode=x64compatible arm64
ChangesAssociations=yes
CloseApplications=no
WizardStyle=modern
OutputBaseFilename=SVGcinema-Thumbnails-Setup
UninstallDisplayName=SVGcinema Thumbnails
Compression=lzma2
SolidCompression=yes

[Messages]
WelcomeLabel2=This shows the first frame of your SVGcinema projects (.SVGcinema files) as their thumbnail in File Explorer, and gives them the SVGcinema icon where no thumbnail shows.%n%nIt installs for you only and needs no administrator rights. You can remove it any time in Settings › Apps.

[Files]
Source: "build\x64\svgcinema-thumbs.dll"; DestDir: "{app}"; Check: not IsArm64; Flags: ignoreversion restartreplace uninsrestartdelete
Source: "build\arm64\svgcinema-thumbs.dll"; DestDir: "{app}"; Check: IsArm64; Flags: ignoreversion restartreplace uninsrestartdelete
Source: "svgcinema-file.ico"; DestDir: "{app}"; Flags: ignoreversion

[Registry]
Root: HKCU; Subkey: "Software\Classes\CLSID\{#Clsid}"; ValueType: string; ValueData: "SVGcinema thumbnails"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\CLSID\{#Clsid}\InprocServer32"; ValueType: string; ValueData: "{app}\svgcinema-thumbs.dll"
Root: HKCU; Subkey: "Software\Classes\CLSID\{#Clsid}\InprocServer32"; ValueType: string; ValueName: "ThreadingModel"; ValueData: "Apartment"
Root: HKCU; Subkey: "Software\Classes\.svgcinema\ShellEx\{#ThumbExt}"; ValueType: string; ValueData: "{#Clsid}"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\SystemFileAssociations\.svgcinema\ShellEx\{#ThumbExt}"; ValueType: string; ValueData: "{#Clsid}"; Flags: uninsdeletekey
; the file type: its name in Explorer's Type column and its icon where no thumbnail is shown
Root: HKCU; Subkey: "Software\Classes\SVGcinema.Project"; ValueType: string; ValueData: "SVGcinema project"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\SVGcinema.Project\DefaultIcon"; ValueType: string; ValueData: "{app}\svgcinema-file.ico,0"
Root: HKCU; Subkey: "Software\Classes\.svgcinema"; ValueType: string; ValueData: "SVGcinema.Project"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Classes\.svgcinema\OpenWithProgids"; ValueType: none; ValueName: "SVGcinema.Project"; Flags: uninsdeletevalue
