import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, shareReplay } from 'rxjs';
import { Species } from '../models/species.model';

@Injectable({ providedIn: 'root' })
export class SpeciesService {
  private readonly baseUrl = '/api/species';
  private cached$: Observable<Species[]> | null = null;

  constructor(private readonly http: HttpClient) {}

  /** Liste complète du catalogue quercitum, mise en cache pour l'autocomplétion. */
  list(): Observable<Species[]> {
    if (!this.cached$) {
      this.cached$ = this.http.get<Species[]>(this.baseUrl).pipe(shareReplay(1));
    }
    return this.cached$;
  }
}
