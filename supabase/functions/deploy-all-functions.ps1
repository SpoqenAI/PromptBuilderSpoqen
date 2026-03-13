param(
  [string]$ProjectRef = '',
  [string]$PublishableKey = '',
  [switch]$SkipSmokeTest,
  [switch]$RequireAuthSmoke
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# IMPORTANT: WE DO NOT USE LEGACY JWT VERIFICATION FOR SUPABASE EDGE FUNCTIONS.
# Any handler-auth function that calls requireUser(...) must deploy with --no-verify-jwt.
# If the app starts returning {"code":401,"message":"Invalid JWT"}, treat that as a broken deployment.

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptDir '..\..')
$projectRefFile = Join-Path $repoRoot 'supabase\.temp\project-ref'

if ([string]::IsNullOrWhiteSpace($ProjectRef)) {
  if (-not (Test-Path $projectRefFile)) {
    throw "Project ref not provided and $projectRefFile does not exist."
  }
  $ProjectRef = (Get-Content $projectRefFile -Raw).Trim()
}

if ([string]::IsNullOrWhiteSpace($ProjectRef)) {
  throw 'Project ref is required.'
}

$functionDirs = Get-ChildItem -Path $scriptDir -Directory |
  Where-Object { $_.Name -ne '_shared' -and $_.Name -ne 'transcript-flow-map' } |
  Sort-Object Name

$publicNoVerifyJwtFunctions = @(
  'github-app-callback',
  'stripe-webhook'
)

function Test-RequiresHandlerAuth {
  param(
    [System.IO.DirectoryInfo]$FunctionDir
  )

  $indexPath = Join-Path $FunctionDir.FullName 'index.ts'
  if (-not (Test-Path $indexPath)) {
    return $false
  }

  $source = Get-Content $indexPath -Raw
  return $source -match 'requireUser\s*\('
}

Write-Host "Project ref: $ProjectRef"
Write-Host 'Deploying all edge functions except transcript-flow-map...'

foreach ($dir in $functionDirs) {
  $requiresHandlerAuth = Test-RequiresHandlerAuth -FunctionDir $dir
  $forceNoVerifyJwt = $requiresHandlerAuth -or ($publicNoVerifyJwtFunctions -contains $dir.Name)
  if ($forceNoVerifyJwt) {
    Write-Host "Deploying function: $($dir.Name) (with --no-verify-jwt)"
    & supabase functions deploy $dir.Name --project-ref $ProjectRef --no-verify-jwt
  } else {
    Write-Host "Deploying function: $($dir.Name)"
    & supabase functions deploy $dir.Name --project-ref $ProjectRef
  }
  if ($LASTEXITCODE -ne 0) {
    throw "Function deploy failed for $($dir.Name)."
  }
}

$transcriptDeployScript = Join-Path $scriptDir 'deploy-transcript-flow-map.ps1'
if (-not (Test-Path $transcriptDeployScript)) {
  throw "Missing deploy script: $transcriptDeployScript"
}

$transcriptArgs = @{
  ProjectRef = $ProjectRef
}
if (-not [string]::IsNullOrWhiteSpace($PublishableKey)) {
  $transcriptArgs['PublishableKey'] = $PublishableKey
}
if ($SkipSmokeTest) {
  $transcriptArgs['SkipSmokeTest'] = $true
}

Write-Host 'Deploying transcript-flow-map via dedicated script (enforces --no-verify-jwt)...'
& $transcriptDeployScript @transcriptArgs
if ($LASTEXITCODE -ne 0) {
  throw 'Transcript-flow-map deploy script failed.'
}

if ($SkipSmokeTest) {
  Write-Host 'SkipSmokeTest enabled. Deployment finished.'
  exit 0
}

$smokeScript = Join-Path $scriptDir 'test-edge-functions.ps1'
if (Test-Path $smokeScript) {
  $smokeArgs = @{
    ProjectRef = $ProjectRef
  }
  if (-not [string]::IsNullOrWhiteSpace($PublishableKey)) {
    $smokeArgs['AnonKey'] = $PublishableKey
  }
  if ($RequireAuthSmoke) {
    $smokeArgs['RequireAuth'] = $true
  }

  Write-Host 'Running edge function smoke tests...'
  & $smokeScript @smokeArgs
  if ($LASTEXITCODE -ne 0) {
    throw 'Edge function smoke tests failed.'
  }
}

Write-Host 'All functions deployed successfully with transcript-flow-map auth mode preserved.'
