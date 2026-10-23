; Installateur Windows de CUT THE FLOW (Inno Setup).
;
; Compilé par la CI :
;   iscc /DStudioVersion=2.6.2 /DEngineVersion=0.9.1 /DSourceExe=... ^
;        /DOutputDir=... /DIconFile=... /DReadmeFile=... /DLicenseFile=... installer.iss

#ifndef StudioVersion
  #define StudioVersion "0.0.0"
#endif
#ifndef EngineVersion
  #define EngineVersion "0.0.0"
#endif
#ifndef SourceExe
  #error SourceExe est obligatoire
#endif
#ifndef SourceDir
  #define SourceDir "."
#endif
#ifndef OutputDir
  #define OutputDir "."
#endif
#ifndef IconFile
  #define IconFile ""
#endif
#ifndef ReadmeFile
  #define ReadmeFile ""
#endif
#ifndef LicenseFile
  #define LicenseFile ""
#endif

[Setup]
AppId={{8E1C2C7A-5E4B-4C31-9F6D-3A5C0B7E2D41}
AppName=CUT THE FLOW
AppVersion={#StudioVersion}
AppVerName=CUT THE FLOW {#StudioVersion} (moteur {#EngineVersion})
AppPublisher=Zigmoon
AppPublisherURL=https://github.com/zigmoon/cuttheflow
AppSupportURL=https://github.com/zigmoon/cuttheflow/issues
AppUpdatesURL=https://github.com/zigmoon/cuttheflow/releases/latest
DefaultDirName={autopf}\CUT THE FLOW
DefaultGroupName=CUT THE FLOW
DisableProgramGroupPage=yes
OutputDir={#OutputDir}
OutputBaseFilename=CUTTHEFLOW-windows-x86_64-setup
SetupIconFile={#IconFile}
UninstallDisplayIcon={app}\cuttheflow.exe
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequiredOverridesAllowed=dialog
MinVersion=10.0

[Languages]
Name: "french"; MessagesFile: "compiler:Languages\French.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "{#SourceExe}"; DestDir: "{app}"; DestName: "cuttheflow.exe"; Flags: ignoreversion
Source: "{#SourceDir}\*.dll"; DestDir: "{app}"; Flags: ignoreversion skipifsourcedoesntexist
Source: "{#ReadmeFile}"; DestDir: "{app}"; DestName: "LISEZ-MOI.txt"; Flags: ignoreversion skipifsourcedoesntexist
Source: "{#LicenseFile}"; DestDir: "{app}"; DestName: "LICENSE"; Flags: ignoreversion skipifsourcedoesntexist

[Icons]
Name: "{group}\CUT THE FLOW"; Filename: "{app}\cuttheflow.exe"; Comment: "Studio de montage"
Name: "{group}\Lisez-moi"; Filename: "{app}\LISEZ-MOI.txt"
Name: "{group}\{cm:UninstallProgram,CUT THE FLOW}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\CUT THE FLOW"; Filename: "{app}\cuttheflow.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\cuttheflow.exe"; Description: "{cm:LaunchProgram,CUT THE FLOW}"; Flags: nowait postinstall skipifsilent