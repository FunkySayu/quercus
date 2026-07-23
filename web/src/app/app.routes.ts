import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/home/home.component').then((m) => m.HomeComponent),
  },
  {
    path: 'saisie',
    loadComponent: () => import('./pages/entry/entry.component').then((m) => m.EntryComponent),
  },
  {
    path: 'liste',
    loadComponent: () =>
      import('./pages/listing/listing.component').then((m) => m.ListingComponent),
  },
  { path: '**', redirectTo: '' },
];
