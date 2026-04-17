param(
    [Parameter(Mandatory = $true)]
    [string]$Exe,

    [Parameter(Mandatory = $true)]
    [string[]]$Arguments,

    [string]$StdoutLog = "C:\Prj\Work\llama-process.stdout.log",
    [string]$StderrLog = "C:\Prj\Work\llama-process.stderr.log",
    [int]$TimeoutSeconds = 900,
    [string]$ExtraPath = ""
)

$ErrorActionPreference = "Stop"

if ($ExtraPath) {
    $env:PATH = "$ExtraPath;$env:PATH"
}

$stdoutDir = Split-Path -Path $StdoutLog -Parent
$stderrDir = Split-Path -Path $StderrLog -Parent

if ($stdoutDir) {
    New-Item -ItemType Directory -Force -Path $stdoutDir | Out-Null
}

if ($stderrDir -and $stderrDir -ne $stdoutDir) {
    New-Item -ItemType Directory -Force -Path $stderrDir | Out-Null
}

Remove-Item $StdoutLog, $StderrLog -ErrorAction SilentlyContinue

$quotedArgs = foreach ($arg in $Arguments) {
    if ($arg -match '[\s"]') {
        '"' + ($arg -replace '"', '\"') + '"'
    } else {
        $arg
    }
}

$proc = Start-Process -FilePath $Exe `
    -ArgumentList ($quotedArgs -join ' ') `
    -RedirectStandardOutput $StdoutLog `
    -RedirectStandardError $StderrLog `
    -PassThru `
    -WindowStyle Hidden

if (-not $proc.WaitForExit($TimeoutSeconds * 1000)) {
    try {
        Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    } catch {
    }

    Write-Output "STATUS=TIMEOUT"
    Write-Output "PID=$($proc.Id)"
} else {
    Write-Output "STATUS=EXITED"
    Write-Output "PID=$($proc.Id)"
    Write-Output "EXITCODE=$($proc.ExitCode)"
}

Write-Output "STDOUT_LOG=$StdoutLog"
Write-Output "STDERR_LOG=$StderrLog"

if (Test-Path $StdoutLog) {
    Write-Output "STDOUT_TAIL_BEGIN"
    Get-Content $StdoutLog -Tail 80
    Write-Output "STDOUT_TAIL_END"
}

if (Test-Path $StderrLog) {
    Write-Output "STDERR_TAIL_BEGIN"
    Get-Content $StderrLog -Tail 80
    Write-Output "STDERR_TAIL_END"
}
