# NeuroSense 识别功能一键安装（Windows）
#   语音字幕 faster-whisper · 声音分类 torch + transformers · 鸟种 birdnetlib + tensorflow
#   做法：用 Python 3.12 在 backend\.venv 建独立环境（这些机器学习包对 Python 3.14 的支持还不完整），
#         装好后预先下载模型，第一次启动就能直接用。
#   用法：双击项目根目录的 install-ai.bat；网络不稳定（SSL 报错）时运行 install-ai.bat -Mirror 使用国内镜像。
param([switch]$Mirror)
$ErrorActionPreference = "Continue"
Set-Location $PSScriptRoot
function Step($t) { Write-Host ""; Write-Host "== $t ==" -ForegroundColor Cyan }

Step "1/5 查找 Python 3.12"
$pyver = $null
foreach ($v in @("3.12", "3.11")) {
  & py -$v -c "import sys" 2>$null
  if ($LASTEXITCODE -eq 0) { $pyver = $v; break }
}
if (-not $pyver) {
  Write-Host "没有找到 Python 3.12，尝试用 winget 自动安装…"
  winget install -e --id Python.Python.3.12 --accept-package-agreements --accept-source-agreements
  & py -3.12 -c "import sys" 2>$null
  if ($LASTEXITCODE -eq 0) { $pyver = "3.12" }
}
if (-not $pyver) {
  Write-Host "仍然找不到 Python 3.12。请到 https://www.python.org/downloads/release/python-3129/ 下载 Windows installer (64-bit)，" -ForegroundColor Yellow
  Write-Host "安装时勾选 'Add python.exe to PATH'，装好后重新运行 install-ai.bat。" -ForegroundColor Yellow
  exit 1
}
Write-Host "使用 Python $pyver"

Step "2/5 创建虚拟环境 backend\.venv"
if (-not (Test-Path ".venv\Scripts\python.exe")) { & py -$pyver -m venv .venv }
$vpy = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $vpy)) { Write-Host "虚拟环境创建失败" -ForegroundColor Red; exit 1 }

$pipArgs = @("--retries", "10", "--timeout", "120")
if ($Mirror) {
  $pipArgs += @("-i", "https://pypi.tuna.tsinghua.edu.cn/simple")
  $env:HF_ENDPOINT = "https://hf-mirror.com"
  setx HF_ENDPOINT "https://hf-mirror.com" | Out-Null
  Write-Host "已启用国内镜像：PyPI 清华源，模型 hf-mirror.com"
}

Step "3/5 安装基础依赖"
& $vpy -m pip install --upgrade pip @pipArgs
& $vpy -m pip install -r requirements.txt @pipArgs

Step "4/5 安装识别包（torch 约 200 MB，tensorflow 约 400 MB，请耐心等待）"
$ok = @{}
& $vpy -m pip install faster-whisper @pipArgs;          $ok["字幕 faster-whisper"] = ($LASTEXITCODE -eq 0)
& $vpy -m pip install torch transformers @pipArgs;      $ok["声音 torch + transformers"] = ($LASTEXITCODE -eq 0)
& $vpy -m pip install birdnetlib tensorflow @pipArgs;   $ok["鸟种 birdnetlib + tensorflow"] = ($LASTEXITCODE -eq 0)

Step "5/5 预先下载模型（Whisper base 约 150 MB，AudioSet 约 350 MB）"
& $vpy -c "from faster_whisper import WhisperModel; WhisperModel('base', device='cpu', compute_type='int8'); print('Whisper base: OK')"
$ok["字幕模型下载"] = ($LASTEXITCODE -eq 0)
& $vpy -c "from transformers import ASTForAudioClassification as M, AutoFeatureExtractor as F; n='MIT/ast-finetuned-audioset-10-10-0.4593'; F.from_pretrained(n); M.from_pretrained(n); print('AudioSet AST: OK')"
$ok["声音模型下载"] = ($LASTEXITCODE -eq 0)
& $vpy -c "from birdnetlib.analyzer import Analyzer; Analyzer(); print('BirdNET: OK')"
$ok["鸟种模型"] = ($LASTEXITCODE -eq 0)

Step "结果"
foreach ($k in $ok.Keys) {
  if ($ok[$k]) { Write-Host "  [成功] $k" -ForegroundColor Green } else { Write-Host "  [失败] $k" -ForegroundColor Red }
}
Write-Host ""
Write-Host "以后请用项目根目录的 start.bat 启动（会自动使用这个环境）。"
Write-Host "或手动：cd backend 后运行  .venv\Scripts\python server.py"
Write-Host "有失败项：网络问题可运行 install-ai.bat -Mirror 重试；其它错误请把上面的红字截图发给 Claude。"
