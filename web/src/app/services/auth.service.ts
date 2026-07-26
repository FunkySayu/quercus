import { HttpClient } from '@angular/common/http';
import { Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

interface MeResponse {
  authenticated: boolean;
  name?: string | null;
  email?: string | null;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly meUrl = '/api/auth/me';

  /** `null` tant que le premier appel à /api/auth/me n'a pas répondu. */
  readonly authenticated = signal<boolean | null>(null);
  readonly userName = signal<string | null>(null);

  constructor(private readonly http: HttpClient) {}

  async refresh(): Promise<boolean> {
    try {
      const response = await firstValueFrom(this.http.get<MeResponse>(this.meUrl));
      this.authenticated.set(response.authenticated);
      this.userName.set(response.name ?? response.email ?? null);
      return response.authenticated;
    } catch {
      this.authenticated.set(false);
      this.userName.set(null);
      return false;
    }
  }

  /** Redirection plein-page vers le login Authentik (flow OAuth2 côté backend). */
  login(next: string = '/'): void {
    window.location.href = `/api/auth/login?next=${encodeURIComponent(next)}`;
  }

  logout(): void {
    window.location.href = '/api/auth/logout';
  }
}
