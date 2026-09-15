export function createRouter(routes) {
  return new Map(routes.map((route) => [route.path, route.handler]));
}

export const applicationRouter = createRouter([
  { path: "/health", handler: () => "ok" },
]);

