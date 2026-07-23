import { Component, OnDestroy, OnInit } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { GeolocationService } from './services/geolocation.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, MatToolbarModule, MatButtonModule, MatIconModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent implements OnInit, OnDestroy {
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
