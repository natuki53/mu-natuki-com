param([switch]$VerifyOnly,[string]$ImportProtectedFile)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$release = Join-Path $root '.local\production-readiness\release'
$secretDirectory = Join-Path $release 'intel\secrets'
$destination = Join-Path $secretDirectory 'github-read-token'
$report = Join-Path $root '.local\production-readiness\github-token-validation.json'
$python = Join-Path $root '.local\venv\Scripts\python.exe'
$temporary = $null
$secret = $null
$pointer = [IntPtr]::Zero
$plain = $null

function Assert-LocalPath([string]$Path) {
    $full = [IO.Path]::GetFullPath($Path)
    $expected = [IO.Path]::GetFullPath($secretDirectory).TrimEnd('\') + '\'
    if (-not $full.StartsWith($expected,[StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected credential path' }
    $part = Get-Item -LiteralPath (Split-Path $full -Parent)
    while ($part) {
        if ($part.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Reparse points are not accepted for credential storage' }
        $part = $part.Parent
    }
    if ((Test-Path -LiteralPath $full) -and ((Get-Item -LiteralPath $full).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw 'Reparse points are not accepted for credential storage'
    }
}

try {
    if (-not (Test-Path -LiteralPath $secretDirectory -PathType Container)) { throw 'Prepared local release was not found' }
    Assert-LocalPath $destination
    if ($VerifyOnly -and $ImportProtectedFile) { throw 'Choose verification or protected import' }
    if ($VerifyOnly) {
        if (-not (Test-Path -LiteralPath $destination -PathType Leaf)) { throw 'Saved token was not found' }
        $inputPath = $destination
    } elseif ($ImportProtectedFile) {
        if (Test-Path -LiteralPath $destination) { throw 'A token already exists; it will not be overwritten' }
        Assert-LocalPath $ImportProtectedFile
        $item = Get-Item -LiteralPath $ImportProtectedFile
        if ($item.PSIsContainer -or $item.Name -notmatch '^\.github-token-[a-f0-9]{32}\.pending$' -or $item.Length -gt 512) {
            throw 'Unexpected protected import file'
        }
        $acl = Get-Acl -LiteralPath $ImportProtectedFile
        $identity = [Security.Principal.WindowsIdentity]::GetCurrent().User
        $rules = $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])
        if (-not $acl.AreAccessRulesProtected -or $rules.Count -ne 2 -or
            @($rules | Where-Object {$_.IdentityReference.Value -notin @($identity.Value,'S-1-5-18')}).Count -gt 0) {
            throw 'Imported credential permissions are not private'
        }
        $plain = [IO.File]::ReadAllText($ImportProtectedFile).Trim()
        if ($plain -notmatch '^github_pat_[A-Za-z0-9_]{20,}$') { throw 'Expected a fine-grained PAT' }
        $plain=$null
        $temporary=[IO.Path]::GetFullPath($ImportProtectedFile)
        $inputPath=$temporary
    } else {
        if (Test-Path -LiteralPath $destination) { throw 'A token already exists. Use -VerifyOnly to check it; it will not be overwritten' }
        $temporary = Join-Path $secretDirectory ('.github-token-' + [guid]::NewGuid().ToString('N') + '.pending')
        Assert-LocalPath $temporary
        [IO.File]::Open($temporary,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None).Dispose()
        $identity = [Security.Principal.WindowsIdentity]::GetCurrent().User
        $acl = [Security.AccessControl.FileSecurity]::new()
        $acl.SetOwner($identity)
        $acl.SetAccessRuleProtection($true,$false)
        $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($identity,'FullControl','Allow'))
        $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-5-18'),'FullControl','Allow'))
        Set-Acl -LiteralPath $temporary -AclObject $acl
        Write-Host 'Paste the fine-grained token with No expiration. Input is masked and not saved in command history.'
        Write-Host 'Only local storage and GitHub GET requests will be performed. No production deployment.'
        $secret = Read-Host 'GitHub token' -AsSecureString
        $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
        $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer).Trim()
        if ($plain -notmatch '^github_pat_[A-Za-z0-9_]{20,}$') { throw 'Expected a fine-grained PAT; no token value has been displayed' }
        [IO.File]::WriteAllText($temporary,$plain,[Text.UTF8Encoding]::new($false))
        $plain = $null
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer); $pointer=[IntPtr]::Zero
        $secret.Dispose();$secret=$null
        $inputPath = $temporary
    }
    & $python -B (Join-Path $PSScriptRoot 'verify-monitoring-github-token.py') --token-file $inputPath --config (Join-Path $release 'intel\config\api.json') --output $report
    if ($LASTEXITCODE -ne 0) { throw 'Read verification failed. Inspect the sanitized validation report; the destination token has not been replaced' }
    if (-not $VerifyOnly) {
        # Same directory rename preserves the restricted ACL; File.Move never overwrites an existing token.
        [IO.File]::Move($temporary,$destination)
        $temporary=$null
    }
    $manifestPath = Join-Path $release 'manifest.json'
    $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $manifest | Add-Member -NotePropertyName 'intel/secrets/github-read-token' -NotePropertyValue (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant() -Force
    [IO.File]::WriteAllText($manifestPath,($manifest | ConvertTo-Json -Depth 10)+[Environment]::NewLine,[Text.UTF8Encoding]::new($false))
    & $python -B (Join-Path $PSScriptRoot 'check-monitoring-release.py') $release --require-credentials
    if ($LASTEXITCODE -ne 0) { throw 'Token read verification passed, but the prepared release check failed' }
    Write-Host 'SUCCESS: token saved locally; CI, jobs and runners are readable. Production was not changed.' -ForegroundColor Green
} catch {
    # Never display raw exception/HTTP request data or a stack containing a credential value.
    Write-Host 'Setup did not finish. Token contents have not been displayed. Check the sanitized report or contact the assistant.' -ForegroundColor Yellow
    exit 1
} finally {
    $plain=$null
    if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
    if ($secret) { $secret.Dispose() }
    if ($temporary -and (Test-Path -LiteralPath $temporary)) {
        Assert-LocalPath $temporary
        Remove-Item -LiteralPath $temporary -Force
    }
}
