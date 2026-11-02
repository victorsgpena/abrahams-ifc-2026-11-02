import http.server
import socketserver
import os
import sys
import webbrowser
import threading
import time

PORT = 8000
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

class BIMHttpHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        # Enable CORS and COOP/COEP for optimal WebAssembly execution
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def guess_type(self, path):
        if path.endswith('.wasm'):
            return 'application/wasm'
        if path.endswith('.js'):
            return 'application/javascript'
        if path.endswith('.ifc'):
            return 'application/octet-stream'
        if path.endswith('.json'):
            return 'application/json'
        return super().guess_type(path)

def open_browser():
    time.sleep(1)
    url = f"http://localhost:{PORT}/index.html"
    print(f"\n[BIM Viewer] Abriendo navegador en: {url}")
    webbrowser.open(url)

if __name__ == '__main__':
    os.chdir(DIRECTORY)
    # Allow address reuse to avoid 'Address already in use' error
    socketserver.TCPServer.allow_reuse_address = True
    
    # Try PORT, or PORT+1 if busy
    server = None
    for p in range(PORT, PORT + 10):
        try:
            server = socketserver.TCPServer(("", p), BIMHttpHandler)
            PORT = p
            break
        except OSError:
            continue

    if not server:
        print("[ERROR] No se pudo abrir un puerto libre.")
        sys.exit(1)

    print(f"============================================================")
    print(f"  VISOR IFC - ESTRUCTURAS STEEL FRAME & MODULACION HEBEL")
    print(f"============================================================")
    print(f"  Servidor local activo en: http://localhost:{PORT}")
    print(f"  Directorio: {DIRECTORY}")
    print(f"  Presiona Ctrl + C para detener el servidor")
    print(f"============================================================")

    threading.Thread(target=open_browser, daemon=True).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[INFO] Servidor detenido por el usuario.")
        server.server_close()
