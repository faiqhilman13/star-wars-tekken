"""Run Python in the live Blender session (the "MCP for Blender" add-on socket on :9876).

Usage:
  python tools/blender/bl.py path/to/script.py [--arg key=value ...]
  python tools/blender/bl.py -c "import bpy; print(bpy.app.version_string)"

The script runs inside Blender with `ARGS` (dict of --arg values) and `REPO` (repo root path)
predefined. stdout is captured and printed here. Exit code 1 on error.
"""
import json
import os
import socket
import sys

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def send(code: str, timeout: float = 900.0) -> dict:
    s = socket.create_connection(("127.0.0.1", 9876), timeout=timeout)
    s.sendall(json.dumps({"type": "execute_code", "params": {"code": code}}).encode())
    buf = b""
    while True:
        chunk = s.recv(1 << 20)
        if not chunk:
            break
        buf += chunk
        try:
            return json.loads(buf.decode())
        except ValueError:
            continue
    return json.loads(buf.decode())


def main() -> int:
    argv = sys.argv[1:]
    args = {}
    code = None
    path = None
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "-c":
            code = argv[i + 1]
            i += 2
        elif a == "--arg":
            k, v = argv[i + 1].split("=", 1)
            args[k] = v
            i += 2
        else:
            path = a
            i += 1
    if path:
        with open(path, encoding="utf-8") as fh:
            code = fh.read()
        args.setdefault("__file__", os.path.abspath(path))
    if code is None:
        print(__doc__)
        return 2
    prelude = f"ARGS = {json.dumps(args)}\nREPO = {json.dumps(REPO.replace(os.sep, '/'))}\n"
    # Wrap so tracebacks come back as text instead of a bare error.
    wrapped = prelude + "import traceback as _tb\ntry:\n    exec(compile(" + json.dumps(code) + ", " + json.dumps(path or "<cmd>") + ", 'exec'), globals())\nexcept Exception:\n    print('BL_ERROR'); print(_tb.format_exc())\n"
    res = send(wrapped)
    out = ""
    if res.get("status") == "success":
        out = (res.get("result") or {}).get("result", "")
    else:
        out = json.dumps(res)
    print(out, end="" if out.endswith("\n") else "\n")
    return 1 if ("BL_ERROR" in out or res.get("status") != "success") else 0


if __name__ == "__main__":
    sys.exit(main())
