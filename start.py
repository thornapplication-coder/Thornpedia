#!/usr/bin/env python3
"""Wissensarchiv – lokaler Start.

Startet einen kleinen Webserver für den aktuellen Ordner und oeffnet die App
im Standardbrowser. Wird ueber http://localhost ausgeliefert, damit Chrome/Edge
die File System Access API und den Service Worker erlauben (per file:// geht das
nicht).

Nutzung:
    python start.py            # Port 8000
    python start.py 8080       # eigener Port
Beenden mit Strg+C.
"""
import http.server
import socketserver
import sys
import webbrowser
import os

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
os.chdir(os.path.dirname(os.path.abspath(__file__)))


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".json": "application/json",
        ".webmanifest": "application/manifest+json",
        ".wasm": "application/wasm",
    }

    def end_headers(self):
        # Service-Worker darf den gesamten Scope kontrollieren; kein aggressives Caching im Dev.
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, *args):
        pass  # ruhige Ausgabe


def main():
    url = f"http://localhost:{PORT}/index.html"
    with socketserver.TCPServer(("127.0.0.1", PORT), Handler) as httpd:
        print("Wissensarchiv laeuft unter:")
        print(f"   {url}")
        print("Zum Beenden: Strg+C")
        try:
            webbrowser.open(url)
        except Exception:
            pass
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nBeendet.")


if __name__ == "__main__":
    main()
