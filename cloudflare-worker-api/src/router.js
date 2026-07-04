function compile(pattern) {
  const paramNames = [];
  const regexBody = pattern
    .split('/')
    .filter(Boolean)
    .map((segment) => {
      if (segment.startsWith(':')) {
        paramNames.push(segment.slice(1));
        return '([^/]+)';
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return { regex: new RegExp(`^/${regexBody}/?$`), paramNames };
}

export function createRouter() {
  const routes = [];

  return {
    get(pattern, handler) {
      routes.push({ ...compile(pattern), handler });
    },
    match(pathname) {
      for (const route of routes) {
        const m = route.regex.exec(pathname);
        if (!m) continue;
        const params = {};
        route.paramNames.forEach((name, i) => {
          params[name] = decodeURIComponent(m[i + 1]);
        });
        return { handler: route.handler, params };
      }
      return null;
    },
  };
}
