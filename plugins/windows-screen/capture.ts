import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { captureInput, shotSchema } from "./contract.js";

const run = promisify(execFile);
export function captureScript(monitor: number): string {
  const input = captureInput.parse({ monitor });
  return `
$ErrorActionPreference = 'Stop'
if ((Get-Process -Id $PID).SessionId -eq 0) { throw 'An interactive Windows user session is required.' }
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition 'using System; using System.Text; using System.Runtime.InteropServices; public class BbDesktop { [DllImport("user32.dll")] public static extern IntPtr OpenInputDesktop(uint f, bool i, uint a); [DllImport("user32.dll")] public static extern bool CloseDesktop(IntPtr h); [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern bool GetUserObjectInformation(IntPtr h, int n, StringBuilder s, int length, out int needed); [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); }'
$desktop = [BbDesktop]::OpenInputDesktop(0, $false, 1)
if ($desktop -eq [IntPtr]::Zero) { throw 'Desktop unavailable or locked. Unlock the Windows host.' }
try {
  $name = New-Object System.Text.StringBuilder(256)
  $needed = 0
  if (-not [BbDesktop]::GetUserObjectInformation($desktop, 2, $name, 512, [ref]$needed) -or $name.ToString() -ne 'Default') { throw 'Desktop unavailable or locked.' }
} finally { [void][BbDesktop]::CloseDesktop($desktop) }
[void][BbDesktop]::SetProcessDPIAware()
$screens = @([System.Windows.Forms.Screen]::AllScreens | Sort-Object -Property Primary -Descending)
$index = ${input.monitor}
if ($index -ge $screens.Count) { throw 'Monitor index out of range.' }
$bounds = $screens[$index].Bounds
if ($bounds.Width -le 0 -or $bounds.Height -le 0 -or ([long]$bounds.Width * $bounds.Height) -gt 40000000) { throw 'Unsupported screen dimensions.' }
$bitmap = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
$graphics = $null
$scaled = $null
$output = $null
$stream = New-Object System.IO.MemoryStream
try {
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
  $ratio = [Math]::Min(1.0, 1600.0 / [Math]::Max($bounds.Width, $bounds.Height))
  $width = [Math]::Max(1, [int]($bounds.Width * $ratio))
  $height = [Math]::Max(1, [int]($bounds.Height * $ratio))
  $scaled = New-Object System.Drawing.Bitmap($width, $height)
  $output = [System.Drawing.Graphics]::FromImage($scaled)
  $output.DrawImage($bitmap, 0, 0, $width, $height)
  $scaled.Save($stream, [System.Drawing.Imaging.ImageFormat]::Jpeg)
  @{data=[Convert]::ToBase64String($stream.ToArray());mimeType='image/jpeg';width=$width;height=$height;monitor=$index;monitorCount=$screens.Count;hostName=$env:COMPUTERNAME;capturedAt=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json -Compress
} finally {
  if ($output) { $output.Dispose() }
  if ($scaled) { $scaled.Dispose() }
  if ($graphics) { $graphics.Dispose() }
  $bitmap.Dispose()
  $stream.Dispose()
}
`;
}

export async function captureScreen(monitor: number) {
  if (process.platform !== "win32") throw new Error("Windows Screen requires a Windows host.");
  const encoded = Buffer.from(captureScript(monitor), "utf16le").toString("base64");
  const { stdout } = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], {
    windowsHide: true, timeout: 20000, maxBuffer: 9_000_000,
  });
  return shotSchema.parse(JSON.parse(stdout.trim()));
}
