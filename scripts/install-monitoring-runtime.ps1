param([switch]$Apply, [switch]$Remove)
$ErrorActionPreference = 'Stop'
$projectPath = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$null = Get-Command node -ErrorAction Stop
$taskExecutable = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$taskName = 'Administrativo CD - Importador'
$runtimeScript = Join-Path $PSScriptRoot 'start-monitoring-runtime.ps1'
$arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -File "' + $runtimeScript + '"'
$existingTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existingTask -and ($existingTask.Actions.Execute -ne $taskExecutable -or $existingTask.Actions.Arguments -ne $arguments)) { throw 'Existe uma tarefa com esse nome apontando para outro projeto. Nenhuma alteracao realizada.' }
if (-not $Apply) { [pscustomobject]@{ TaskName = $taskName; Action = $(if ($Remove) {'Remover'} else {'Instalar'}); Executable = $taskExecutable; Arguments = $arguments; Trigger = 'Logon do usuario atual'; Applied = $false }; exit 0 }
if ($Remove) { if ($existingTask) { $runtimeFolder = Join-Path $projectPath '.monitoring-worker\runtime'; New-Item -ItemType Directory -Path $runtimeFolder -Force | Out-Null; Set-Content -LiteralPath (Join-Path $runtimeFolder 'stop.request') -Value 'stop'; Start-Sleep -Seconds 15; Stop-ScheduledTask -TaskName $taskName; Unregister-ScheduledTask -TaskName $taskName -Confirm:$false }; exit 0 }
foreach ($file in @('monitoramento.local.json', '.env.local', 'node_modules\next\dist\bin\next')) { if (-not (Test-Path -LiteralPath (Join-Path $projectPath $file))) { throw "Arquivo local necessário ausente: $file" } }
$userName = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$taskAction = New-ScheduledTaskAction -Execute $taskExecutable -Argument $arguments -WorkingDirectory $projectPath
$taskTrigger = New-ScheduledTaskTrigger -AtLogOn -User $userName
$taskPrincipal = New-ScheduledTaskPrincipal -UserId $userName -LogonType Interactive -RunLevel Limited
$taskSettings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -Hidden
Register-ScheduledTask -TaskName $taskName -Action $taskAction -Trigger $taskTrigger -Principal $taskPrincipal -Settings $taskSettings -Description 'Importador local do Administrativo CD. Requer usuário conectado e computador ligado. Reinicia somente seus próprios processos.' -Force | Select-Object TaskName, State
Start-ScheduledTask -TaskName $taskName
