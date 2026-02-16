/**
 * Router — Simple hash-based SPA router.
 */

export type RouteHandler = (params: Record<string, string>) => void;

interface Route {
  pattern: RegExp;
  keys: string[];
  handler: RouteHandler;
}

class Router {
  private routes: Route[] = [];
  private defaultHandler: RouteHandler = () => {};

  /** Register a route pattern like '/project/:id/editor/:nodeId' */
  on(path: string, handler: RouteHandler): this {
    const keys: string[] = [];
    const pattern = path.replace(/:(\w+)/g, (_m, key) => {
      keys.push(key);
      return '([^/]+)';
    });
    this.routes.push({ pattern: new RegExp(`^${pattern}$`), keys, handler });
    return this;
  }

  /** Fallback route */
  otherwise(handler: RouteHandler): this {
    this.defaultHandler = handler;
    return this;
  }

  /** Start listening to hash changes */
  start(): void {
    window.addEventListener('hashchange', () => this.resolve());
    this.resolve();
  }

  /** Programmatic navigation */
  navigate(path: string): void {
    window.location.hash = '#' + path;
  }

  /** Resolve current hash against routes */
  private resolve(): void {
    const hash = window.location.hash.slice(1) || '/';
    for (const route of this.routes) {
      const match = hash.match(route.pattern);
      if (match) {
        const params: Record<string, string> = {};
        route.keys.forEach((key, i) => { params[key] = match[i + 1]; });
        route.handler(params);
        return;
      }
    }
    this.defaultHandler({});
  }
}

export const router = new Router();
