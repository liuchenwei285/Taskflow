#!/usr/bin/env bash
# ============================================================
# Taskflow APK 构建脚本（纯命令行，无需 Gradle）
#
# aapt2 / javac / d8 / zipalign / apksigner 都是原生 Windows 程序，
# 不认 MSYS 的 /c/... 路径，因此统一用 w() 转成 Windows 路径。
# ============================================================
set -euo pipefail

ROOT="/c/Users/Alfred Liu/android-build"
JDK="$ROOT/tools/jdk-17.0.20.1+1"
SDK="$ROOT/sdk"
BT="$SDK/build-tools/34.0.0"
PLATFORM="$SDK/platforms/android-34/android.jar"

APP="$ROOT/app"
OUT="$ROOT/build"
DIST="$ROOT/dist"
KS="$ROOT/keystore/taskflow.jks"
KS_PASS="taskflow2026"
KS_ALIAS="taskflow"
APK_NAME="taskflow-v2.6.1.apk"

# MSYS 路径 -> Windows 路径（正斜杠即可被原生程序接受）
# 相对路径没有 /c/ 前缀，需先补全为绝对路径再转换。
w() {
  case "$1" in
    /*) printf '%s' "$1" | sed -e 's|^/\([a-zA-Z]\)/|\1:/|' ;;
    *)  printf '%s' "$PWD/$1" | sed -e 's|^/\([a-zA-Z]\)/|\1:/|' ;;
  esac
}

# 人类可读的文件大小。不用 ls|awk：用户名含空格会串列。
sz() { du -h "$1" 2>/dev/null | cut -f1 | tr -d ' '; }

export JAVA_HOME="$(w "$JDK")"
export ANDROID_HOME="$(w "$SDK")"
export ANDROID_SDK_ROOT="$ANDROID_HOME"

rm -rf "$OUT"
mkdir -p "$OUT/res-compiled" "$OUT/gen" "$OUT/classes" "$OUT/dex" "$OUT/pkg" "$DIST"

BT_W="$(w "$BT")"
PLATFORM_W="$(w "$PLATFORM")"
APP_W="$(w "$APP")"
OUT_W="$(w "$OUT")"

echo "=============================================="
echo "[1/7] 编译资源 (aapt2 compile)"
echo "=============================================="
"$BT/aapt2.exe" compile \
  --dir "$APP_W/src/main/res" \
  -o "$OUT_W/res-compiled/res.zip"
echo "  完成: $(sz "$OUT/res-compiled/res.zip")"

echo "=============================================="
echo "[2/7] 链接资源 + 生成 R.java (aapt2 link)"
echo "=============================================="
"$BT/aapt2.exe" link \
  -o "$OUT_W/base.apk" \
  -I "$PLATFORM_W" \
  --manifest "$APP_W/src/main/AndroidManifest.xml" \
  -R "$OUT_W/res-compiled/res.zip" \
  --java "$OUT_W/gen" \
  --min-sdk-version 24 \
  --target-sdk-version 34 \
  --version-code 19 \
  --version-name "2.6.1" \
  --auto-add-overlay
echo "  R.java: $(find "$OUT/gen" -name R.java | head -1)"
echo "  base.apk: $(sz "$OUT/base.apk")"

echo "=============================================="
echo "[3/7] 编译 Java 源码 (javac)"
echo "=============================================="
# 路径含空格，必须用 @argfile 传参，否则 "Alfred Liu" 会被拆成两个参数
find "$APP/src/main/java" "$OUT/gen" -name "*.java" \
  | while read -r f; do printf '"%s"\n' "$(w "$f")"; done > "$OUT/sources.txt"
sed 's|.*/java/|    |' "$OUT/sources.txt"
"$JDK/bin/javac.exe" \
  -source 8 -target 8 \
  -bootclasspath "$PLATFORM_W" \
  -classpath "$PLATFORM_W" \
  -encoding UTF-8 \
  -nowarn \
  -d "$(w "$OUT/classes")" \
  "@$(w "$OUT/sources.txt")" 2>&1 | grep -v "bootstrap class path" || true
echo "  已编译: $(find "$OUT/classes" -name '*.class' | wc -l) 个 class"

echo "=============================================="
echo "[4/7] 转成 DEX (d8)"
echo "=============================================="
# 不用 d8.bat：批处理的参数传递无法安全处理含空格的路径
# （%1 展开后 "C:\Users\Alfred Liu\..." 会被 cmd 当两个参数）。
# 直接调 d8.jar，java.exe 能正确接收带引号的参数。
D8_JAR="$BT/lib/d8.jar"
[ -f "$D8_JAR" ] || D8_JAR="$BT/d8.jar"

# 交给 d8 的文件列表用 @argfile，每行一个路径，避免空格拆分
find "$OUT/classes" -name "*.class" \
  | while read -r f; do printf '%s\n' "$(w "$f")"; done > "$OUT/classes.txt"

"$JDK/bin/java.exe" -Xmx1024M -cp "$(w "$D8_JAR")" com.android.tools.r8.D8 \
  --lib "$PLATFORM_W" \
  --min-api 21 \
  --output "$(w "$OUT/dex")" \
  "@$(w "$OUT/classes.txt")" 2>&1 | tail -5
ls -lh "$OUT/dex/" | tail -n +2 | sed 's/^/    /'

echo "=============================================="
echo "[5/7] 打包 assets + dex 进 APK"
echo "=============================================="
PY="C:/Users/Alfred Liu/.workbuddy/binaries/python/versions/3.13.12/python.exe"
"$PY" "$(w "$ROOT/inject_apk.py")"
echo "  合并后未签名 APK: $(sz "$OUT/merged.apk")"

echo "=============================================="
echo "[6/7] 对齐 (zipalign)"
echo "=============================================="
"$BT/zipalign.exe" -p -f 4 "$(w "$OUT/merged.apk")" "$(w "$OUT/aligned.apk")"
echo "  已对齐: $(sz "$OUT/aligned.apk")"

echo "=============================================="
echo "[7/7] 签名 (apksigner)"
echo "=============================================="
mkdir -p "$ROOT/keystore"
if [ ! -f "$KS" ]; then
  echo "  生成 keystore（有效期 30 年）..."
  "$JDK/bin/keytool.exe" -genkeypair \
    -keystore "$(w "$KS")" \
    -alias "$KS_ALIAS" \
    -keyalg RSA -keysize 2048 -validity 10950 \
    -storepass "$KS_PASS" -keypass "$KS_PASS" \
    -dname "CN=Taskflow, OU=App, O=Taskflow, L=Shenzhen, ST=Guangdong, C=CN" \
    -storetype JKS 2>&1 | tail -2
fi

# 同样绕过 apksigner.bat（同 .bat 引号问题），直接跑 apksigner.jar
AS_JAR="$BT/lib/apksigner.jar"
run_apksigner() {
  "$JDK/bin/java.exe" -Xmx512M -jar "$(w "$AS_JAR")" "$@"
}

run_apksigner sign \
  --ks "$(w "$KS")" \
  --ks-key-alias "$KS_ALIAS" \
  --ks-pass "pass:$KS_PASS" \
  --key-pass "pass:$KS_PASS" \
  --out "$(w "$DIST/$APK_NAME")" \
  "$(w "$OUT/aligned.apk")"

echo "  签名校验:"
run_apksigner verify --verbose --print-certs "$(w "$DIST/$APK_NAME")" 2>&1 | head -16

echo ""
echo "=============================================="
echo "构建完成"
echo "=============================================="
echo "----------------------------------------------"
echo "  产物: $DIST/$APK_NAME"
echo "  大小: $(sz "$DIST/$APK_NAME")"
echo "----------------------------------------------"
