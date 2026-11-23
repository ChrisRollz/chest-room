function chestLibrary() {
  const native = window.orca,
    chunkSize = 384 * 1024,
    waiting = new Map();
  let seq = 0,
    connection;
  const uid = () =>
    Array.from(crypto.getRandomValues(new Uint8Array(16)), (n) =>
      n.toString(16).padStart(2, "0"),
    ).join("");
  if (native) native.onMessage((reply) => waiting.get(reply.request)?.(reply));
  function request(type, data = {}) {
    const request = ++seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        waiting.delete(request);
        reject(Error("Orca did not respond. Try the action again."));
      }, 45000);
      waiting.set(request, (r) => {
        clearTimeout(timer);
        waiting.delete(request);
        r.error ? reject(Error(r.error)) : resolve(r);
      });
      native.postMessage({ type, request, ...data });
    });
  }
  function db() {
    return (connection ??= new Promise((resolve, reject) => {
      const r = indexedDB.open("chest-room", 2);
      r.onupgradeneeded = (event) => {
        if (event.oldVersion === 0) {
          r.result.createObjectStore("meshes");
          r.result.createObjectStore("records", { keyPath: "id" });
        }
        r.transaction
          .objectStore("records")
          .createIndex("fitVersion", ["torso", "name", "version"], {
            unique: true,
          });
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    }));
  }
  async function query(table, mode, fn) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const tx = d.transaction(table, mode),
        r = fn(tx.objectStore(table));
      tx.oncomplete = () => resolve(r.result);
      tx.onabort = () =>
        reject(tx.error || Error("Library transaction failed."));
    });
  }
  function encode(bytes) {
    const array = new Uint8Array(bytes);
    let s = "";
    for (let i = 0; i < array.length; i += 16384)
      s += String.fromCharCode(...array.subarray(i, i + 16384));
    return btoa(s);
  }
  async function transfer(bytes, meta) {
    const started = await request("begin", { ...meta, size: bytes.byteLength });
    if (started.exists) return;
    for (let offset = 0; offset < bytes.byteLength; offset += chunkSize)
      await request("chunk", {
        offset,
        data: encode(bytes.slice(offset, offset + chunkSize)),
      });
    return request("finish");
  }
  async function store(asset) {
    if (asset.id) return asset.id;
    const id = crypto.subtle
      ? Array.from(
          new Uint8Array(await crypto.subtle.digest("SHA-256", asset.bytes)),
          (n) => n.toString(16).padStart(2, "0"),
        ).join("")
      : uid();
    if (native) await transfer(asset.bytes, { mode: "library", id });
    else await query("meshes", "readwrite", (s) => s.put(asset.bytes, id));
    asset.id = id;
    return id;
  }
  async function read(id) {
    if (!native) {
      const bytes = await query("meshes", "readonly", (s) => s.get(id));
      if (!bytes) throw Error("This mesh is missing from the library.");
      return bytes;
    }
    let bytes,
      offset = 0;
    do {
      const r = await request("read", { id, offset });
      bytes ??= new Uint8Array(r.size);
      const chunk = Uint8Array.from(atob(r.data), (c) => c.charCodeAt(0));
      if (chunk.length !== Math.min(chunkSize, bytes.length - offset))
        throw Error("Incomplete stored STL.");
      bytes.set(chunk, offset);
      offset += chunk.length;
    } while (offset < bytes.length);
    return bytes.buffer;
  }
  async function list() {
    return native
      ? (await request("list")).items
      : query("records", "readonly", (s) => s.getAll());
  }
  async function save(item) {
    if (native) await request("record", { item });
    else
      try {
        await query("records", "readwrite", (s) => s.add(item));
      } catch (error) {
        if (error.name === "ConstraintError")
          throw Error("That fit version already exists. Choose a new version.");
        throw error;
      }
  }
  async function send(bytes, name, mode = "export") {
    if (native) return transfer(bytes, { mode, name });
    const link = document.createElement("a");
    link.download = name + ".stl";
    link.href = URL.createObjectURL(new Blob([bytes]));
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 5000);
    return { download: true };
  }
  return { uid, store, read, list, save, send, native: !!native };
}
