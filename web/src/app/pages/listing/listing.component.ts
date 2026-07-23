import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTableModule } from '@angular/material/table';
import { Tree } from '../../models/tree.model';
import { TreeService } from '../../services/tree.service';

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
  readonly trees = signal<Tree[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  readonly displayedColumns = ['reference', 'espece', 'coordonnees', 'precision', 'date'];

  constructor(private readonly treeService: TreeService) {}

  ngOnInit(): void {
    this.refresh();
  }

  refresh(): void {
    this.loading.set(true);
    this.error.set(null);
    this.treeService.list().subscribe({
      next: (trees) => {
        this.trees.set(trees);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Impossible de charger la liste des arbres.');
        this.loading.set(false);
      },
    });
  }
}
