"""Vercel-compatible Flask entry point sharing the local app's API logic."""
from io import BytesIO
import os
from pathlib import Path

from flask import Flask, Response, abort, request, send_from_directory
from werkzeug.exceptions import HTTPException

import app as core

ROOT = Path(__file__).resolve().parent
PUBLIC = ROOT
app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 5_000_000
_database_initialized = False


class ApiHandler(core.Handler):
    """Small adapter that lets the existing CSV API run inside Flask."""
    def send_response(self, code, message=None):
        self.status_code = code

    def send_header(self, name, value):
        self.response_headers[name] = value

    def end_headers(self):
        pass


def dispatch_api():
    global _database_initialized
    path = request.path
    if request.method == "GET" and path not in {"/api/health", "/api/rates", "/api/employees"}:
        return {"error": "Endpoint tidak ditemukan"}, 404
    valid_posts = {
        "/api/employees/import", "/api/rates/import", "/api/daily-rates/import",
        "/api/daily-rates/foreign/import", "/api/transport-rates/import",
    }
    if request.method == "POST" and path not in valid_posts:
        return {"error": "Endpoint tidak ditemukan"}, 404
    if request.method not in {"GET", "POST"}:
        return {"error": "Metode tidak didukung"}, 405

    # Vercel's bundled SQLite database is read-only. Block CSV writes with a
    # clear response instead of allowing a confusing SQLite readonly error.
    if request.method == "POST" and os.environ.get("VERCEL") == "1" and not core.configured_database_url():
        return {
            "error": "Database di Vercel berjalan dalam mode baca saja tanpa PostgreSQL. Untuk menyimpan impor, perbarui sppd.db lalu deploy ulang, atau hubungkan PostgreSQL."
        }, 503

    if not _database_initialized:
        if core.configured_database_url():
            core.initialize()
        elif os.environ.get("VERCEL") == "1":
            if not core.DB_PATH.is_file():
                raise RuntimeError("Database sppd.db tidak tersedia pada deployment.")
            with core.connect() as db:
                db.execute("SELECT 1 FROM employees LIMIT 1")
        else:
            core.initialize()
        _database_initialized = True
    handler = object.__new__(ApiHandler)
    handler.path = request.full_path[:-1] if request.full_path.endswith("?") else request.full_path
    handler.command = request.method
    handler.headers = request.headers
    handler.rfile = BytesIO(request.get_data(cache=False))
    handler.wfile = BytesIO()
    handler.response_headers = {}
    handler.status_code = 200
    if request.method == "GET":
        core.Handler.do_GET(handler)
    else:
        core.Handler.do_POST(handler)
    response = Response(handler.wfile.getvalue(), status=handler.status_code)
    for name, value in handler.response_headers.items():
        response.headers[name] = value
    return response


@app.after_request
def security_headers(response):
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "same-origin")
    response.headers.setdefault(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; "
        "frame-ancestors 'none'; form-action 'self'",
    )
    response.headers.setdefault("Cache-Control", "no-store")
    return response


@app.route("/api", defaults={"path": ""}, methods=["GET", "POST", "OPTIONS"])
@app.route("/api/<path:path>", methods=["GET", "POST", "OPTIONS"])
def api(path):
    if request.method == "OPTIONS":
        return Response(status=204)
    return dispatch_api()


@app.route("/", methods=["GET"])
def home():
    return send_from_directory(PUBLIC, "index.html")


@app.route("/<path:filename>", methods=["GET"])
def assets(filename):
    if filename not in {"app.js", "style.css"}:
        abort(404)
    return send_from_directory(PUBLIC, filename)


@app.errorhandler(413)
def file_too_large(_error):
    return {"error": "Berkas CSV maksimal 5 MB"}, 413


@app.errorhandler(Exception)
def server_error(error):
    if isinstance(error, HTTPException):
        return error
    app.logger.exception("Request failed", exc_info=error)
    if os.environ.get("VERCEL") == "1" and not core.configured_database_url():
        return {
            "error": "Database SQLite bawaan tidak tersedia atau tidak dapat dibaca. Pastikan sppd.db ikut terunggah ke root proyek Vercel."
        }, 503
    return {
        "error": "Koneksi database gagal. Periksa DATABASE_URL di Vercel: pastikan memakai connection string PostgreSQL yang benar dan tersedia untuk environment deployment ini."
    }, 503
