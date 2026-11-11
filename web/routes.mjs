export function routesForEnvironment(config, environment) {
  return config.routes.filter(route => !route.environments || route.environments.includes(environment));
}
