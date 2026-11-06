import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { CrownCollection } from '../models/crown.model';

/** Couronnes LiDAR fusionnées avec les relevés GPS (backend app/crowns.py). */
@Injectable({ providedIn: 'root' })
export class CrownService {
  private readonly baseUrl = '/api/crowns';

  constructor(private readonly http: HttpClient) {}

  list(): Observable<CrownCollection> {
    return this.http.get<CrownCollection>(this.baseUrl);
  }

  /** Suppression "douce" : la couronne est marquée `hidden` dans le GeoJSON, pas effacée. */
  hide(crownId: number): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${crownId}`);
  }

  restore(crownId: number): Observable<void> {
    return this.http.post<void>(`${this.baseUrl}/${crownId}/restore`, null);
  }
}
