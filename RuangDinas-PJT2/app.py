"""Local SPPD budget app with SQLite employee and role/location tariff data."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs
import csv
import io
import json
import os
import re
import sqlite3

ROOT = Path(__file__).resolve().parent
DB_PATH = Path(os.environ.get("DB_PATH", str(ROOT / "sppd.db")))
EMPLOYEE_HEADERS = {"nik", "nama", "jabatan", "golongan", "unit_kerja"}
RATE_HEADERS = {"jenis_perjalanan", "jabatan", "lokasi", "uang_harian", "uang_transportasi"}
DAILY_IMPORT_PATH = "/api/daily-rates/import"
DAILY_IMPORT_TYPES = {
    DAILY_IMPORT_PATH: "Dalam Negeri",
    "/api/daily-rates/foreign/import": "Luar Negeri",
}
TRANSPORT_IMPORT_PATH = "/api/transport-rates/import"
DATABASE_URL_KEYS = ("DATABASE_URL", "POSTGRES_URL", "POSTGRES_PRISMA_URL", "NEON_DATABASE_URL")
HEADER_ALIASES = {
    "nik": "nik", "nama": "nama", "nama karyawan": "nama",
    "jabatan": "jabatan", "unit kerja": "unit_kerja", "unit_kerja": "unit_kerja",
    "divisi": "divisi", "uraian": "uraian", "jenis perjalanan": "jenis_perjalanan",
    "jenis_perjalanan": "jenis_perjalanan", "lokasi": "lokasi",
    "uang harian": "uang_harian", "uang_harian": "uang_harian",
    "uang transportasi": "uang_transportasi", "uang_transportasi": "uang_transportasi",
    "daerah tujuan": "daerah_tujuan", "daerah_tujuan": "daerah_tujuan",
    "uang diklat": "uang_diklat", "uang_diklat": "uang_diklat",
    "biaya diklat": "uang_diklat", "biaya_diklat": "uang_diklat",
}


def canonical_header(value):
    label = " ".join(str(value or "").replace("\ufeff", "").strip().lower().split())
    return HEADER_ALIASES.get(label, label.replace(" ", "_"))


def canonical_role(value):
    role = " ".join(str(value or "").strip().upper().split())
    match = re.fullmatch(r"BOD\s*[-_]?\s*([1-5])", role)
    return f"BOD-{match.group(1)}" if match else role


class CompatRow(dict):
    """Mapping row that also preserves sqlite-style numeric indexing."""
    def __getitem__(self, key):
        if isinstance(key, int):
            return tuple(self.values())[key]
        return super().__getitem__(key)


class PostgresCursor:
    def __init__(self, cursor):
        self.cursor = cursor

    def fetchone(self):
        row = self.cursor.fetchone()
        return CompatRow(row) if row is not None else None

    def fetchall(self):
        return [CompatRow(row) for row in self.cursor.fetchall()]


class DatabaseConnection:
    def __init__(self, raw, postgres=False):
        self.raw = raw
        self.postgres = postgres

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        try:
            if exc_type:
                self.raw.rollback()
            else:
                self.raw.commit()
        finally:
            self.raw.close()

    def execute(self, sql, params=()):
        if not self.postgres:
            return self.raw.execute(sql, params)
        cursor = self.raw.cursor()
        cursor.execute(sql.replace("?", "%s"), tuple(params))
        return PostgresCursor(cursor)


def configured_database_url():
    """Return the first supported PostgreSQL URL supplied by the host."""
    return next((os.environ.get(key, "").strip() for key in DATABASE_URL_KEYS
                 if os.environ.get(key, "").strip()), "")


def connect():
    database_url = configured_database_url()
    if database_url:
        import psycopg
        from psycopg.rows import dict_row
        if database_url.startswith("postgres://"):
            database_url = "postgresql://" + database_url[len("postgres://"):]
        return DatabaseConnection(psycopg.connect(database_url, row_factory=dict_row), postgres=True)
    if os.environ.get("VERCEL") == "1":
        if not DB_PATH.is_file():
            raise RuntimeError("Database SQLite bawaan sppd.db tidak ditemukan pada deployment Vercel.")
        db_uri = DB_PATH.resolve().as_uri() + "?mode=ro&immutable=1"
        db = sqlite3.connect(db_uri, uri=True)
        db.row_factory = sqlite3.Row
        return DatabaseConnection(db)
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    return DatabaseConnection(db)


def initialize():
    with connect() as db:
        db.execute("""CREATE TABLE IF NOT EXISTS employees (
            nik TEXT PRIMARY KEY,
            nama TEXT NOT NULL,
            jabatan TEXT NOT NULL DEFAULT '',
            golongan TEXT NOT NULL DEFAULT '',
            unit_kerja TEXT NOT NULL DEFAULT '',
            kategori_tarif TEXT NOT NULL DEFAULT '',
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )""")
        if configured_database_url():
            db.execute("ALTER TABLE employees ADD COLUMN IF NOT EXISTS divisi TEXT NOT NULL DEFAULT ''")
            db.execute("ALTER TABLE employees ADD COLUMN IF NOT EXISTS uraian TEXT NOT NULL DEFAULT ''")
        else:
            employee_columns = {row[1] for row in db.execute("PRAGMA table_info(employees)")}
            if "divisi" not in employee_columns:
                db.execute("ALTER TABLE employees ADD COLUMN divisi TEXT NOT NULL DEFAULT ''")
            if "uraian" not in employee_columns:
                db.execute("ALTER TABLE employees ADD COLUMN uraian TEXT NOT NULL DEFAULT ''")
        db.execute("""CREATE TABLE IF NOT EXISTS position_daily_rates (
            jabatan TEXT PRIMARY KEY,
            uang_harian INTEGER NOT NULL CHECK (uang_harian >= 0),
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )""")
        db.execute("""CREATE TABLE IF NOT EXISTS budget_rates (
            jabatan TEXT NOT NULL,
            lokasi TEXT NOT NULL,
            uang_harian INTEGER NOT NULL CHECK (uang_harian >= 0),
            uang_transportasi INTEGER NOT NULL CHECK (uang_transportasi >= 0),
            biaya_pelatihan_offline INTEGER NOT NULL CHECK (biaya_pelatihan_offline >= 0),
            biaya_pelatihan_online INTEGER NOT NULL CHECK (biaya_pelatihan_online >= 0),
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (jabatan, lokasi)
        )""")
        db.execute("""CREATE TABLE IF NOT EXISTS travel_rates (
            jenis_perjalanan TEXT NOT NULL,
            jabatan TEXT NOT NULL,
            lokasi TEXT NOT NULL,
            uang_harian INTEGER NOT NULL CHECK (uang_harian >= 0),
            uang_transportasi INTEGER NOT NULL CHECK (uang_transportasi >= 0),
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (jenis_perjalanan, jabatan, lokasi)
        )""")
        db.execute("""CREATE TABLE IF NOT EXISTS daily_allowances (
            jenis_perjalanan TEXT NOT NULL,
            jabatan TEXT NOT NULL,
            lokasi TEXT NOT NULL,
            uang_harian INTEGER NOT NULL CHECK (uang_harian >= 0),
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (jenis_perjalanan, jabatan, lokasi)
        )""")
        db.execute("""CREATE TABLE IF NOT EXISTS position_transport_rates (
            jabatan TEXT PRIMARY KEY,
            uang_transportasi INTEGER NOT NULL CHECK (uang_transportasi >= 0),
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )""")
        db.execute("""CREATE TABLE IF NOT EXISTS training_allowances (
            lokasi TEXT PRIMARY KEY,
            uang_diklat INTEGER NOT NULL CHECK (uang_diklat >= 0),
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )""")
        # Keep previously imported tariffs as domestic rates during schema upgrade.
        db.execute("""INSERT INTO travel_rates(jenis_perjalanan,jabatan,lokasi,uang_harian,uang_transportasi)
            SELECT 'Dalam Negeri',jabatan,lokasi,uang_harian,uang_transportasi FROM budget_rates WHERE 1=1
            ON CONFLICT(jenis_perjalanan,jabatan,lokasi) DO NOTHING""")
        if configured_database_url():
            import_bundled_database(db)


def parse_csv(raw):
    text = raw.decode("utf-8-sig")
    sample = text[:8192]
    try:
        delimiter = csv.Sniffer().sniff(sample, delimiters=",;\t|").delimiter
    except csv.Error:
        delimiter = ";" if sample.splitlines() and sample.splitlines()[0].count(";") > sample.splitlines()[0].count(",") else ","
    reader = csv.DictReader(io.StringIO(text), delimiter=delimiter)
    reader.fieldnames = [canonical_header(value) for value in (reader.fieldnames or [])]
    headers = set(reader.fieldnames)
    return reader, headers


def import_bundled_database(db):
    """Copy the bundled local SQLite data into PostgreSQL once per database."""
    if not DB_PATH.is_file():
        raise RuntimeError("File sppd.db tidak tersedia untuk menyiapkan database Vercel.")
    db.execute("""CREATE TABLE IF NOT EXISTS deployment_seed_imports (
        source TEXT PRIMARY KEY,
        imported_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )""")
    if db.execute("SELECT 1 FROM deployment_seed_imports WHERE source=?", ("sppd.db",)).fetchone():
        return

    tables = (
        "employees", "position_daily_rates", "budget_rates", "travel_rates",
        "daily_allowances", "position_transport_rates", "training_allowances",
    )
    with sqlite3.connect(DB_PATH) as source_db:
        source_db.row_factory = sqlite3.Row
        available = {row[0] for row in source_db.execute(
            "SELECT name FROM sqlite_master WHERE type='table'")}
        for table in tables:
            if table not in available:
                continue
            columns = [row[1] for row in source_db.execute(f"PRAGMA table_info({table})")]
            if not columns:
                continue
            column_sql = ",".join(columns)
            placeholders = ",".join("?" for _ in columns)
            insert_sql = (f"INSERT INTO {table} ({column_sql}) VALUES ({placeholders}) "
                          "ON CONFLICT DO NOTHING")
            for row in source_db.execute(f"SELECT {column_sql} FROM {table}"):
                db.execute(insert_sql, tuple(row[column] for column in columns))
    db.execute("INSERT INTO deployment_seed_imports(source) VALUES(?) ON CONFLICT DO NOTHING", ("sppd.db",))


def rupiah_integer(value, row_number, field):
    raw = str(value or "").strip().lower().replace("rp", "").replace(" ", "")
    normalized = raw.replace(".", "").replace(",", "")
    if not normalized.isdigit():
        raise ValueError(f"Nilai {field} di baris {row_number} harus berupa angka rupiah, misalnya 350000.")
    return int(normalized)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def send_html(self, html, status=200, headers=()):
        body = html.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "same-origin")
        for name, value in headers:
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(body)

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "same-origin")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'")
        self.send_header("Cache-Control", "no-store")
        if os.environ.get("APP_COOKIE_SECURE") == "1":
            self.send_header("Strict-Transport-Security", "max-age=31536000")
        super().end_headers()

    def read_csv_body(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length > 5_000_000:
            raise OverflowError("Berkas CSV maksimal 5 MB")
        return self.rfile.read(length)

    def do_GET(self):
        url = urlparse(self.path)
        if url.path == "/sppd.db" or url.path.startswith("/sppd.db-"):
            return self.send_json({"error": "Tidak ditemukan"}, 404)
        if url.path == "/api/health":
            with connect() as db:
                count = db.execute("SELECT COUNT(*) FROM employees").fetchone()[0]
            return self.send_json({"ok": True, "employees": count})
        if url.path == "/api/rates":
            with connect() as db:
                full_rows = db.execute("""SELECT jenis_perjalanan,jabatan,lokasi,uang_harian,uang_transportasi
                    FROM travel_rates""").fetchall()
                daily_rows = db.execute("""SELECT jenis_perjalanan,jabatan,lokasi,uang_harian
                    FROM daily_allowances""").fetchall()
                transport_rows = db.execute("""SELECT jabatan,uang_transportasi
                    FROM position_transport_rates""").fetchall()
                training_rows = db.execute("""SELECT lokasi,uang_diklat
                    FROM training_allowances""").fetchall()
            merged = {}
            for row in full_rows:
                item = dict(row)
                key = (item["jenis_perjalanan"], item["jabatan"], item["lokasi"])
                merged[key] = {**item, "transportasi_tersedia": True}
            for row in daily_rows:
                item = dict(row)
                key = (item["jenis_perjalanan"], item["jabatan"], item["lokasi"])
                if key in merged:
                    merged[key]["uang_harian"] = item["uang_harian"]
                else:
                    merged[key] = {**item, "uang_transportasi": 0, "transportasi_tersedia": False}
            transport_by_role = {row["jabatan"]: row["uang_transportasi"] for row in transport_rows}
            for item in merged.values():
                if re.fullmatch(r"BOD-[1-5]", canonical_role(item["jabatan"])):
                    item["uang_transportasi"] = 0
                    item["transportasi_tersedia"] = False
                    item["transportasi_manual"] = True
                elif item["jabatan"] in transport_by_role:
                    item["uang_transportasi"] = transport_by_role[item["jabatan"]]
                    item["transportasi_tersedia"] = True
            return self.send_json({
                "rates": sorted(merged.values(), key=lambda item: (item["jenis_perjalanan"], item["jabatan"], item["lokasi"])),
                "position_transport_rates": [dict(row) for row in transport_rows],
                "training_allowances": [dict(row) for row in training_rows],
                "database_mode": "PostgreSQL" if configured_database_url() else ("SQLite bawaan (baca saja)" if os.environ.get("VERCEL") == "1" else "SQLite lokal"),
            })
        if url.path == "/api/employees":
            query = parse_qs(url.query).get("q", [""])[0].strip()
            if len(query) < 2:
                return self.send_json({"employees": []})
            term = f"%{query}%"
            with connect() as db:
                rows = db.execute("""SELECT nik,nama,jabatan,golongan,unit_kerja,divisi,uraian,kategori_tarif
                    FROM employees WHERE LOWER(nik) LIKE LOWER(?) OR LOWER(nama) LIKE LOWER(?) OR LOWER(jabatan) LIKE LOWER(?)
                    ORDER BY nama LIMIT 20""", (term, term, term)).fetchall()
            return self.send_json({"employees": [dict(row) for row in rows]})
        return super().do_GET()

    def do_POST(self):
        path = urlparse(self.path).path
        origin = self.headers.get("Origin")
        if origin and urlparse(origin).netloc != self.headers.get("Host", ""):
            return self.send_json({"error": "Permintaan lintas situs ditolak."}, 403)
        if path not in {"/api/employees/import", "/api/rates/import", *DAILY_IMPORT_TYPES, TRANSPORT_IMPORT_PATH}:
            return self.send_json({"error": "Endpoint tidak ditemukan"}, 404)
        try:
            raw = self.read_csv_body()
            if path in DAILY_IMPORT_TYPES:
                text = raw.decode("utf-8-sig")
                sample = text[:8192]
                try:
                    delimiter = csv.Sniffer().sniff(sample, delimiters=",;\t|").delimiter
                except csv.Error:
                    delimiter = ";"
                table = list(csv.reader(io.StringIO(text), delimiter=delimiter))
                if len(table) < 3:
                    return self.send_json({"error": "CSV uang harian harus memiliki header jabatan dan minimal satu baris daerah."}, 400)
                role_columns = {}
                role_header_index = None
                for row_index, header_row in enumerate(table):
                    roles_in_row = {}
                    for index, value in enumerate(header_row):
                        role = canonical_role(value)
                        if re.fullmatch(r"BOD-[1-5]", role):
                            roles_in_row[index] = role
                    if roles_in_row:
                        role_columns = roles_in_row
                        role_header_index = row_index
                        break
                if not role_columns:
                    return self.send_json({"error": "Header CSV harus mencantumkan jabatan BOD-1 sampai BOD-5."}, 400)
                location_index = None
                for header_row in table[:role_header_index + 1]:
                    for index, value in enumerate(header_row):
                        if " ".join(value.strip().lower().split()) == "daerah tujuan":
                            location_index = index
                            break
                    if location_index is not None:
                        break
                if location_index is None:
                    return self.send_json({"error": "Kolom Daerah Tujuan tidak ditemukan di header CSV."}, 400)
                records = []
                for line, row in enumerate(table[role_header_index + 1:], start=role_header_index + 2):
                    location = row[location_index].strip() if len(row) > location_index else ""
                    if not location:
                        continue
                    for index, role in role_columns.items():
                        if index >= len(row) or not row[index].strip():
                            continue
                        try:
                            amount = rupiah_integer(row[index], line, "uang_harian")
                        except ValueError as error:
                            return self.send_json({"error": str(error)}, 400)
                        records.append((role, location, amount))
                with connect() as db:
                    for role, location, amount in records:
                        db.execute("""INSERT INTO daily_allowances(jenis_perjalanan,jabatan,lokasi,uang_harian,updated_at)
                            VALUES(?,?,?, ?,CURRENT_TIMESTAMP)
                            ON CONFLICT(jenis_perjalanan,jabatan,lokasi) DO UPDATE SET
                            uang_harian=excluded.uang_harian,updated_at=CURRENT_TIMESTAMP""",
                            (DAILY_IMPORT_TYPES[path], role, location, amount))
                return self.send_json({"imported": len(records), "skipped": 0})
            if path == TRANSPORT_IMPORT_PATH:
                text = raw.decode("utf-8-sig")
                sample = text[:8192]
                try:
                    delimiter = csv.Sniffer().sniff(sample, delimiters=",;\t|").delimiter
                except csv.Error:
                    delimiter = ";"
                table = list(csv.reader(io.StringIO(text), delimiter=delimiter))
                role_header_index = None
                role_columns = {}
                for row_index, header_row in enumerate(table):
                    roles_in_row = {}
                    for index, value in enumerate(header_row):
                        role = canonical_role(value)
                        if re.fullmatch(r"BOD-[1-5]", role):
                            roles_in_row[index] = role
                    if roles_in_row:
                        role_header_index, role_columns = row_index, roles_in_row
                        break
                if not role_columns:
                    return self.send_json({"error": "Header CSV biaya transportasi harus memuat jabatan BOD."}, 400)
                values_row = next((row for row in table[role_header_index + 1:] if any(cell.strip() for cell in row)), None)
                if values_row is None:
                    return self.send_json({"error": "Baris biaya transportasi tidak ditemukan."}, 400)
                records = []
                for index, role in role_columns.items():
                    if re.fullmatch(r"BOD-[1-5]", role) or index >= len(values_row) or not values_row[index].strip():
                        continue
                    try:
                        amount = rupiah_integer(values_row[index], role_header_index + 2, "uang_transportasi")
                    except ValueError as error:
                        return self.send_json({"error": str(error)}, 400)
                    records.append((role, amount))
                with connect() as db:
                    for role, amount in records:
                        db.execute("""INSERT INTO position_transport_rates(jabatan,uang_transportasi,updated_at)
                            VALUES(?,?,CURRENT_TIMESTAMP)
                            ON CONFLICT(jabatan) DO UPDATE SET uang_transportasi=excluded.uang_transportasi,
                            updated_at=CURRENT_TIMESTAMP""", (role, amount))
                return self.send_json({"imported": len(records), "skipped": len(role_columns) - len(records)})
            reader, headers = parse_csv(raw)
            required = EMPLOYEE_HEADERS if path == "/api/employees/import" else RATE_HEADERS
            if not required.issubset(headers):
                expected = ", ".join(sorted(required))
                return self.send_json({"error": f"Header CSV belum sesuai. Kolom wajib: {expected}."}, 400)
            records = []
            skipped = 0
            for line, row in enumerate(reader, start=2):
                record = {canonical_header(key): str(value or "").strip()
                          for key, value in row.items()}
                if path == "/api/employees/import":
                    if not record.get("nik") or not record.get("nama"):
                        skipped += 1
                        continue
                    record["jabatan"] = canonical_role(record.get("jabatan", ""))
                    records.append(record)
                else:
                    if not record.get("jabatan") or not record.get("lokasi"):
                        skipped += 1
                        continue
                    travel_type = record.get("jenis_perjalanan", "").strip().lower().replace("_", " ").replace("-", " ")
                    travel_type = " ".join(travel_type.split())
                    if travel_type in {"dalam negeri", "dn"}:
                        record["jenis_perjalanan"] = "Dalam Negeri"
                    elif travel_type in {"luar negeri", "ln"}:
                        record["jenis_perjalanan"] = "Luar Negeri"
                    else:
                        return self.send_json({"error": f"Jenis perjalanan di baris {line} harus Dalam Negeri atau Luar Negeri."}, 400)
                    try:
                        record["uang_harian"] = rupiah_integer(record.get("uang_harian"), line, "uang_harian")
                        record["uang_transportasi"] = rupiah_integer(record.get("uang_transportasi"), line, "uang_transportasi")
                    except ValueError as error:
                        return self.send_json({"error": str(error)}, 400)
                    record["biaya_pelatihan_online"] = 150000
                    records.append(record)

            with connect() as db:
                if path == "/api/employees/import":
                    for record in records:
                        db.execute("""INSERT INTO employees(nik,nama,jabatan,golongan,unit_kerja,kategori_tarif,divisi,uraian,updated_at)
                            VALUES(?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
                            ON CONFLICT(nik) DO UPDATE SET nama=excluded.nama,jabatan=excluded.jabatan,
                            golongan=excluded.golongan,unit_kerja=excluded.unit_kerja,
                            kategori_tarif=excluded.kategori_tarif,divisi=excluded.divisi,
                            uraian=excluded.uraian,updated_at=CURRENT_TIMESTAMP""",
                            (record["nik"], record["nama"], record.get("jabatan", ""),
                             record.get("golongan", ""), record.get("unit_kerja", ""),
                             record.get("kategori_tarif", ""), record.get("divisi", ""),
                             record.get("uraian", "")))
                else:
                    for record in records:
                        db.execute("""INSERT INTO travel_rates(jenis_perjalanan,jabatan,lokasi,uang_harian,uang_transportasi,updated_at)
                            VALUES(?,?,?,?,?,CURRENT_TIMESTAMP)
                            ON CONFLICT(jenis_perjalanan,jabatan,lokasi) DO UPDATE SET uang_harian=excluded.uang_harian,
                            uang_transportasi=excluded.uang_transportasi,
                            updated_at=CURRENT_TIMESTAMP""",
                            (record["jenis_perjalanan"], record["jabatan"], record["lokasi"],
                             record["uang_harian"], record["uang_transportasi"]))
            return self.send_json({"imported": len(records), "skipped": skipped})
        except OverflowError as error:
            return self.send_json({"error": str(error)}, 413)
        except (UnicodeDecodeError, csv.Error) as error:
            return self.send_json({"error": f"CSV tidak dapat dibaca: {error}"}, 400)

    def log_message(self, fmt, *args):
        request_line = args[0] if args else ""
        if isinstance(request_line, str) and request_line.startswith('"GET /api/employees?'):
            args = ('"GET /api/employees [query redacted] HTTP/1.1"', *args[1:])
        print("%s - %s" % (self.address_string(), fmt % args))


if __name__ == "__main__":
    initialize()
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "8000"))
    server = ThreadingHTTPServer((host, port), Handler)
    print(f"Ruang Dinas berjalan di http://127.0.0.1:{port}")
    print("Database karyawan dan tarif: " + str(DB_PATH))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer dihentikan.")
        server.server_close()
