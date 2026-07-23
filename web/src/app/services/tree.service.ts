import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { CreateTreePayload, Tree } from '../models/tree.model';

@Injectable({ providedIn: 'root' })
export class TreeService {
  private readonly baseUrl = '/api/trees';

  constructor(private readonly http: HttpClient) {}

  list(): Observable<Tree[]> {
    return this.http.get<Tree[]>(this.baseUrl);
  }

  create(payload: CreateTreePayload): Observable<Tree> {
    return this.http.post<Tree>(this.baseUrl, payload);
  }
}
