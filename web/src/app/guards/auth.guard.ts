import { inject } from '@angular/core';
import { CanActivateFn } from '@angular/router';
import { AuthService } from '../services/auth.service';

/** Bloque /saisie et envoie directement vers le login Authentik si non connecté. */
export const authGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);

  if (auth.authenticated() === null) {
    await auth.refresh();
  }

  if (auth.authenticated()) {
    return true;
  }

  auth.login(state.url);
  return false;
};
