"""Bundle src/page.html into the single Python entry in src/. Run from any directory."""
from pathlib import Path
import re

root = Path(__file__).resolve().parent
source = root / "src"
output = root / "dist"
entry, = source.glob("*_any.py")

def inline(match):
    path = (source / match[1]).resolve()
    if not path.is_relative_to(source.resolve()):
        raise ValueError("Resource outside src: " + match[1])
    content = path.read_text(encoding="utf-8")
    if path.suffix == ".js":
        return "<script>" + re.sub("</script", lambda _: r"<\/script", content, flags=re.I) + "</script>"
    if path.suffix == ".css":
        return "<style>" + content + "</style>"
    raise ValueError("Unsupported inline resource: " + path.name)

page = re.sub(r"<!--\s*bundle:([^<>\s]+)\s*-->", inline, (source / "page.html").read_text(encoding="utf-8"))
notices = [(root / "LICENSE").read_text(), (source / "vendor" / "LICENSE").read_text()]
page = page.replace("</body>", "<!--\n" + "\n".join(notices) + "\n-->\n</body>")
host = entry.read_text(encoding="utf-8")
marker = '"__BUNDLED_ORCA_PAGE__"'
if host.count(marker) != 1:
    raise ValueError("Expected one page marker in " + entry.name)
host = host.replace(marker, repr(page))
compile(host, entry.name, "exec")
output.mkdir(exist_ok=True)
(output / "preview.html").write_text(page, encoding="utf-8")
(output / entry.name).write_text(host, encoding="utf-8")
