$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$brandRoot = Join-Path $projectRoot 'public\brand'
$source = [Drawing.Image]::FromFile((Join-Path $brandRoot 'multiplexity-mark.png'))
try {
  $bitmap = New-Object Drawing.Bitmap 256,256
  try {
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.Clear([Drawing.Color]::Transparent)
      $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.DrawImage($source,0,0,256,256)
    } finally { $graphics.Dispose() }
    $smallPath = Join-Path $brandRoot 'multiplexity-mark-small.png'
    $bitmap.Save($smallPath,[Drawing.Imaging.ImageFormat]::Png)
    [IO.File]::Copy($smallPath,(Join-Path $projectRoot 'src\app\icon.png'),$true)
    $bytes = [IO.File]::ReadAllBytes($smallPath)
    $stream = [IO.File]::Create((Join-Path $brandRoot 'multiplexity.ico'))
    $writer = New-Object IO.BinaryWriter $stream
    try {
      $writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]1)
      $writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([byte]0)
      $writer.Write([uint16]1); $writer.Write([uint16]32); $writer.Write([uint32]$bytes.Length); $writer.Write([uint32]22); $writer.Write($bytes)
    } finally { $writer.Dispose() }
  } finally { $bitmap.Dispose() }
} finally { $source.Dispose() }
Write-Output 'BRAND_ASSETS_PREPARED'
