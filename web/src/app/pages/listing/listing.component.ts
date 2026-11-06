import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, OnInit, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTableModule } from '@angular/material/table';
import { Crown, bestAccuracy, lastReadingDate, plantingLabel } from '../../models/crown.model';
import { CrownSearchService } from '../../services/crown-search.service';

/** Un arbre identifié par ligne (couronne LiDAR ou cercle GPS), du plus récemment relevé au plus ancien. */
@Component({
  selector: 'app-listing',
  standalone: true,
  imports: [
    DatePipe,
    DecimalPipe,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTableModule,
  ],
  templateUrl: './listing.component.html',
  styleUrl: './listing.component.scss',
})
export class ListingComponent implements OnInit {
  private readonly search = inject(CrownSearchService);
  private readonly router = inject(Router);

  readonly loading = computed(() => this.search.loading());
  readonly error = computed(() => (this.search.error() ? 'Impossible de charger la liste des arbres.' : null));

  readonly crowns = computed(() =>
    [...this.search.identifiedCrowns()].sort((a, b) =>
      (lastReadingDate(b) ?? '').localeCompare(lastReadingDate(a) ?? ''),
    ),
  );

  readonly displayedColumns = ['reference', 'espece', 'contour', 'plantation', 'coordonnees', 'precision', 'date'];

  readonly bestAccuracy = bestAccuracy;
  readonly lastReadingDate = lastReadingDate;
  readonly plantingLabel = plantingLabel;

  ngOnInit(): void {
    this.refresh();
  }

  refresh(): void {
    this.search.reload();
  }

  /** Ouvre l'arbre sur la carte, sélectionné (panneau de détail ouvert). */
  showOnMap(crown: Crown): void {
    this.search.selectCrown(crown);
    this.router.navigate(['/']);
  }
}
