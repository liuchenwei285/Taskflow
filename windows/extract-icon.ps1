Add-Type -AssemblyName System.Drawing
$exe = 'C:\Users\Alfred Liu\Documents\Qoder\2026-11-16\700baae9\Taskflow\windows\runs\single-exe-test\Taskflow.exe'
$out = 'C:\Users\Alfred Liu\Documents\Qoder\2026-11-16\700baae9\Taskflow\windows\dist\exe-icon-rounded.png'
$i = [System.Drawing.Icon]::ExtractAssociatedIcon($exe)
$b = $i.ToBitmap()
$b.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$b.Dispose()
Write-Output ("extracted icon -> " + $out)
