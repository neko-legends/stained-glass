# Talk to the "MCP for Blender" add-on's local socket directly (same JSON protocol the MCP server uses).
import socket, json, sys
def call(type_, params=None, timeout=120):
    s = socket.create_connection(('127.0.0.1', 9876), timeout=timeout)
    s.sendall(json.dumps({'type': type_, 'params': params or {}}).encode())
    buf = b''
    while True:
        chunk = s.recv(65536)
        if not chunk: break
        buf += chunk
        try: return json.loads(buf.decode())
        except ValueError: continue
    return json.loads(buf.decode())
if __name__ == '__main__':
    t = sys.argv[1]
    p = {'code': open(sys.argv[2]).read()} if t == 'execute_code' else (json.loads(sys.argv[2]) if len(sys.argv) > 2 else {})
    print(json.dumps(call(t, p), indent=1)[:6000])
