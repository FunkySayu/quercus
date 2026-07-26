import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ReactiveFormsModule } from '@angular/forms';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { GeolocationService } from './services/geolocation.service';
import { TreeSearchService } from './services/tree-search.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    ReactiveFormsModule,
    MatAutocompleteModule,
    MatToolbarModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent implements OnInit, OnDestroy {
  protected readonly search = inject(TreeSearchService);

  constructor(private readonly geolocationService: GeolocationService) {}

  ngOnInit(): void {
    // Démarre le ping GPS dès l'ouverture de l'app pour que la précision ait le
    // temps de se stabiliser avant que l'utilisateur n'atteigne le formulaire de saisie.
    this.geolocationService.start();
  }

  ngOnDestroy(): void {
    this.geolocationService.stop();
  }
}
