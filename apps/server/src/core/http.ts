import http, { IncomingMessage, ServerResponse } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

export interface Request extends IncomingMessage {
  path: string;
  query: Record<string, string>;
  params: Record<string, string>;
  body: any;
  user?: any;
}

export interface Response extends ServerResponse {
  status(statusCode: number): this;
  json(data: any): void;
  send(data: any): void;
}

export type Handler = (req: Request, res: Response, next: (err?: any) => void) => Promise<void> | void;

interface Route {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handlers: Handler[];
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf'
};

export class Router {
  public routes: Route[] = [];
  public middlewares: { prefix: string; handlers: Handler[] }[] = [];

  private addRoute(method: string, pathStr: string, ...handlers: Handler[]): this {
    const paramNames: string[] = [];
    const normalizedPath = pathStr.replace(/\/+/g, '/').replace(/\/$/, '') || '/';

    const regexStr = '^' + normalizedPath
      .replace(/:([a-zA-Z0-9_]+)/g, (_match, paramName) => {
        paramNames.push(paramName);
        return '([^/]+)';
      }) + '$';

    this.routes.push({
      method: method.toUpperCase(),
      pattern: new RegExp(regexStr),
      paramNames,
      handlers
    });

    return this;
  }

  public get(pathStr: string, ...handlers: Handler[]): this {
    return this.addRoute('GET', pathStr, ...handlers);
  }

  public post(pathStr: string, ...handlers: Handler[]): this {
    return this.addRoute('POST', pathStr, ...handlers);
  }

  public put(pathStr: string, ...handlers: Handler[]): this {
    return this.addRoute('PUT', pathStr, ...handlers);
  }

  public patch(pathStr: string, ...handlers: Handler[]): this {
    return this.addRoute('PATCH', pathStr, ...handlers);
  }

  public delete(pathStr: string, ...handlers: Handler[]): this {
    return this.addRoute('DELETE', pathStr, ...handlers);
  }

  public use(prefixOrHandler: string | Handler | Router, ...handlersOrRouter: (Handler | Router)[]): this {
    if (typeof prefixOrHandler === 'string') {
      const prefix = prefixOrHandler.replace(/\/+/g, '/').replace(/\/$/, '');
      for (const item of handlersOrRouter) {
        if (item instanceof Router) {
          // Fusionar rutas con el prefijo
          for (const route of item.routes) {
            const nestedParamNames = [...route.paramNames];
            const routeRegex = route.pattern.source.replace(/^\^/, '').replace(/\$$/, '');
            const combinedRegex = new RegExp('^' + prefix + (routeRegex === '^/' ? '' : routeRegex) + '$');
            this.routes.push({
              method: route.method,
              pattern: combinedRegex,
              paramNames: nestedParamNames,
              handlers: route.handlers
            });
          }
        } else if (typeof item === 'function') {
          this.middlewares.push({ prefix, handlers: [item] });
        }
      }
    } else if (prefixOrHandler instanceof Router) {
      this.use('/', prefixOrHandler);
    } else if (typeof prefixOrHandler === 'function') {
      this.middlewares.push({ prefix: '', handlers: [prefixOrHandler, ...(handlersOrRouter as Handler[])] });
    }
    return this;
  }
}

export class ExpressApp extends Router {
  private server: http.Server | null = null;
  private staticDirs: string[] = [];
  private errorHandler: (err: Error, req: Request, res: Response, next?: any) => void = (err, _req, res) => {
    console.error('[HTTP Server Error]', err);
    res.status(500).json({ error: 'Error interno del servidor.', message: err.message });
  };

  public serveStatic(dirPath: string): this {
    if (fs.existsSync(dirPath)) {
      this.staticDirs.push(dirPath);
    }
    return this;
  }

  public setErrorHandler(handler: (err: Error, req: Request, res: Response, next?: any) => void): void {
    this.errorHandler = handler;
  }

  public listen(port: number | string, callback?: () => void): http.Server {
    this.server = http.createServer(async (rawReq, rawRes) => {
      const req = rawReq as Request;
      const res = rawRes as Response;

      // Decorar response
      res.status = function (statusCode: number) {
        res.statusCode = statusCode;
        return this;
      };

      res.json = function (data: any) {
        if (!res.headersSent) {
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
          res.setHeader('Pragma', 'no-cache');
          res.setHeader('Expires', '0');
          res.end(JSON.stringify(data, null, 2));
        }
      };

      res.send = function (data: any) {
        if (!res.headersSent) {
          res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
          res.setHeader('Pragma', 'no-cache');
          res.setHeader('Expires', '0');
          if (typeof data === 'object') {
            res.json(data);
          } else {
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.end(String(data));
          }
        }
      };

      // Headers de seguridad, No-Cache y CORS
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('X-XSS-Protection', '1; mode=block');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, apikey, X-Client-Id, X-Sync-Timestamp, Prefer');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');

      // Preflight OPTIONS
      if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        res.end();
        return;
      }

      // Parsear URL y Query usando el estándar WHATWG URL
      const fullUrl = new URL(req.url || '/', 'http://localhost');
      req.path = fullUrl.pathname.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
      
      const queryObj: Record<string, string> = {};
      fullUrl.searchParams.forEach((val, key) => {
        queryObj[key] = val;
      });
      req.query = queryObj;
      req.params = {};

      // 1. Manejo de Archivos Estáticos Frontend si es GET o HEAD
      if (['GET', 'HEAD'].includes(req.method || '') && !req.path.startsWith('/api/')) {
        for (const dir of this.staticDirs) {
          let relativeFilePath = req.path === '/' ? 'login.html' : req.path.replace(/^\//, '');
          let filePath = path.join(dir, relativeFilePath);

          if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            const ext = path.extname(filePath).toLowerCase();
            const contentType = MIME_TYPES[ext] || 'application/octet-stream';
            res.setHeader('Content-Type', contentType);
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
            if (req.method === 'HEAD') {
              res.end();
            } else {
              fs.createReadStream(filePath).pipe(res);
            }
            return;
          }

          // Intento fallback con .html
          if (!path.extname(filePath)) {
            const htmlPath = `${filePath}.html`;
            if (fs.existsSync(htmlPath) && fs.statSync(htmlPath).isFile()) {
              res.setHeader('Content-Type', 'text/html; charset=utf-8');
              res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
              res.setHeader('Pragma', 'no-cache');
              res.setHeader('Expires', '0');
              if (req.method === 'HEAD') {
                res.end();
              } else {
                fs.createReadStream(htmlPath).pipe(res);
              }
              return;
            }
          }
        }
      }

      // Parsear Body si es POST/PUT/PATCH
      if (['POST', 'PUT', 'PATCH'].includes(req.method || '')) {
        try {
          const buffers: Buffer[] = [];
          for await (const chunk of req) {
            buffers.push(Buffer.from(chunk));
          }
          const bodyStr = Buffer.concat(buffers).toString('utf-8');
          if (bodyStr) {
            try {
              req.body = JSON.parse(bodyStr);
            } catch {
              req.body = bodyStr;
            }
          } else {
            req.body = {};
          }
        } catch (err: any) {
          this.errorHandler(err, req, res);
          return;
        }
      } else {
        req.body = {};
      }

      // Encontrar ruta coincidente
      let matchedRoute: Route | null = null;
      const method = (req.method || 'GET').toUpperCase();

      for (const r of this.routes) {
        if (r.method === method) {
          const match = req.path.match(r.pattern);
          if (match) {
            matchedRoute = r;
            // Extraer params
            r.paramNames.forEach((name, idx) => {
              req.params[name] = decodeURIComponent(match[idx + 1]);
            });
            break;
          }
        }
      }

      if (!matchedRoute) {
        res.status(404).json({ error: `Ruta ${req.method} ${req.path} no encontrada.` });
        return;
      }

      // Ejecutar pipeline de handlers / middlewares para la ruta
      const handlers = [...matchedRoute.handlers];
      let handlerIdx = 0;

      const runNext = async (err?: any) => {
        if (err) {
          this.errorHandler(err instanceof Error ? err : new Error(String(err)), req, res);
          return;
        }

        if (handlerIdx < handlers.length) {
          const handler = handlers[handlerIdx++];
          try {
            await handler(req, res, runNext);
          } catch (handlerErr: any) {
            this.errorHandler(handlerErr instanceof Error ? handlerErr : new Error(String(handlerErr)), req, res);
          }
        }
      };

      await runNext();
    });

    const numericPort = typeof port === 'string' ? parseInt(port, 10) : port;
    this.server.listen(numericPort, '0.0.0.0', callback);
    return this.server;
  }
}

export function express(): ExpressApp {
  return new ExpressApp();
}

export const RouterFactory = (): Router => new Router();
