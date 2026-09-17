; TRAE SOLO CN Enhancer - Windows 安装包配置
;
; 由 scripts/win/build-installer.js 编译。所有路径都由构建脚本以 /D 传入，
; 本文件不假设任何机器相关的目录。
;
; 设计要点：
;   - PrivilegesRequired=lowest，免管理员，装在 %LOCALAPPDATA%\Programs 下；
;   - 不禁用目录页，用户可自选安装位置；
;   - 自定义页紧跟在目录页之后，让用户确认 TRAE SOLO CN 主程序位置；
;   - 检测在 Pascal 内用注册表与文件存在性完成，不解析子进程输出：
;     子进程 stdout 是 UTF-8，而安装程序按系统 ANSI 解码，中文路径会损坏；
;   - 保存用户选择时把路径作为**命令行参数**传给 TraeEnhancer.exe configure，
;     命令行是 Unicode，不存在解码问题。

#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#ifndef StageRoot
  #error StageRoot must be supplied by the build script
#endif
#ifndef OutputDir
  #error OutputDir must be supplied by the build script
#endif
#ifndef OutputBaseFilename
  #define OutputBaseFilename "TraeEnhancer-Setup"
#endif

#define ProductName "TRAE SOLO CN Enhancer"
#define ProductExe "TraeEnhancer.exe"

[Setup]
AppId={{8F1C3E7A-2B54-4D9E-9C31-6A0F5B7D2E84}
AppName={#ProductName}
AppVersion={#AppVersion}
AppVerName={#ProductName} {#AppVersion}
AppPublisher={#ProductName}
DefaultDirName={localappdata}\Programs\{#ProductName}
DefaultGroupName={#ProductName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
UsePreviousAppDir=yes
UsePreviousTasks=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
WizardStyle=modern
Compression=lzma2/max
SolidCompression=yes
OutputDir={#OutputDir}
OutputBaseFilename={#OutputBaseFilename}-{#AppVersion}
SetupLogging=yes
CloseApplications=no
RestartApplications=no
RestartIfNeededByRun=no
MinVersion=10.0
UninstallDisplayName={#ProductName} {#AppVersion}
UninstallDisplayIcon={app}\{#ProductExe}

[Languages]
Name: "chinesesimplified"; MessagesFile: "ChineseSimplified.isl"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "附加选项："
Name: "autostart"; Description: "登录时自动启动后台服务（用于定时签到与保活）"; GroupDescription: "附加选项："

[Files]
Source: "{#StageRoot}\{#ProductExe}"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#StageRoot}\README.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#StageRoot}\scripts\trae-enhancer.cmd"; DestDir: "{app}\scripts"; Flags: ignoreversion
Source: "{#StageRoot}\scripts\tray.ps1"; DestDir: "{app}\scripts"; Flags: ignoreversion
Source: "{#StageRoot}\scripts\launch-hidden.vbs"; DestDir: "{app}\scripts"; Flags: ignoreversion

[Icons]
; 两个启动项都指向隐藏启动器，而不是可执行文件：可执行文件是控制台子系统程序，
; 直接启动必定弹出黑窗口。停止项保留控制台是刻意的——用户点了停止，应当看到结果。
Name: "{group}\{#ProductName}"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\scripts\launch-hidden.vbs"""; WorkingDir: "{app}"; Comment: "启动 TRAE SOLO CN 与增强面板"
Name: "{group}\停止后台服务"; Filename: "{app}\{#ProductExe}"; Parameters: "stop"; WorkingDir: "{app}"
Name: "{userdesktop}\{#ProductName}"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\scripts\launch-hidden.vbs"""; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{sys}\wscript.exe"; Parameters: """{app}\scripts\launch-hidden.vbs"""; WorkingDir: "{app}"; Description: "立即启动 TRAE SOLO CN 与增强面板"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{app}\{#ProductExe}"; Parameters: "tray-stop"; WorkingDir: "{app}"; Flags: runhidden waituntilterminated; RunOnceId: "StopTray"
Filename: "{app}\{#ProductExe}"; Parameters: "stop"; WorkingDir: "{app}"; Flags: runhidden waituntilterminated; RunOnceId: "StopService"
Filename: "{app}\{#ProductExe}"; Parameters: "uninstall"; WorkingDir: "{app}"; Flags: runhidden waituntilterminated; RunOnceId: "RemoveAutostart"

[UninstallDelete]
; 只清日志。data 目录（账号备份 + 配置 + api-token）是否删除由用户在卸载时决定，
; 见 CurUninstallStepChanged，因为那里含登录凭据，删掉不可恢复。
Type: filesandordirs; Name: "{app}\logs"

[Code]
const
  TraeExeName = 'TRAE SOLO CN.exe';
  ProductMarker = 'TRAE SOLO CN';

var
  TraePage: TInputFileWizardPage;
  TraeSourceLabel: TNewStaticText;
  TraeStatusLabel: TNewStaticText;
  UseDetectedButton: TNewButton;
  DetectedTraePath: String;
  SavedTraePath: String;
  KeepUserData: Boolean;

function ReadSavedTraePath(): String;
var
  Value: String;
begin
  Result := '';
  if RegQueryStringValue(HKCU, 'Software\TraeSoloCnEnhancer', 'TraeExe', Value) then
    Result := Value;
end;

function SaveTraePath(const Path: String): Boolean;
begin
  Result := RegWriteStringValue(HKCU, 'Software\TraeSoloCnEnhancer', 'TraeExe', Path);
end;

function MatchesProductExeName(const Path: String): Boolean;
begin
  Result := (CompareText(ExtractFileName(Path), TraeExeName) = 0);
end;

function CandidateFromDisplayIcon(const DisplayIcon: String): String;
var
  Value: String;
  Cut: Integer;
begin
  Result := '';
  Value := Trim(DisplayIcon);
  if Value = '' then Exit;
  if Value[1] = '"' then
  begin
    Value := Copy(Value, 2, Length(Value));
    Cut := Pos('"', Value);
    if Cut > 0 then Value := Copy(Value, 1, Cut - 1);
  end
  else
  begin
    Cut := Pos(',', Value);
    if Cut > 0 then Value := Copy(Value, 1, Cut - 1);
  end;
  Value := Trim(Value);
  if MatchesProductExeName(Value) then Result := Value;
end;

{ 只接受 DisplayName 明确含 TRAE SOLO CN 的项；宽松匹配 "TRAE" 会命中
  另一个产品 "Trae CN"（AI IDE），那会导致后续所有重启 TRAE 的流程失败。 }
function ConsiderUninstallKey(const RootKey: Integer; const SubKey: String; var Found: String): Boolean;
var
  DisplayName: String;
  DisplayIcon: String;
  InstallLocation: String;
  Candidate: String;
begin
  Result := False;
  if not RegQueryStringValue(RootKey, SubKey, 'DisplayName', DisplayName) then Exit;
  if Pos(ProductMarker, Uppercase(DisplayName)) = 0 then Exit;

  if RegQueryStringValue(RootKey, SubKey, 'DisplayIcon', DisplayIcon) then
  begin
    Candidate := CandidateFromDisplayIcon(DisplayIcon);
    if (Candidate <> '') and FileExists(Candidate) then
    begin
      Found := Candidate;
      Result := True;
      Exit;
    end;
  end;

  if RegQueryStringValue(RootKey, SubKey, 'InstallLocation', InstallLocation) then
  begin
    Candidate := AddBackslash(Trim(InstallLocation)) + TraeExeName;
    if FileExists(Candidate) then
    begin
      Found := Candidate;
      Result := True;
    end;
  end;
end;

function DetectFromRegistry(): String;
var
  Roots: array[0..2] of Integer;
  BaseKeys: array[0..2] of String;
  Names: TArrayOfString;
  Index: Integer;
  Name: Integer;
  FullKey: String;
  Found: String;
begin
  Result := '';
  Roots[0] := HKLM; BaseKeys[0] := 'SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall';
  Roots[1] := HKLM; BaseKeys[1] := 'SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall';
  Roots[2] := HKCU; BaseKeys[2] := 'SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall';

  for Index := 0 to 2 do
  begin
    if RegGetSubkeyNames(Roots[Index], BaseKeys[Index], Names) then
    begin
      for Name := 0 to GetArrayLength(Names) - 1 do
      begin
        FullKey := BaseKeys[Index] + '\' + Names[Name];
        if ConsiderUninstallKey(Roots[Index], FullKey, Found) then
        begin
          Result := Found;
          Exit;
        end;
      end;
    end;
  end;
end;

function DetectFromCandidates(): String;
var
  Candidates: array[0..7] of String;
  Index: Integer;
begin
  Result := '';
  Candidates[0] := ExpandConstant('{localappdata}\Programs\TRAE SOLO CN\') + TraeExeName;
  Candidates[1] := ExpandConstant('{localappdata}\TRAE SOLO CN\') + TraeExeName;
  Candidates[2] := ExpandConstant('{localappdata}\Programs\') + TraeExeName;
  Candidates[3] := ExpandConstant('{commonpf}\TRAE SOLO CN\') + TraeExeName;
  Candidates[4] := ExpandConstant('{commonpf}\') + TraeExeName;
  Candidates[5] := ExpandConstant('{commonpf32}\TRAE SOLO CN\') + TraeExeName;
  Candidates[6] := ExpandConstant('{commonpf32}\') + TraeExeName;
  Candidates[7] := ExpandConstant('{userappdata}\TRAE SOLO CN\') + TraeExeName;
  for Index := 0 to 7 do
  begin
    if FileExists(Candidates[Index]) then
    begin
      Result := Candidates[Index];
      Exit;
    end;
  end;
end;

function DescribeSource(const Path: String): String;
begin
  if Path = '' then
    Result := '未自动找到 TRAE SOLO CN，请点击“浏览”手动选择主程序。'
  else
    Result := '已自动检测到 TRAE SOLO CN，可直接继续；如果不对请点击“浏览”修改。';
end;

procedure UpdateTraeStatus();
var
  Candidate: String;
begin
  Candidate := Trim(TraePage.Values[0]);
  if Candidate = '' then
    TraeStatusLabel.Caption := '尚未选择主程序。'
  else if not FileExists(Candidate) then
    TraeStatusLabel.Caption := '未找到这个文件，请重新选择。'
  else if not MatchesProductExeName(Candidate) then
    TraeStatusLabel.Caption := '文件名必须是 TRAE SOLO CN.exe，请重新选择。'
  else
    TraeStatusLabel.Caption := '路径有效。';
end;

procedure TraePathChanged(Sender: TObject);
begin
  UpdateTraeStatus();
end;

procedure UseDetectedTrae(Sender: TObject);
begin
  TraePage.Values[0] := DetectedTraePath;
  TraeSourceLabel.Caption := DescribeSource(DetectedTraePath);
  UpdateTraeStatus();
end;

function ValidateTraeSelection(): Boolean;
var
  Candidate: String;
begin
  Candidate := Trim(TraePage.Values[0]);
  Result := (Candidate <> '') and FileExists(Candidate) and
    (CompareText(ExtractFileExt(Candidate), '.exe') = 0) and
    MatchesProductExeName(Candidate);
  if not Result then
    MsgBox('请选择名为 TRAE SOLO CN.exe 的主程序。', mbError, MB_OK);
end;

procedure InitializeWizard();
begin
  TraePage := CreateInputFilePage(
    wpSelectDir,
    'TRAE SOLO CN 位置',
    '确认 TRAE SOLO CN 主程序的位置',
    '安装程序会自动检测，检测不到或位置不对时请点击“浏览”手动选择。'
  );
  TraePage.Add(
    '主程序：',
    '可执行文件 (*.exe)|*.exe|所有文件 (*.*)|*.*',
    '.exe'
  );

  TraeSourceLabel := TNewStaticText.Create(TraePage);
  TraeSourceLabel.Parent := TraePage.Surface;
  TraeSourceLabel.Left := 0;
  TraeSourceLabel.Top := TraePage.Edits[0].Top + TraePage.Edits[0].Height + ScaleY(12);
  TraeSourceLabel.Width := TraePage.SurfaceWidth;
  TraeSourceLabel.Height := ScaleY(18);
  TraeSourceLabel.AutoSize := False;

  TraeStatusLabel := TNewStaticText.Create(TraePage);
  TraeStatusLabel.Parent := TraePage.Surface;
  TraeStatusLabel.Left := 0;
  TraeStatusLabel.Top := TraeSourceLabel.Top + ScaleY(22);
  TraeStatusLabel.Width := TraePage.SurfaceWidth;
  TraeStatusLabel.Height := ScaleY(18);
  TraeStatusLabel.AutoSize := False;

  UseDetectedButton := TNewButton.Create(TraePage);
  UseDetectedButton.Parent := TraePage.Surface;
  UseDetectedButton.Left := 0;
  UseDetectedButton.Top := TraeStatusLabel.Top + ScaleY(26);
  UseDetectedButton.Width := ScaleX(150);
  UseDetectedButton.Height := ScaleY(26);
  UseDetectedButton.Caption := '使用自动检测的路径';
  UseDetectedButton.OnClick := @UseDetectedTrae;

  SavedTraePath := ReadSavedTraePath();
  DetectedTraePath := DetectFromRegistry();
  if DetectedTraePath = '' then DetectedTraePath := DetectFromCandidates();

  { 上次安装保存过的路径优先，其次才是本次检测结果。 }
  if (SavedTraePath <> '') and FileExists(SavedTraePath) then
  begin
    TraePage.Values[0] := SavedTraePath;
    TraeSourceLabel.Caption := '已使用上次安装保存的路径。';
    UseDetectedButton.Visible := (DetectedTraePath <> '') and
      (CompareText(DetectedTraePath, SavedTraePath) <> 0);
  end
  else
  begin
    TraePage.Values[0] := DetectedTraePath;
    TraeSourceLabel.Caption := DescribeSource(DetectedTraePath);
    UseDetectedButton.Visible := False;
  end;

  TraePage.Edits[0].OnChange := @TraePathChanged;
  UpdateTraeStatus();
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if CurPageID = TraePage.ID then
    Result := ValidateTraeSelection();
end;

{ 覆盖安装时必须先停止旧版本服务；Windows 会锁定正在运行的 exe，
  不停止会导致文件替换失败或留下旧 daemon。 }
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
  ExistingExe: String;
begin
  Result := '';
  NeedsRestart := False;
  ExistingExe := ExpandConstant('{app}\{#ProductExe}');
  if not FileExists(ExistingExe) then Exit;

  if not Exec(ExistingExe, 'stop', ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, ResultCode) then
  begin
    Result := '无法停止正在运行的 TRAE SOLO CN Enhancer 服务，请先手动停止后重试。';
    Exit;
  end;
  if ResultCode <> 0 then
  begin
    Result := '旧版本服务未能安全停止（退出码 ' + IntToStr(ResultCode) + '），安装已中止。';
  end;
end;

{ 通过命令行参数把路径交给 exe 自己校验并写入 config.json，这样路径只需要
  在 Unicode 命令行里传递一次，安装程序不必读写任何含中文的文本文件。 }
procedure PersistTraePath();
var
  ResultCode: Integer;
  Params: String;
  ExePath: String;
  SelectedPath: String;
begin
  ExePath := ExpandConstant('{app}\{#ProductExe}');
  if not FileExists(ExePath) then Exit;

  SelectedPath := Trim(TraePage.Values[0]);
  if (SelectedPath = '') or (not FileExists(SelectedPath)) or
    (not MatchesProductExeName(SelectedPath)) then
  begin
    if WizardSilent then
      Log('TRAE SOLO CN.exe was not selected; configure it later with configure --trae-exe')
    else
      MsgBox('没有可保存的 TRAE SOLO CN 路径，请稍后运行 configure --trae-exe。', mbInformation, MB_OK);
    Exit;
  end;

  Params := 'configure --trae-exe "' + SelectedPath + '"';
  if not Exec(ExePath, Params, ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, ResultCode) then
  begin
    if WizardSilent then
      Log('unable to launch TraeEnhancer configure')
    else
      MsgBox('写入 TRAE 路径失败，可稍后手动运行：' + #13#10 +
        'TraeEnhancer.exe configure --trae-exe "<路径>"', mbInformation, MB_OK);
  end
  else if ResultCode <> 0 then
  begin
    if WizardSilent then
      Log('TraeEnhancer configure exited with code ' + IntToStr(ResultCode))
    else
      MsgBox('TraeEnhancer 未能保存 TRAE 路径（退出码 ' + IntToStr(ResultCode) + '）。', mbInformation, MB_OK);
  end;

  SaveTraePath(SelectedPath);
end;

procedure EnableAutostart();
var
  ResultCode: Integer;
begin
  if not WizardIsTaskSelected('autostart') then Exit;
  Exec(
    ExpandConstant('{app}\{#ProductExe}'),
    'install',
    ExpandConstant('{app}'),
    SW_HIDE, ewWaitUntilTerminated, ResultCode
  );
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
  begin
    PersistTraePath();
    EnableAutostart();
  end;
end;

{ data 目录里有账号备份快照和 api-token。删掉不可恢复，所以由用户决定；
  「取消」会中止整个卸载，避免误点。 }
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  DataDir: String;
  Choice: Integer;
begin
  DataDir := ExpandConstant('{app}\data');

  if CurUninstallStep = usUninstall then
  begin
    KeepUserData := True;
    if not DirExists(DataDir) then Exit;

    if UninstallSilent then
    begin
      Log('silent uninstall: keeping user data at ' + DataDir);
      Exit;
    end;

    Choice := MsgBox(
      '是否保留用户数据？' + #13#10 + #13#10 +
      '会保留的内容：' + #13#10 +
      '  账号备份（含登录凭据）、配置、导入导出记录' + #13#10 +
      '  位置：' + DataDir + #13#10 + #13#10 +
      '选择「是」保留，便于以后重装或换机后直接继续使用。' + #13#10 +
      '选择「否」会连同登录凭据一起彻底删除，无法恢复。',
      mbConfirmation,
      MB_YESNOCANCEL
    );
    case Choice of
      IDYES: KeepUserData := True;
      IDNO: KeepUserData := False;
      IDCANCEL: Abort;
    end;
  end
  else if CurUninstallStep = usPostUninstall then
  begin
    if KeepUserData then
    begin
      if not UninstallSilent then
        MsgBox('已保留用户数据：' + #13#10 + DataDir, mbInformation, MB_OK);
    end
    else
    begin
      DelTree(DataDir, True, True, True);
      RemoveDir(ExpandConstant('{app}'));
    end;
  end;
end;
