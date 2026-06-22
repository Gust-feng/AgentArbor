#requires -Version 5.1
param(
  [string]$SkillsRoot = ".agents/skills"
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path -LiteralPath $SkillsRoot -ErrorAction Stop
$failures = New-Object System.Collections.Generic.List[string]

function Add-Failure {
  param([string]$Message)
  $failures.Add($Message) | Out-Null
}

Get-ChildItem -LiteralPath $root -Directory | Sort-Object Name | ForEach-Object {
  $skillDir = $_
  $skillFile = Join-Path $skillDir.FullName "SKILL.md"
  if (-not (Test-Path -LiteralPath $skillFile)) {
    Add-Failure "$($skillDir.Name): missing SKILL.md"
    return
  }

  $raw = Get-Content -Raw -LiteralPath $skillFile
  $match = [regex]::Match($raw, "^\s*---\r?\n(?<frontmatter>.*?)\r?\n---\r?\n(?<body>.*)$", [System.Text.RegularExpressions.RegexOptions]::Singleline)
  if (-not $match.Success) {
    Add-Failure "$($skillDir.Name): missing YAML frontmatter"
    return
  }

  $frontmatter = $match.Groups["frontmatter"].Value
  $body = $match.Groups["body"].Value.Trim()
  $nameMatch = [regex]::Match($frontmatter, "(?m)^name:\s*['""]?(?<name>[a-z0-9-]+)['""]?\s*$")
  $descriptionMatch = [regex]::Match($frontmatter, "(?m)^description:\s*(?<description>.+?)\s*$")
  $allowedKeys = [System.Collections.Generic.HashSet[string]]::new([string[]]@(
    "name",
    "description",
    "license",
    "compatibility",
    "metadata",
    "allowed-tools"
  ))
  [regex]::Matches($frontmatter, "(?m)^(?<key>[A-Za-z0-9_-]+):") | ForEach-Object {
    $key = $_.Groups["key"].Value
    if (-not $allowedKeys.Contains($key)) {
      Add-Failure "$($skillDir.Name): unexpected frontmatter key '$key'"
    }
  }

  if (-not $nameMatch.Success) {
    Add-Failure "$($skillDir.Name): missing or invalid name"
  } else {
    $name = $nameMatch.Groups["name"].Value
    if ($name -ne $skillDir.Name) {
      Add-Failure "$($skillDir.Name): frontmatter name '$name' does not match directory"
    }
  }

  if (-not $descriptionMatch.Success -or $descriptionMatch.Groups["description"].Value.Trim().Length -eq 0) {
    Add-Failure "$($skillDir.Name): missing description"
  }

  if ($body.Length -eq 0) {
    Add-Failure "$($skillDir.Name): empty body"
  }
}

if ($failures.Count -gt 0) {
  $failures | ForEach-Object { Write-Error $_ }
  exit 1
}

Write-Output "OK: skill packages passed basic AgentArbor checks under $($root.Path)"
