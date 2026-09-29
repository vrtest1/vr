#!/usr/bin/env python3
"""Serve only this package on loopback; no third-party Python modules required."""
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import threading
import webbrowser

root = Path(__file__).resolve().parent
handler = partial(SimpleHTTPRequestHandler, directory=str(root))
server = ThreadingHTTPServer(('127.0.0.1', 0), handler)
url = 'http://127.0.0.1:%d/' % server.server_port
print('EMBER: ' + url, flush=True)
print('Keep this window open. Press Ctrl+C to stop.', flush=True)
threading.Timer(0.6, lambda: webbrowser.open(url)).start()
try:
    server.serve_forever()
except KeyboardInterrupt:
    pass
finally:
    server.server_close()
