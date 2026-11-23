"""Exercise the built plugin's storage and transport with an isolated host."""
import base64
import hashlib
from pathlib import Path
import runpy
import struct
import sys
import tempfile
from types import SimpleNamespace

package = Path(__file__).resolve().parents[1] / "dist"
with tempfile.TemporaryDirectory() as directory:
    registered = []
    sys.modules["orca"] = SimpleNamespace(
        pages=SimpleNamespace(PagesPluginCapabilityBase=object),
        base=object, plugin=lambda entry: entry, register_capability=registered.append,
        host=SimpleNamespace(plugin=SimpleNamespace(storage=lambda: directory))
    )
    module = runpy.run_path(str(package / "chest_room_any.py"))
    module["ChestRoom"]().register_capabilities()
    tab = registered[0]()
    assert tab.get_name() == "Chest Room"
    assert tab.get_ui() == (package / "preview.html").read_text()
    messages = []
    tab.post_message = messages.append

    def call(action, **data):
        tab.on_message(dict(type=action, request=34, **data))
        reply = messages.pop()
        assert reply.pop("request") == 34
        return reply

    def upload(data, **meta):
        response = call("begin", size=len(data), **meta)
        assert "error" not in response, response
        if response["exists"]:
            return response
        chunk = module["CHUNK"]
        for offset in range(0, len(data), chunk):
            encoded = base64.b64encode(data[offset:offset + chunk]).decode()
            assert call("chunk", offset=offset, data=encoded) == {}
        return call("finish")

    n = 9200
    stl = bytes(80) + struct.pack("<I", n) + bytes(50 * n)
    key = hashlib.sha256(stl).hexdigest()
    assert call("list") == {"items": []}
    assert "error" in call("read", id="../x", offset=0)
    assert upload(stl, mode="library", id=key) == {}
    assert upload(stl, mode="library", id=key) == {"exists": True}
    assert "error" in upload(stl, mode="library", id="e" * 64)
    assert not (Path(directory) / "meshes" / ("e" * 64)).exists()
    assert call("begin", mode="library", id="f" * 32, size=120) == {"exists": False}
    assert "error" in call("chunk", offset=1, data="AAAA")
    assert tab.transfer is None
    offsets = range(0, len(stl), module["CHUNK"])
    assert b"".join(base64.b64decode(call("read", id=key, offset=i)["data"]) for i in offsets) == stl
    item = dict(id="a" * 32, kind="torso", name="Demo")
    assert call("record", item=item) == {}
    assert "error" in call("record", item=item)
    assert call("list") == {"items": [item]}
    opened = []
    tab.action.__globals__["open_in_orca"] = opened.append
    result = upload(stl, mode="export", name="Test plate")
    assert result["opened"] and opened == [Path(result["path"])]
    assert opened[0].read_bytes() == stl

    reference = upload(stl, mode="reference", name="Shoulder reference")
    assert Path(reference["path"]).read_bytes() == stl and len(opened) == 1

    def unavailable(path):
        raise OSError("Test host handoff unavailable")
    tab.action.__globals__["open_in_orca"] = unavailable
    fallback = upload(stl, mode="export", name="Test plate")
    assert not fallback["opened"] and Path(fallback["path"]).read_bytes() == stl
    assert fallback["path"] != result["path"]
    tab.on_unload()
print("Passed page registration, independent library, chunk retry, checksums, cross-chunk reads and both handoff outcomes.")
