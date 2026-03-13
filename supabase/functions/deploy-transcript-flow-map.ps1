param(
  [string]$ProjectRef = '',
  [string]$PublishableKey = '',
  [switch]$SkipSmokeTest
)

$ErrorActionPreference = 'Stop'

# IMPORTANT: WE DO NOT USE LEGACY JWT VERIFICATION FOR SUPABASE EDGE FUNCTIONS.
# transcript-flow-map performs auth inside the function and must be deployed with --no-verify-jwt.

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptDir '..\..')
$projectRefFile = Join-Path $repoRoot 'supabase\.temp\project-ref'
$envFile = Join-Path $repoRoot 'app\.env'

if ([string]::IsNullOrWhiteSpace($ProjectRef)) {
  if (-not (Test-Path $projectRefFile)) {
    throw "Project ref not provided and $projectRefFile does not exist."
  }
  $ProjectRef = (Get-Content $projectRefFile -Raw).Trim()
}

if ([string]::IsNullOrWhiteSpace($ProjectRef)) {
  throw 'Project ref is required.'
}

if ([string]::IsNullOrWhiteSpace($PublishableKey) -and (Test-Path $envFile)) {
  $line = Get-Content $envFile | Where-Object { $_ -match '^NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY=' } | Select-Object -First 1
  if ($line) {
    $PublishableKey = ($line -replace '^NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY=', '').Trim()
  }
}

Write-Host "Project ref: $ProjectRef"
Write-Host 'Deleting transcript-flow-map to force settings refresh...'

# Delete may fail if function does not exist yet; keep going in that case.
# Use cmd.exe here so Supabase CLI stderr warnings are captured as plain text
# instead of surfacing as PowerShell native-command errors.
$deleteCommand = "supabase functions delete transcript-flow-map --project-ref $ProjectRef --yes 2>&1"
$deleteOutput = & cmd.exe /c $deleteCommand
$deleteExitCode = $LASTEXITCODE
if ($deleteExitCode -ne 0) {
  $deleteText = ($deleteOutput | Out-String)
  if ($deleteText -match 'not found' -or $deleteText -match 'does not exist') {
    Write-Host 'Function does not exist yet; continuing.'
  } else {
    throw "Function delete failed: $deleteText"
  }
}

Write-Host 'Deploying transcript-flow-map with --no-verify-jwt...'
& supabase functions deploy transcript-flow-map --no-verify-jwt --project-ref $ProjectRef
if ($LASTEXITCODE -ne 0) {
  throw 'Function deploy failed.'
}

if ($SkipSmokeTest) {
  Write-Host 'SkipSmokeTest enabled; done.'
  exit 0
}

if ([string]::IsNullOrWhiteSpace($PublishableKey)) {
  Write-Host 'Publishable key not provided. Skipping smoke test.'
  exit 0
}

$functionUrl = "https://$ProjectRef.supabase.co/functions/v1/transcript-flow-map"
$headers = @{
  'apikey' = $PublishableKey
  'Content-Type' = 'application/json'
}
$preflightHeaders = @{
  'Origin' = 'http://localhost:5173'
  'Access-Control-Request-Method' = 'POST'
  'Access-Control-Request-Headers' = 'authorization, x-client-info, apikey, content-type'
}
$body = '{"transcript":"Smoke test transcript content long enough for validation."}'

Write-Host "Running smoke test against $functionUrl ..."

try {
  $preflightResponse = Invoke-WebRequest -Method Options -Uri $functionUrl -Headers $preflightHeaders -ErrorAction Stop
  $allowOrigin = [string]$preflightResponse.Headers['Access-Control-Allow-Origin']
  Write-Host "Preflight status: $([int]$preflightResponse.StatusCode)"
  Write-Host "Preflight allow-origin: $allowOrigin"
  if ($allowOrigin -ne $preflightHeaders['Origin']) {
    throw "Preflight CORS mismatch. Expected $($preflightHeaders['Origin']), received $allowOrigin"
  }
} catch {
  if ($_.Exception.Response -is [System.Net.HttpWebResponse]) {
    $httpResponse = [System.Net.HttpWebResponse]$_.Exception.Response
    $allowOrigin = [string]$httpResponse.Headers['Access-Control-Allow-Origin']
    throw "Preflight smoke test failed (status=$([int]$httpResponse.StatusCode), allow-origin=$allowOrigin): $($_.Exception.Message)"
  }
  throw
}

$statusCode = 0
$responseBody = ''

try {
  $response = Invoke-WebRequest -Method Post -Uri $functionUrl -Headers $headers -Body $body -ErrorAction Stop
  $statusCode = [int]$response.StatusCode
  $responseBody = [string]$response.Content
} catch {
  if ($_.Exception.Response -is [System.Net.HttpWebResponse]) {
    $httpResponse = [System.Net.HttpWebResponse]$_.Exception.Response
    $statusCode = [int]$httpResponse.StatusCode
    $reader = New-Object System.IO.StreamReader($httpResponse.GetResponseStream())
    $responseBody = $reader.ReadToEnd()
  } else {
    throw
  }
}

Write-Host "Smoke test status: $statusCode"
Write-Host "Smoke test body: $responseBody"

if (($responseBody -match '"code"\s*:\s*401') -and (($responseBody -match 'Missing authorization header') -or ($responseBody -match 'Invalid JWT'))) {
  throw 'Gateway JWT verification appears enabled (legacy verify toggle). Function is still rejecting unauthenticated calls before handler execution.'
}

Write-Host 'Smoke test passed: function reached handler-level auth (legacy JWT gateway verify is not blocking).'
