; Vanity web installer: a tiny .exe that always installs the newest Vanity.
; It reads latest.yml from the newest GitHub Release (the same file the in-app updater uses),
; downloads the setup that file names, and runs it. Build with scripts/build-web-installer.mjs.

Unicode true
SetCompressor /SOLID lzma
RequestExecutionLevel user
ManifestDPIAware true

!ifndef BASE_URL
  !define BASE_URL "https://github.com/NoVanity99/Vanity/releases/latest/download"
!endif
!define RELEASES_PAGE "https://github.com/NoVanity99/Vanity/releases/latest"

Name "Vanity"
Caption "Vanity Installer"
OutFile "${OUT_FILE}"
Icon "..\resources\icon.ico"
BrandingText "Vanity"
ShowInstDetails nevershow
InstallColors /windows
XPStyle on

VIProductVersion "1.0.0.0"
VIAddVersionKey "ProductName" "Vanity"
VIAddVersionKey "FileDescription" "Vanity Installer"
VIAddVersionKey "CompanyName" "NoVanity99"
VIAddVersionKey "LegalCopyright" "Copyright © 2026 NoVanity99"
VIAddVersionKey "FileVersion" "1.0.0.0"
VIAddVersionKey "ProductVersion" "1.0.0.0"

!include "LogicLib.nsh"
!include "FileFunc.nsh"

Page instfiles

Var SetupName
Var Version
Var SetupPath

; Removes trailing CR, LF, spaces and quotes from $0.
Function TrimEnd
  loop:
    StrCpy $1 $0 1 -1
    ${If} $1 == "$\r"
    ${OrIf} $1 == "$\n"
    ${OrIf} $1 == " "
    ${OrIf} $1 == "'"
    ${OrIf} $1 == '"'
      StrCpy $0 $0 -1
      Goto loop
    ${EndIf}
FunctionEnd

Function Fail
  ; $0 = what went wrong
  MessageBox MB_ICONEXCLAMATION|MB_YESNO "Vanity couldn't be downloaded.$\r$\n$\r$\n$0$\r$\n$\r$\nCheck your internet connection and try again.$\r$\nOpen the download page in your browser instead?" /SD IDNO IDNO +2
    ExecShell "open" "${RELEASES_PAGE}"
  Quit
FunctionEnd

Section
  InitPluginsDir
  DetailPrint "Looking for the latest version of Vanity..."
  inetc::get /SILENT /NOCANCEL /USERAGENT "VanityInstaller" "${BASE_URL}/latest.yml" "$PLUGINSDIR\latest.yml" /END
  Pop $0
  ${If} $0 != "OK"
    StrCpy $0 "Couldn't reach GitHub ($0)."
    Call Fail
  ${EndIf}

  ; latest.yml has "version: 1.2.3" and "path: Vanity-Setup-1.2.3.exe".
  StrCpy $SetupName ""
  StrCpy $Version ""
  FileOpen $2 "$PLUGINSDIR\latest.yml" r
  ${DoUntil} ${Errors}
    FileRead $2 $0
    ${If} ${Errors}
      ${ExitDo}
    ${EndIf}
    StrCpy $1 $0 6
    ${If} $1 == "path: "
      StrCpy $0 $0 "" 6
      Call TrimEnd
      StrCpy $SetupName $0
    ${EndIf}
    StrCpy $1 $0 9
    ${If} $1 == "version: "
      StrCpy $0 $0 "" 9
      Call TrimEnd
      StrCpy $Version $0
    ${EndIf}
  ${Loop}
  FileClose $2
  ClearErrors

  ; Only ever run a plainly named setup from the release (no folders or odd characters).
  StrCpy $1 $SetupName 13
  StrCpy $3 $SetupName "" -4
  ${If} $SetupName == ""
  ${OrIf} $1 != "Vanity-Setup-"
  ${OrIf} $3 != ".exe"
    StrCpy $0 "The latest release has no installer yet."
    Call Fail
  ${EndIf}

  CreateDirectory "$TEMP\VanityInstaller"
  StrCpy $SetupPath "$TEMP\VanityInstaller\$SetupName"
  Delete "$SetupPath"
  DetailPrint "Downloading Vanity $Version..."
  inetc::get /NOCANCEL /USERAGENT "VanityInstaller" /CAPTION "Vanity Installer" /BANNER "Downloading Vanity $Version..." "${BASE_URL}/$SetupName" "$SetupPath" /END
  Pop $0
  ${If} $0 != "OK"
    Delete "$SetupPath"
    StrCpy $0 "The download didn't finish ($0)."
    Call Fail
  ${EndIf}

  ; A real setup is over 50 MB: anything tiny is an error page, not the installer.
  ${GetSize} "$TEMP\VanityInstaller" "/M=$SetupName /S=0K /G=0" $4 $5 $6
  ${If} $4 < 1024
    Delete "$SetupPath"
    StrCpy $0 "The download was incomplete."
    Call Fail
  ${EndIf}

  ; Hand over to the real installer, then tidy up.
  HideWindow
  ExecWait '"$SetupPath"'
  Delete "$SetupPath"
  RMDir "$TEMP\VanityInstaller"
  SetAutoClose true
SectionEnd
