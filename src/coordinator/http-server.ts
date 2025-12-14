/**
 * Sparkle Protocol - Coordinator HTTP Server
 *
 * REST API layer for the coordinator service.
 * Provides endpoints for swap management, inscription listing, and health checks.
 *
 * @module sparkle-protocol/coordinator/http
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { URL } from 'url';

// Types
export interface SwapListItem {
  id: string;
  inscriptionId: string;
  priceSats: string;
  status: string;
  sellerPubkey: string;
  createdAt: number;
  expiresAt: number;
}

export interface CreateSwapRequest {
  inscriptionId: string;
  priceSats: string;
  sellerPubkey: string;
  sellerBitcoinAddress: string;
  durationMs?: number;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: number;
}

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  uptime: number;
  version: string;
  activeSwaps: number;
  completedSwaps: number;
}

// Rate limiting
interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const rateLimits = new Map<string, RateLimitEntry>();
const RATE_LIMIT_WINDOW_MS = 60000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 100;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimits.get(ip);

  if (!entry || entry.resetAt < now) {
    rateLimits.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }

  if (entry.count >= RATE_LIMIT_MAX_REQUESTS) {
    return false;
  }

  entry.count++;
  return true;
}

// Clean up old rate limit entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimits.entries()) {
    if (entry.resetAt < now) {
      rateLimits.delete(ip);
    }
  }
}, RATE_LIMIT_WINDOW_MS);

// HTTP utilities
function sendJson<T>(res: ServerResponse, statusCode: number, data: ApiResponse<T>): void {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  });
  res.end(JSON.stringify(data));
}

function parseBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function getClientIP(req: IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

// Coordinator HTTP Server
export interface CoordinatorHttpServerConfig {
  port: number;
  getSwaps: () => SwapListItem[];
  getSwapById: (id: string) => SwapListItem | undefined;
  createSwap: (req: CreateSwapRequest) => SwapListItem;
  getStats: () => { activeSwaps: number; completedSwaps: number };
}

export class CoordinatorHttpServer {
  private server: ReturnType<typeof createServer> | null = null;
  private config: CoordinatorHttpServerConfig;
  private startTime: number = Date.now();

  constructor(config: CoordinatorHttpServerConfig) {
    this.config = config;
  }

  start(): void {
    this.server = createServer(async (req, res) => {
      const ip = getClientIP(req);

      // Rate limiting
      if (!checkRateLimit(ip)) {
        sendJson(res, 429, {
          success: false,
          error: 'Too many requests',
          timestamp: Date.now(),
        });
        return;
      }

      // CORS preflight
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        });
        res.end();
        return;
      }

      try {
        const url = new URL(req.url || '/', `http://${req.headers.host}`);
        await this.handleRequest(req, res, url);
      } catch (error) {
        console.error('HTTP Error:', error);
        sendJson(res, 500, {
          success: false,
          error: 'Internal server error',
          timestamp: Date.now(),
        });
      }
    });

    this.server.listen(this.config.port, () => {
      console.log(`Coordinator HTTP server listening on port ${this.config.port}`);
    });
  }

  stop(): void {
    this.server?.close();
    this.server = null;
  }

  private async handleRequest(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL
  ): Promise<void> {
    const path = url.pathname;
    const method = req.method || 'GET';

    // Health check
    if (path === '/health' && method === 'GET') {
      return this.handleHealth(res);
    }

    // API routes
    if (path.startsWith('/api/')) {
      const apiPath = path.substring(4); // Remove '/api'

      // GET /api/swaps - List all active swaps
      if (apiPath === '/swaps' && method === 'GET') {
        return this.handleListSwaps(res, url);
      }

      // GET /api/swaps/:id - Get swap by ID
      const swapMatch = apiPath.match(/^\/swaps\/([a-zA-Z0-9-]+)$/);
      if (swapMatch && method === 'GET') {
        return this.handleGetSwap(res, swapMatch[1]);
      }

      // POST /api/swaps - Create new swap
      if (apiPath === '/swaps' && method === 'POST') {
        return this.handleCreateSwap(req, res);
      }

      // GET /api/stats - Get coordinator statistics
      if (apiPath === '/stats' && method === 'GET') {
        return this.handleStats(res);
      }
    }

    // 404 Not Found
    sendJson(res, 404, {
      success: false,
      error: 'Not found',
      timestamp: Date.now(),
    });
  }

  private handleHealth(res: ServerResponse): void {
    const stats = this.config.getStats();
    const health: HealthStatus = {
      status: 'healthy',
      uptime: Date.now() - this.startTime,
      version: '1.0.0',
      activeSwaps: stats.activeSwaps,
      completedSwaps: stats.completedSwaps,
    };

    sendJson(res, 200, {
      success: true,
      data: health,
      timestamp: Date.now(),
    });
  }

  private handleListSwaps(res: ServerResponse, url: URL): void {
    const swaps = this.config.getSwaps();

    // Filter by status if provided
    const statusFilter = url.searchParams.get('status');
    const filteredSwaps = statusFilter
      ? swaps.filter(s => s.status === statusFilter)
      : swaps;

    // Pagination
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100);
    const offset = parseInt(url.searchParams.get('offset') || '0');
    const paginatedSwaps = filteredSwaps.slice(offset, offset + limit);

    sendJson(res, 200, {
      success: true,
      data: {
        swaps: paginatedSwaps,
        total: filteredSwaps.length,
        limit,
        offset,
      },
      timestamp: Date.now(),
    });
  }

  private handleGetSwap(res: ServerResponse, id: string): void {
    const swap = this.config.getSwapById(id);

    if (!swap) {
      sendJson(res, 404, {
        success: false,
        error: 'Swap not found',
        timestamp: Date.now(),
      });
      return;
    }

    sendJson(res, 200, {
      success: true,
      data: swap,
      timestamp: Date.now(),
    });
  }

  private async handleCreateSwap(
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    try {
      const body = await parseBody(req) as CreateSwapRequest;

      // Validation
      if (!body.inscriptionId || !body.priceSats || !body.sellerPubkey) {
        sendJson(res, 400, {
          success: false,
          error: 'Missing required fields: inscriptionId, priceSats, sellerPubkey',
          timestamp: Date.now(),
        });
        return;
      }

      // Validate price
      const priceSats = BigInt(body.priceSats);
      if (priceSats < 1000n || priceSats > 100000000000n) {
        sendJson(res, 400, {
          success: false,
          error: 'Price must be between 1000 and 100000000000 sats',
          timestamp: Date.now(),
        });
        return;
      }

      const swap = this.config.createSwap(body);

      sendJson(res, 201, {
        success: true,
        data: swap,
        timestamp: Date.now(),
      });
    } catch (error) {
      sendJson(res, 400, {
        success: false,
        error: error instanceof Error ? error.message : 'Invalid request',
        timestamp: Date.now(),
      });
    }
  }

  private handleStats(res: ServerResponse): void {
    const stats = this.config.getStats();

    sendJson(res, 200, {
      success: true,
      data: {
        ...stats,
        uptime: Date.now() - this.startTime,
        version: '1.0.0',
      },
      timestamp: Date.now(),
    });
  }
}

// Factory function
export function createCoordinatorHttpServer(
  config: CoordinatorHttpServerConfig
): CoordinatorHttpServer {
  return new CoordinatorHttpServer(config);
}
