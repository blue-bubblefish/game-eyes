param(
  [Parameter(Mandatory=$true)][ValidateSet('windows','see','click','key','keyv','ocr')][string]$Action,
  [string]$Title = '',
  [int]$Pid2 = 0,
  [int]$X = -1,
  [int]$Y = -1,
  [string]$Keys = '',
  [int]$Vk = 0,
  [string]$Out = '',
  [int]$Bring = 0
)
# Game eyes: list windows, grab a window, click, send keys. Does not touch game memory.
# NOTE: keep this file ASCII-only. PowerShell 5.1 reads .ps1 as ANSI without a BOM,
# so any non-ASCII text (especially inside the C# block) turns into mojibake and breaks Add-Type.
$ErrorActionPreference = 'Stop'

# 让 stdout 走 UTF-8，不然中文窗口标题在回执里变乱码
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -ReferencedAssemblies System.Drawing, System.Windows.Forms -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;

public static class GW {
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint f);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, IntPtr extra);

  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }

  public static bool Minimized(RECT r) { return r.Left <= -30000 || r.Top <= -30000; }

  public static List<string> List() {
    var rows = new List<string>();
    IntPtr fg = GetForegroundWindow();
    EnumWindows(delegate(IntPtr h, IntPtr l) {
      if (!IsWindowVisible(h)) return true;
      RECT r; if (!GetWindowRect(h, out r)) return true;
      int w = r.Right - r.Left, hh = r.Bottom - r.Top;
      if (w <= 4 || hh <= 4) return true;
      var sb = new StringBuilder(512); GetWindowText(h, sb, 512);
      string t = sb.ToString();
      var cb = new StringBuilder(256); GetClassName(h, cb, 256);
      uint pid; GetWindowThreadProcessId(h, out pid);
      // minimized windows report -32000,-32000 199x34; mark them so they are not picked as targets
      string mark = Minimized(r) ? "MIN" : ((h == fg) ? "FG " : "   ");
      rows.Add(String.Format("{0} pid={1} {2}x{3} @{4},{5} class={6} title=[{7}]",
        mark, pid, w, hh, r.Left, r.Top, cb.ToString(), t));
      return true;
    }, IntPtr.Zero);
    return rows;
  }

  public static IntPtr Find(string needle, int pid) {
    IntPtr found = IntPtr.Zero;
    string low = (needle ?? "").ToLower();
    EnumWindows(delegate(IntPtr h, IntPtr l) {
      if (!IsWindowVisible(h)) return true;
      RECT r; if (!GetWindowRect(h, out r)) return true;
      if (Minimized(r)) return true; // skip minimized
      if (pid > 0) {
        uint p; GetWindowThreadProcessId(h, out p);
        if ((int)p == pid) { found = h; return false; }
      }
      if (low.Length > 0) {
        var sb = new StringBuilder(512); GetWindowText(h, sb, 512);
        if (sb.ToString().ToLower().Contains(low)) { found = h; return false; }
      }
      return true;
    }, IntPtr.Zero);
    return found;
  }

  public static bool Blank(Bitmap b) {
    long sum = 0; int n = 0;
    int sx = Math.Max(1, b.Width / 24), sy = Math.Max(1, b.Height / 24);
    for (int y = 0; y < b.Height; y += sy)
      for (int x = 0; x < b.Width; x += sx) {
        Color c = b.GetPixel(x, y); sum += (c.R + c.G + c.B) / 3; n++;
      }
    return n > 0 && (sum / n) < 8;
  }

  public static string Capture(IntPtr h, string path) {
    SetProcessDPIAware();
    RECT r; if (!GetWindowRect(h, out r)) return "ERR rect";
    if (Minimized(r)) return "ERR minimized";
    int w = r.Right - r.Left, hh = r.Bottom - r.Top;
    if (w <= 0 || hh <= 0) return "ERR empty";
    using (var bmp = new Bitmap(w, hh, PixelFormat.Format32bppArgb)) {
      bool ok;
      using (var g = Graphics.FromImage(bmp)) {
        IntPtr hdc = g.GetHdc();
        ok = PrintWindow(h, hdc, 2);
        g.ReleaseHdc(hdc);
      }
      bool blank = Blank(bmp);
      if (!ok || blank) {
        using (var g2 = Graphics.FromImage(bmp)) {
          g2.CopyFromScreen(r.Left, r.Top, 0, 0, new Size(w, hh));
        }
      }
      bmp.Save(path, ImageFormat.Png);
      return String.Format("OK printwindow={0} blank={1} rect={2},{3} {4}x{5}", ok, blank, r.Left, r.Top, w, hh);
    }
  }

  public static string Click(IntPtr h, int x, int y) {
    SetProcessDPIAware();
    RECT r; if (!GetWindowRect(h, out r)) return "ERR rect";
    int sx = r.Left + x, sy = r.Top + y;
    SetCursorPos(sx, sy);
    System.Threading.Thread.Sleep(60);
    mouse_event(0x0002, 0, 0, 0, IntPtr.Zero);
    System.Threading.Thread.Sleep(40);
    mouse_event(0x0004, 0, 0, 0, IntPtr.Zero);
    return String.Format("CLICK rel={0},{1} screen={2},{3} window={4},{5}", x, y, sx, sy, r.Left, r.Top);
  }
}
'@

try { $null = [GW]::List() } catch { }

# --- OCR: Windows.Media.Ocr, one line per text line: x,y,w,h<TAB>text ---
Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]

function Await($WinRtTask, $ResultType) {
  $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
  $netTask = $asTask.Invoke($null, @($WinRtTask))
  $netTask.Wait(-1) | Out-Null
  $netTask.Result
}

function Invoke-Ocr {
  param([string]$Path, [string]$Lang)
  [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime] | Out-Null
  [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime] | Out-Null
  [Windows.Media.Ocr.OcrEngine, Windows.Media.Ocr, ContentType = WindowsRuntime] | Out-Null
  [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime] | Out-Null
  if (-not (Test-Path $Path)) { return @("ERR no file: $Path") }
  $file    = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($Path)) ([Windows.Storage.StorageFile])
  $stream  = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $bitmap  = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  $engine = $null
  if ($Lang -ne '') {
    try {
      $language = New-Object Windows.Globalization.Language $Lang
      $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($language)
    } catch { $engine = $null }
  }
  if ($null -eq $engine) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() }
  if ($null -eq $engine) { return @('ERR no OCR engine available') }
  $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
  $out = @("ENGINE: " + $engine.RecognizerLanguage.LanguageTag)
  foreach ($line in $result.Lines) {
    $words = $line.Words
    $x1 = ($words | ForEach-Object { $_.BoundingRect.X } | Measure-Object -Minimum).Minimum
    $y1 = ($words | ForEach-Object { $_.BoundingRect.Y } | Measure-Object -Minimum).Minimum
    $x2 = ($words | ForEach-Object { $_.BoundingRect.X + $_.BoundingRect.Width } | Measure-Object -Maximum).Maximum
    $y2 = ($words | ForEach-Object { $_.BoundingRect.Y + $_.BoundingRect.Height } | Measure-Object -Maximum).Maximum
    $out += ("{0},{1},{2},{3}`t{4}" -f [int]$x1, [int]$y1, [int]($x2 - $x1), [int]($y2 - $y1), $line.Text)
  }
  return $out
}

function Get-Hwnd {
  param([string]$T, [int]$P)
  $h = [IntPtr]::Zero
  if ($P -gt 0 -or $T -ne '') { $h = [GW]::Find($T, $P) }
  if ($h -eq [IntPtr]::Zero) { $h = [GW]::GetForegroundWindow() }
  return $h
}

switch ($Action) {
  'windows' {
    [GW]::List() | ForEach-Object { $_ }
  }
  'see' {
    $h = Get-Hwnd -T $Title -P $Pid2
    if ($h -eq [IntPtr]::Zero) { 'ERR no window'; exit 1 }
    if ($Bring -eq 1) { $null = [GW]::SetForegroundWindow($h); Start-Sleep -Milliseconds 200 }
    if ($Out -eq '') { $Out = Join-Path $env:TEMP 'game-see.png' }
    $res = [GW]::Capture($h, $Out)
    "RESULT: $res"
    "FILE: $Out"
  }
  'click' {
    $h = Get-Hwnd -T $Title -P $Pid2
    if ($h -eq [IntPtr]::Zero) { 'ERR no window'; exit 1 }
    if ($Bring -eq 1) { $null = [GW]::SetForegroundWindow($h); Start-Sleep -Milliseconds 250 }
    [GW]::Click($h, $X, $Y)
  }
  'key' {
    $h = Get-Hwnd -T $Title -P $Pid2
    if ($h -eq [IntPtr]::Zero) { 'ERR no window'; exit 1 }
    $null = [GW]::SetForegroundWindow($h)
    Start-Sleep -Milliseconds 250
    [System.Windows.Forms.SendKeys]::SendWait($Keys)
    "KEY sent=[$Keys]"
  }
  'keyv' {
    # hardware-level key: SendKeys only posts WM_CHAR, RawInput games ignore it
    $h = Get-Hwnd -T $Title -P $Pid2
    if ($h -eq [IntPtr]::Zero) { 'ERR no window'; exit 1 }
    $null = [GW]::SetForegroundWindow($h)
    Start-Sleep -Milliseconds 350
    [GW]::keybd_event([byte]$Vk, 0, 0, [IntPtr]::Zero)
    Start-Sleep -Milliseconds 60
    [GW]::keybd_event([byte]$Vk, 0, 2, [IntPtr]::Zero)
    "KEYV vk=$Vk"
  }
  'ocr' {
    # capture the window, then read its text: x,y,w,h<TAB>line
    $h = Get-Hwnd -T $Title -P $Pid2
    if ($h -eq [IntPtr]::Zero) { 'ERR no window'; exit 1 }
    if ($Bring -eq 1) { $null = [GW]::SetForegroundWindow($h); Start-Sleep -Milliseconds 200 }
    if ($Out -eq '') { $Out = Join-Path $env:TEMP 'game-ocr.png' }
    $res = [GW]::Capture($h, $Out)
    "CAPTURE: $res"
    if ($res -like 'ERR*') { exit 1 }
    Invoke-Ocr -Path $Out -Lang $Keys | ForEach-Object { $_ }
  }
}
