# Anade o quita la carpeta del lanzador `mage` del PATH del USUARIO (U9). Lo llama el instalador NSIS de Mage.
# Lee y escribe el valor del registro SIN expandir (%USERPROFILE%... se conservan tal cual) y como REG_EXPAND_SZ;
# compara sin distinguir mayusculas ni la barra final. Avisar a Windows del cambio (WM_SETTINGCHANGE) lo hace NSIS.
param(
  [ValidateSet('add', 'remove')][string]$Action,
  [string]$Directory
)

# Puro: el PATH nuevo a partir del actual. Quita las entradas vacias y cualquier copia previa de la carpeta.
function Update-PathValue([string]$Current, [string]$Target, [string]$Mode) {
  $normalized = $Target.TrimEnd('\')
  $others = @(($Current -split ';') | Where-Object { $_ -ne '' -and $_.TrimEnd('\') -ine $normalized })
  if ($Mode -eq 'add') { $others = @($others + $normalized) }
  return ($others -join ';')
}

if ($Action -eq '') { return }
if ($Directory -eq '') { throw "Falta -Directory (accion: $Action)" }
$ErrorActionPreference = 'Stop'
$key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment')
try {
  $current = [string]$key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
  $next = Update-PathValue $current $Directory $Action
  if ($next -eq '') { $key.DeleteValue('Path', $false) }
  else { $key.SetValue('Path', $next, [Microsoft.Win32.RegistryValueKind]::ExpandString) }
} finally {
  $key.Close()
}
