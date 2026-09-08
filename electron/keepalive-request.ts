import https from 'node:https';
import { URL } from 'node:url';

/**
 * An HTTPS request that keeps its socket audibly alive.
 *
 * Generation endpoints are synchronous and silent: the request goes out, the
 * model works for a minute or more, and not a byte crosses the connection until
 * the result is ready. NAT gateways, VPN exit nodes and corporate proxies drop
 * sessions that quiet for too long, and the client then sees the connection die
 * with no explanation. TCP keep-alive probes are real segments on the same
 * four-tuple, so they refresh that state while the wait continues.
 *
 * Neither the global `fetch` nor Electron's `net.fetch` exposes the socket, so
 * this path exists purely to reach `setKeepAlive`. Everything else in the app
 * keeps using fetch.
 */
export interface KeepAliveResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}

export interface KeepAliveOptions {
  method: string;
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
  /** Idle seconds before the OS sends a probe. Must sit under the shortest
   *  idle timeout on the path; 15s clears the common 30s and 60s rules. */
  keepAliveMs?: number;
  /** Called with each chunk as it arrives, for streamed responses. */
  onChunk?: (chunk: Buffer) => void;
}

export function keepAliveRequest(url: string, options: KeepAliveOptions): Promise<KeepAliveResponse> {
  const { method, headers, body, timeoutMs, keepAliveMs = 15_000, onChunk } = options;
  const target = new URL(url);

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    const req = https.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || 443,
        path: `${target.pathname}${target.search}`,
        method,
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
          onChunk?.(chunk);
        });
        res.on('end', () =>
          finish(() =>
            resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }),
          ),
        );
        res.on('error', (err) => finish(() => reject(err)));
      },
    );

    req.on('socket', (socket) => {
      // Set before the handshake completes so probes start with the connection.
      socket.setKeepAlive(true, keepAliveMs);
      socket.setNoDelay(true);
    });

    req.setTimeout(timeoutMs, () => {
      req.destroy(Object.assign(new Error('Request timed out'), { name: 'TimeoutError' }));
    });

    req.on('error', (err) => finish(() => reject(err)));
    if (body) req.write(body);
    req.end();
  });
}
