#!/bin/bash
# 双击本文件：会在本机启动预览，用浏览器打开下面显示的地址即可。
cd "$(dirname "$0")" || exit 1
PORT=8080
echo ""
echo "=========================================="
echo "  分镜审核台 — 本地预览已启动"
echo "=========================================="
echo ""
echo "  ① 打开 Chrome（或 Safari）"
echo "  ② 在地址栏输入下面这一行，然后回车："
echo ""
echo "     http://localhost:${PORT}"
echo ""
echo "  ③ 用完后回到这个窗口，按 Ctrl+C 停止"
echo ""
echo "=========================================="
echo ""
python3 -m http.server "${PORT}"
