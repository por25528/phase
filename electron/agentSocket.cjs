// The only door into the app from another process.
//
// A Unix domain socket, not a TCP port: there is no port to discover and no
// token to invent, because filesystem permissions (0600, inside userData) are
// the boundary. `net` and `fs` are injected so this module is testable
// without opening anything.
//
// Framing is newline-delimited JSON — one request per line, one response per
// line. Every connection gets an answer for every line, including malformed
// ones, so a client is never left waiting.

function createAgentSocket(deps) {
  const { socketPath, handle, net, fs } = deps;
  let server = null;

  function onConnection(conn) {
    let buffer = '';
    conn.setEncoding('utf8');
    conn.on('data', (chunk) => {
      buffer += chunk;
      let cut = buffer.indexOf('\n');
      while (cut !== -1) {
        const line = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 1);
        void answer(conn, line);
        cut = buffer.indexOf('\n');
      }
    });
    conn.on('error', () => { /* a client that hung up is not our problem */ });
  }

  async function answer(conn, line) {
    if (!line.trim()) return;
    let request;
    try {
      request = JSON.parse(line);
    } catch {
      conn.write(`${JSON.stringify({ ok: false, error: 'Malformed request.' })}\n`);
      return;
    }
    const response = await handle(request);
    conn.write(`${JSON.stringify(response)}\n`);
  }

  return {
    listen() {
      if (server) return;
      // A previous run that was killed rather than quit leaves the node
      // behind; binding would fail with EADDRINUSE.
      if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath);
      server = net.createServer(onConnection);
      server.on('error', () => { /* surfaced by the socket simply not existing */ });
      server.listen(socketPath, () => fs.chmodSync(socketPath, 0o600));
    },
    close() {
      if (!server) return;
      server.close();
      server = null;
      if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath);
    },
  };
}

module.exports = { createAgentSocket };
