param(
  [string]$ProjectRef = "",
  [string]$AnonKey = "",
  [string]$AccessToken = "",
  [string]$TestEmail = "",
  [string]$TestPassword = "",
  [switch]$RequireAuth
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$script:AuthTokenResolutionError = ""

function Resolve-ProjectRef {
  param([string]$Value)
  if ($Value -and $Value.Trim().Length -gt 0) {
    return $Value.Trim()
  }

  $tempRefPath = Join-Path $PSScriptRoot "..\.temp\project-ref"
  if (Test-Path $tempRefPath) {
    $fromFile = (Get-Content $tempRefPath -Raw).Trim()
    if ($fromFile.Length -gt 0) {
      return $fromFile
    }
  }

  throw "Project ref not provided and supabase/.temp/project-ref is missing."
}

function Resolve-AnonKey {
  param([string]$Value)
  if ($Value -and $Value.Trim().Length -gt 0) {
    return $Value.Trim()
  }

  if ($env:NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY -and $env:NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY.Trim().Length -gt 0) {
    return $env:NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY.Trim()
  }

  $appEnvPath = Join-Path $PSScriptRoot "..\..\app\.env"
  if (Test-Path $appEnvPath) {
    foreach ($line in Get-Content $appEnvPath) {
      if ($line -match "^\s*NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY\s*=\s*(.+)\s*$") {
        $candidate = $Matches[1].Trim().Trim("'`"")
        if ($candidate.Length -gt 0) {
          return $candidate
        }
      }
    }
  }

  return ""
}

function Invoke-EdgeRequest {
  param(
    [string]$Url,
    [string]$Method,
    [string]$Body = "",
    [hashtable]$Headers = @{}
  )

  try {
    if ($Body.Length -gt 0) {
      $response = Invoke-WebRequest -Uri $Url -Method $Method -Headers $Headers -Body $Body -UseBasicParsing -TimeoutSec 20 -MaximumRedirection 0
    } else {
      $response = Invoke-WebRequest -Uri $Url -Method $Method -Headers $Headers -UseBasicParsing -TimeoutSec 20 -MaximumRedirection 0
    }

    return [pscustomobject]@{
      ok = $true
      status = [int]$response.StatusCode
      body = [string]$response.Content
      error = ""
    }
  } catch {
    $statusCode = 0
    $responseBody = ""
    $message = $_.Exception.Message

    $hasResponse = $_.Exception -and $_.Exception.PSObject.Properties.Name -contains "Response"
    if ($hasResponse -and $_.Exception.Response) {
      try {
        $statusCode = [int]$_.Exception.Response.StatusCode.value__
      } catch {
        $statusCode = 0
      }

      try {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $responseBody = $reader.ReadToEnd()
      } catch {
        $responseBody = ""
      }
    }

    return [pscustomobject]@{
      ok = $false
      status = $statusCode
      body = $responseBody
      error = $message
    }
  }
}

function Expect-Status {
  param(
    [int]$Status,
    [int[]]$Allowed
  )
  return $Allowed -contains $Status
}

function Resolve-TestEmail {
  param([string]$Value)
  if ($Value -and $Value.Trim().Length -gt 0) {
    return $Value.Trim()
  }
  if ($env:SUPABASE_TEST_EMAIL -and $env:SUPABASE_TEST_EMAIL.Trim().Length -gt 0) {
    return $env:SUPABASE_TEST_EMAIL.Trim()
  }
  return ""
}

function Resolve-TestPassword {
  param([string]$Value)
  if ($Value -and $Value.Trim().Length -gt 0) {
    return $Value.Trim()
  }
  if ($env:SUPABASE_TEST_PASSWORD -and $env:SUPABASE_TEST_PASSWORD.Trim().Length -gt 0) {
    return $env:SUPABASE_TEST_PASSWORD.Trim()
  }
  return ""
}

function Resolve-AccessToken {
  param(
    [string]$Value,
    [string]$ProjectRef,
    [string]$AnonKey,
    [string]$Email,
    [string]$Password
  )

  if ($Value -and $Value.Trim().Length -gt 0) {
    return $Value.Trim()
  }

  if ($env:SUPABASE_TEST_ACCESS_TOKEN -and $env:SUPABASE_TEST_ACCESS_TOKEN.Trim().Length -gt 0) {
    return $env:SUPABASE_TEST_ACCESS_TOKEN.Trim()
  }

  if (-not $AnonKey -or -not $Email -or -not $Password) {
    return ""
  }

  $authUrl = "https://$ProjectRef.supabase.co/auth/v1/token?grant_type=password"
  $authHeaders = @{
    "Content-Type" = "application/json"
    "apikey" = $AnonKey
  }
  $authBody = @{
    email = $Email
    password = $Password
  } | ConvertTo-Json -Depth 4

  try {
    $authResponse = Invoke-RestMethod -Uri $authUrl -Method POST -Headers $authHeaders -Body $authBody -TimeoutSec 20
    if ($authResponse.access_token -and $authResponse.access_token.ToString().Trim().Length -gt 0) {
      return $authResponse.access_token.ToString().Trim()
    }
    $script:AuthTokenResolutionError = "Auth response did not include access_token."
  } catch {
    $status = 0
    $details = ""
    if ($_.Exception -and $_.Exception.PSObject.Properties.Name -contains "Response" -and $_.Exception.Response) {
      try { $status = [int]$_.Exception.Response.StatusCode.value__ } catch { $status = 0 }
    }
    if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
      $details = [string]$_.ErrorDetails.Message
    } else {
      $details = [string]$_.Exception.Message
    }
    $script:AuthTokenResolutionError = "Auth token request failed (status=$status): $details"
    return ""
  }

  return ""
}

$resolvedRef = Resolve-ProjectRef -Value $ProjectRef
$resolvedAnon = Resolve-AnonKey -Value $AnonKey
$resolvedTestEmail = Resolve-TestEmail -Value $TestEmail
$resolvedTestPassword = Resolve-TestPassword -Value $TestPassword
$resolvedAccessToken = Resolve-AccessToken -Value $AccessToken -ProjectRef $resolvedRef -AnonKey $resolvedAnon -Email $resolvedTestEmail -Password $resolvedTestPassword
$baseUrl = "https://$resolvedRef.supabase.co/functions/v1"

$sharedHeaders = @{
  "Content-Type" = "application/json"
  "Origin" = "http://localhost:5173"
}

if ($resolvedAnon.Length -gt 0) {
  $sharedHeaders["apikey"] = $resolvedAnon
}

$authEnabled = $resolvedAccessToken.Length -gt 0
if ($RequireAuth -and -not $authEnabled) {
  $extra = if ($script:AuthTokenResolutionError) { " $script:AuthTokenResolutionError" } else { "" }
  throw "RequireAuth was requested but no access token could be resolved. Provide -AccessToken or SUPABASE_TEST_EMAIL/SUPABASE_TEST_PASSWORD (+ anon key).$extra"
}

$tests = @(
  [pscustomobject]@{ Name = "github-connect-url"; Method = "POST"; Path = "/github-connect-url"; Body = "{}"; AllowedUnauth = @(200, 400, 401, 403); AllowedAuth = @(200, 400); RequiresAuth = $true },
  [pscustomobject]@{ Name = "github-app-callback"; Method = "POST"; Path = "/github-app-callback"; Body = "{}"; AllowedUnauth = @(405); AllowedAuth = @(405); RequiresAuth = $false },
  [pscustomobject]@{ Name = "github-prompt-sync"; Method = "POST"; Path = "/github-prompt-sync"; Body = "{}"; AllowedUnauth = @(200, 400, 401, 403); AllowedAuth = @(200, 400); RequiresAuth = $true },
  [pscustomobject]@{ Name = "transcript-flow-map"; Method = "POST"; Path = "/transcript-flow-map"; Body = "{}"; AllowedUnauth = @(200, 400, 401, 403); AllowedAuth = @(200, 400); RequiresAuth = $true },
  [pscustomobject]@{ Name = "flow-to-prompt"; Method = "POST"; Path = "/flow-to-prompt"; Body = "{}"; AllowedUnauth = @(200, 400, 401, 403); AllowedAuth = @(200, 400); RequiresAuth = $true },
  [pscustomobject]@{ Name = "prompt-repair-run"; Method = "POST"; Path = "/prompt-repair-run"; Body = "{}"; AllowedUnauth = @(200, 400, 401, 403); AllowedAuth = @(200, 400); RequiresAuth = $true },
  [pscustomobject]@{ Name = "apply-prompt-repair"; Method = "POST"; Path = "/apply-prompt-repair"; Body = "{}"; AllowedUnauth = @(200, 400, 401, 403); AllowedAuth = @(200, 400); RequiresAuth = $true }
)

$failures = @()
$results = @()

foreach ($test in $tests) {
  $optionsUrl = "$baseUrl$($test.Path)"
  $optionsResult = Invoke-EdgeRequest -Url $optionsUrl -Method "OPTIONS" -Headers $sharedHeaders
  $optionsPass = Expect-Status -Status $optionsResult.status -Allowed @(200, 204, 405)

  $requestHeaders = @{}
  foreach ($key in $sharedHeaders.Keys) {
    $requestHeaders[$key] = $sharedHeaders[$key]
  }
  $useAuthForRequest = $authEnabled -and $test.RequiresAuth
  if ($useAuthForRequest) {
    $requestHeaders["Authorization"] = "Bearer $resolvedAccessToken"
  }

  $allowedRequestStatuses = if ($useAuthForRequest) { $test.AllowedAuth } else { $test.AllowedUnauth }

  $reqResult = Invoke-EdgeRequest -Url $optionsUrl -Method $test.Method -Headers $requestHeaders -Body $test.Body
  $reqPass = Expect-Status -Status $reqResult.status -Allowed $allowedRequestStatuses

  $pass = $optionsPass -and $reqPass
  $results += [pscustomobject]@{
    Function = $test.Name
    AuthUsed = $useAuthForRequest
    OptionsStatus = $optionsResult.status
    RequestStatus = $reqResult.status
    Passed = $pass
    RequestError = $reqResult.error
  }

  if (-not $pass) {
    $failures += "$($test.Name): OPTIONS=$($optionsResult.status), $($test.Method)=$($reqResult.status), error=$($reqResult.error)"
  }
}

$results | Format-Table -AutoSize

if ($failures.Count -gt 0) {
  Write-Host ""
  Write-Host "Edge function smoke tests failed:" -ForegroundColor Red
  foreach ($failure in $failures) {
    Write-Host " - $failure" -ForegroundColor Red
  }
  exit 1
}

Write-Host ""
Write-Host "All edge function smoke tests passed." -ForegroundColor Green
