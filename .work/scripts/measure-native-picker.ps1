Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class NativeWindows {
  public delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int maxCount);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam);
  public static IntPtr FindVisibleWindow(string titlePart) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((hwnd, unused) => {
      if (!IsWindowVisible(hwnd)) return true;
      var title = new StringBuilder(512);
      GetWindowText(hwnd, title, title.Capacity);
      if (title.ToString().IndexOf(titlePart, StringComparison.OrdinalIgnoreCase) >= 0) {
        found = hwnd;
        return false;
      }
      return true;
    }, IntPtr.Zero);
    return found;
  }
  public static string[] VisibleTitles() {
    var titles = new List<string>();
    EnumWindows((hwnd, unused) => {
      if (!IsWindowVisible(hwnd)) return true;
      var title = new StringBuilder(512);
      GetWindowText(hwnd, title, title.Capacity);
      if (title.Length > 0) titles.Add(title.ToString());
      return true;
    }, IntPtr.Zero);
    return titles.ToArray();
  }
}
'@

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$exePath = [System.IO.Path]::GetFullPath((Join-Path $projectRoot 'src-tauri\target\release\radview3d.exe'))
$deadline = [DateTime]::UtcNow.AddMinutes(8)
$app = $null
while ($null -eq $app -and [DateTime]::UtcNow -lt $deadline) {
  $app = Get-Process -Name radview3d -ErrorAction SilentlyContinue |
    Where-Object { try { $_.Path -eq $exePath -and $_.MainWindowHandle -ne [IntPtr]::Zero } catch { $false } } |
    Select-Object -First 1
  if ($null -eq $app) { Start-Sleep -Milliseconds 250 }
}
if ($null -eq $app) { throw "Standalone app did not open a window at $exePath within eight minutes." }

$buttonCondition = [System.Windows.Automation.PropertyCondition]::new(
  [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
  [System.Windows.Automation.ControlType]::Button)
$buttonDeadline = [DateTime]::UtcNow.AddSeconds(30)
$openButton = $null
while ($null -eq $openButton -and [DateTime]::UtcNow -lt $buttonDeadline) {
  $app.Refresh()
  if ($app.MainWindowHandle -ne [IntPtr]::Zero) {
    $root = [System.Windows.Automation.AutomationElement]::FromHandle($app.MainWindowHandle)
    $buttons = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $buttonCondition)
    for ($i = 0; $i -lt $buttons.Count; $i++) {
      if ($buttons[$i].Current.Name -match '^Open folder$') { $openButton = $buttons[$i]; break }
    }
  }
  if ($null -eq $openButton) { Start-Sleep -Milliseconds 250 }
}
if ($null -eq $openButton) {
  $names = @()
  if ($root) { for ($i = 0; $i -lt $buttons.Count; $i++) { $names += $buttons[$i].Current.Name } }
  Stop-Process -Id $app.Id -Force -ErrorAction SilentlyContinue
  throw "Could not find the Open folder button through UI Automation. Buttons found: $($names -join ', ')"
}

$results = @()
try {
  for ($trial = 1; $trial -le 3; $trial++) {
    $app.Refresh()
    $root = [System.Windows.Automation.AutomationElement]::FromHandle($app.MainWindowHandle)
    $buttons = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $buttonCondition)
    $openButton = $null
    for ($i = 0; $i -lt $buttons.Count; $i++) {
      if ($buttons[$i].Current.Name -match '^Open folder$') { $openButton = $buttons[$i]; break }
    }
    if ($null -eq $openButton) { throw "Open folder button disappeared before trial $trial." }

    $timer = [System.Diagnostics.Stopwatch]::StartNew()
    $openButton.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
    $invokeMs = $timer.Elapsed.TotalMilliseconds
    $dialog = [IntPtr]::Zero
    while ($dialog -eq [IntPtr]::Zero -and $timer.Elapsed.TotalSeconds -lt 15) {
      $dialog = [NativeWindows]::FindVisibleWindow('Open Monaco patient folder')
      if ($dialog -eq [IntPtr]::Zero) { Start-Sleep -Milliseconds 10 }
    }
    $visibleMs = if ($dialog -ne [IntPtr]::Zero) { $timer.Elapsed.TotalMilliseconds } else { $null }
    $results += [pscustomobject]@{ Trial = $trial; InvokeReturnedMs = [Math]::Round($invokeMs, 1); DialogVisibleMs = if ($null -eq $visibleMs) { 'NOT DETECTED within 15000 ms' } else { [Math]::Round($visibleMs, 1) } }
    if ($dialog -eq [IntPtr]::Zero) {
      Write-Output "Visible windows: $([NativeWindows]::VisibleTitles() -join ' | ')"
      break
    }

    [void][NativeWindows]::PostMessage($dialog, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
    $closeDeadline = [DateTime]::UtcNow.AddSeconds(3)
    while ([DateTime]::UtcNow -lt $closeDeadline -and [NativeWindows]::FindVisibleWindow('Open Monaco patient folder') -ne [IntPtr]::Zero) {
      Start-Sleep -Milliseconds 25
    }
    Start-Sleep -Milliseconds 300
  }
}
finally {
  if ($app -and -not $app.HasExited) { Stop-Process -Id $app.Id -Force -ErrorAction SilentlyContinue }
}
$results | Format-Table -AutoSize
