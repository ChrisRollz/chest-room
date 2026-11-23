# /// script
# requires-python = ">=3.12"
# dependencies = []
# [tool.orcaslicer.plugin]
# name = "Chest Room"
# version = "0.1.1"
# description = "Fit cosplay torso armor to a measured torso or scan and open fitted plates in OrcaSlicer."
# ///
import base64
from contextlib import closing
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import struct
import subprocess
import sys
import tempfile
import uuid

import orca

PAGE = "__BUNDLED_ORCA_PAGE__"
LIMIT = 96 * 1024 * 1024
CHUNK = 384 * 1024


def check_id(key):
    if not isinstance(key, str) or not re.fullmatch(r"[0-9a-f]{32}|[0-9a-f]{64}", key):
        raise ValueError("Invalid library item.")
    return key


def open_in_orca(path):
    if sys.platform == "darwin":
        subprocess.run(["/usr/bin/open", "-b", "com.orcaslicer.OrcaSlicer", str(path)], check=True, timeout=15)
        return
    candidates = [os.environ.get("APPIMAGE"), sys.executable, shutil.which("orca-slicer")]
    if sys.platform == "win32":
        candidates.append(str(Path(os.environ.get("ProgramFiles", "C:/Program Files")) / "OrcaSlicer" / "orca-slicer.exe"))
    for exe in filter(None, candidates):
        if Path(exe).is_file() and re.fullmatch(r"orca-?slicer(?:[._-].*)?", Path(exe).name, re.I):
            subprocess.Popen([exe, str(path)])
            return
    raise OSError("Open the saved STL from Prepare.")


class ChestRoomPage(orca.pages.PagesPluginCapabilityBase):
    transfer = None

    def get_name(self):
        return "Chest Room"

    def get_ui(self):
        return PAGE

    def on_unload(self):
        self.cancel()

    def cancel(self):
        if self.transfer:
            handle = self.transfer["file"]
            handle.close()
            Path(handle.name).unlink(missing_ok=True)
            self.transfer = None

    def action(self, data, folder):
        action = data["type"]
        if action in ("list", "record"):
            with closing(sqlite3.connect(folder / "library.sqlite3")) as db, db:
                db.execute("CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, item TEXT NOT NULL)")
                db.execute("""CREATE UNIQUE INDEX IF NOT EXISTS fit_version ON records
                    (json_extract(item, '$.torso'), json_extract(item, '$.name'), json_extract(item, '$.version'))
                    WHERE json_extract(item, '$.kind') = 'fit'""")
                if action == "list":
                    return {"items": [json.loads(row[0]) for row in db.execute("SELECT item FROM records ORDER BY rowid DESC")]}
                item = data["item"]
                check_id(item["id"])
                if item["kind"] not in ("torso", "fit") or not isinstance(item["name"], str) or not 1 <= len(item["name"].strip()) <= 80:
                    raise ValueError("Choose a name of 1 to 80 characters.")
                encoded = json.dumps(item, allow_nan=False)
                if len(encoded) > 32768:
                    raise ValueError("This record is too large.")
                try:
                    db.execute("INSERT INTO records VALUES (?,?)", (item["id"], encoded))
                except sqlite3.IntegrityError as error:
                    raise ValueError("This record or fit version already exists. Choose a new version.") from error
                return {}
        blobs = folder / "meshes"
        blobs.mkdir(exist_ok=True)
        if action == "read":
            file = blobs / check_id(data["id"])
            size = file.stat().st_size
            off = data["offset"]
            if type(off) is not int or not 0 <= off < size or off % CHUNK:
                raise ValueError("Invalid read offset.")
            with file.open("rb") as source:
                source.seek(off)
                return {"size": size, "data": base64.b64encode(source.read(CHUNK)).decode("ascii")}
        if action == "begin":
            self.cancel()
            kind, size = data["mode"], data["size"]
            if kind not in ("library", "export", "reference") or type(size) is not int or not 0 < size <= LIMIT:
                raise ValueError("Choose an STL up to 96 MiB.")
            if kind == "library":
                dest = blobs / check_id(data["id"])
                if dest.exists():
                    if dest.stat().st_size != size:
                        raise ValueError("Stored mesh differs in size.")
                    return {"exists": True}
            else:
                name = re.sub(r"[^\w .-]", "_", str(data.get("name", "armor")))[:90].strip(" .") or "armor"
                dest = folder / (name + "-" + uuid.uuid4().hex[:12] + ".stl")
            self.transfer = {"file": tempfile.NamedTemporaryFile(dir=folder, delete=False),
                             "dest": dest, "size": size, "mode": kind, "hash": hashlib.sha256()}
            return {"exists": False}
        if not self.transfer:
            raise ValueError("Start the file transfer again.")
        t = self.transfer
        f = t["file"]
        if action == "chunk":
            encoded = data["data"]
            if not isinstance(encoded, str) or len(encoded) > 512*1024 or data["offset"] != f.tell():
                raise ValueError("File transfer interrupted.")
            chunk = base64.b64decode(encoded, validate=True)
            if not chunk or len(chunk) != min(CHUNK, t["size"]-f.tell()):
                raise ValueError("Invalid file chunk.")
            f.write(chunk)
            t["hash"].update(chunk)
            return {}
        if action != "finish" or f.tell() != t["size"]:
            raise ValueError("Incomplete file transfer.")
        dest = t["dest"]
        if t["mode"] == "library" and len(dest.name)==64 and t["hash"].hexdigest()!=dest.name:
            raise ValueError("File checksum mismatch.")
        if t["mode"] in ("export", "reference"):
            f.seek(80)
            if t["size"] < 134 or 84+struct.unpack("<I",f.read(4))[0]*50 != t["size"]:
                raise ValueError("Invalid fitted STL.")
        f.close()
        # The source and destination share a filesystem. Publish only a completed file.
        try:
            os.link(f.name, dest)
        except FileExistsError:
            if t["mode"] != "library":
                raise
        self.cancel()
        if t["mode"] == "reference":
            return {"path": str(dest)}
        if t["mode"] == "export":
            try:
                open_in_orca(dest)
            except (OSError, RuntimeError, subprocess.SubprocessError) as error:
                return {"path": str(dest), "opened": False, "reason": str(error)}
            return {"path": str(dest), "opened": True}
        return {}

    def on_message(self, data):
        try:
            folder = Path(orca.host.plugin.storage())
            folder.mkdir(parents=True, exist_ok=True)
            result = self.action(data, folder)
        except (KeyError, ValueError, TypeError, OSError, RuntimeError, sqlite3.Error, struct.error) as error:
            if data.get("type") in ("begin", "chunk", "finish"):
                self.cancel()
            result = {"error": str(error)}
        self.post_message({"request": data.get("request"), **result})


@orca.plugin
class ChestRoom(orca.base):
    def register_capabilities(self):
        orca.register_capability(ChestRoomPage)
