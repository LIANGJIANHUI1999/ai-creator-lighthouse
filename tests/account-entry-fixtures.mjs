// Historical route definitions remain fixtures after removal from active monitoring.
export const retiredAccountRoutes = [
  { id: 'orders-login', labelKey: 'ordersLogin', path: '/en/account/orders/', environments: ['staging'], seoPolicy: 'noindex', measurementScope: 'sign-in-entry' },
  { id: 'credits-login', labelKey: 'creditsLogin', path: '/en/account/credits/', environments: ['staging'], measurementScope: 'sign-in-entry' },
];
