Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class W {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out R r);
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr h);
  [DllImport("shcore.dll")] public static extern int GetProcessDpiAwareness(IntPtr h, out int a);
  [StructLayout(LayoutKind.Sequential)] public struct R { public int L, T, Rr, B; }
}
'@
$p = Get-Process Taskflow | Select-Object -First 1
$r = New-Object W+R
[W]::GetWindowRect($p.MainWindowHandle, [ref]$r) | Out-Null
$a = 0
[W]::GetProcessDpiAwareness($p.Handle, [ref]$a) | Out-Null
$aware = @{0='unaware';1='system';2='permonitorv2'}[[int]$a]
Write-Output ("rect=" + ($r.Rr - $r.L) + "x" + ($r.B - $r.T) + " dpi=" + [W]::GetDpiForWindow($p.MainWindowHandle) + " awareness=" + $aware)
