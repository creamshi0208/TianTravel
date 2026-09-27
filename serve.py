#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
本地开发服务器：静态文件服务
================================

为什么需要它：`js/app.js` 用 `fetch('views/xxx.html')` 加载视图，
`file://` 协议下被浏览器 CORS 拦截，双击 index.html 会全站空白。
用 http://127.0.0.1 提供页面即可。

用法
----
  python serve.py                     （默认 http://127.0.0.1:8787）
  PORT=9000 python serve.py           （自定义端口）
  NO_OPEN=1 python serve.py           （不自动打开浏览器，由外部脚本控制）

浏览器打开 http://127.0.0.1:8787/index.html

地图：前端直接用高德 JS API（key 硬编码在 js/app.js），
     本服务器不涉及任何地图代理。
"""

import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get("PORT", "8787"))


class Handler(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def log_message(self, fmt, *args):
        sys.stderr.write("[serve] %s - %s\n" % (self.address_string(), fmt % args))


def main():
    print("[serve] 目录: %s" % ROOT)
    print("[serve] 端口: %d" % PORT)
    print("[serve] 打开: http://127.0.0.1:%d/index.html" % PORT)
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    if os.environ.get("NO_OPEN") != "1":
        try:
            import webbrowser
            webbrowser.open("http://127.0.0.1:%d/index.html" % PORT)
        except Exception:
            pass
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n[serve] bye")


if __name__ == "__main__":
    main()
