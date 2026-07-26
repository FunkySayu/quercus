import { DecimalPipe } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors } from '@angular/forms';
import { MatAutocompleteModule, MatAutocompleteSelectedEvent } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Species } from '../../models/species.model';
import { GeolocationService } from '../../services/geolocation.service';
import { SpeciesService } from '../../services/species.service';
import { TreeService } from '../../services/tree.service';

const MAX_AUTOCOMPLETE_OPTIONS = 20;

function referenceOrNameValidator(control: AbstractControl): ValidationErrors | null {
  const reference = (control.get('reference')?.value ?? '').trim();
  const name = (control.get('name')?.value ?? '').trim();
  return reference || name ? null : { referenceOrNameRequired: true };
}

const ACCURACY_BAR_MAX_M = 200;
const ACCURACY_GOOD_M = 10;
const ACCURACY_MEDIUM_M = 50;
const CLOCK_TICK_MS = 100;

type AccuracyLevel = 'good' | 'medium' | 'bad';

@Component({
  selector: 'app-entry',
  standalone: true,
  imports: [
    DecimalPipe,
    ReactiveFormsModule,
    MatAutocompleteModule,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './entry.component.html',
  styleUrl: './entry.component.scss',
})
export class EntryComponent implements OnInit, OnDestroy {
  readonly submitting = signal(false);

  readonly currentReading = this.geolocationService.currentReading;
  readonly locationError = this.geolocationService.currentError;
  readonly recordableCoordinates = this.geolocationService.recordableCoordinates;
  readonly canRecord = this.geolocationService.canRecord;

  private readonly now = signal(Date.now());
  private clockIntervalId: ReturnType<typeof setInterval> | null = null;

  readonly accuracyLevel = computed<AccuracyLevel | null>(() => {
    const accuracy = this.currentReading()?.accuracy;
    if (accuracy == null) return null;
    if (accuracy < ACCURACY_GOOD_M) return 'good';
    if (accuracy < ACCURACY_MEDIUM_M) return 'medium';
    return 'bad';
  });

  readonly accuracyBarWidth = computed(() => {
    const accuracy = this.currentReading()?.accuracy;
    if (accuracy == null) return 0;
    return (Math.min(accuracy, ACCURACY_BAR_MAX_M) / ACCURACY_BAR_MAX_M) * 100;
  });

  /** Fraction du temps écoulé jusqu'au prochain ping GPS, pour animer le compte à rebours. */
  readonly pingProgress = computed(() => {
    const nextPingAt = this.geolocationService.nextPingAt();
    if (nextPingAt == null) return 0;
    const remainingMs = nextPingAt - this.now();
    const elapsedFraction = 1 - remainingMs / this.geolocationService.pingIntervalMs;
    return Math.min(Math.max(elapsedFraction, 0), 1) * 100;
  });

  readonly form = this.fb.group(
    {
      reference: [''],
      name: [''],
    },
    { validators: referenceOrNameValidator }
  );

  readonly species = toSignal(this.speciesService.list(), { initialValue: [] as Species[] });

  private readonly referenceQuery = toSignal(this.form.controls.reference.valueChanges, {
    initialValue: '',
  });
  private readonly nameQuery = toSignal(this.form.controls.name.valueChanges, {
    initialValue: '',
  });

  /** Suggestions du catalogue quercitum filtrées sur le numéro de référence saisi. */
  readonly referenceOptions = computed(() => {
    const query = (this.referenceQuery() ?? '').trim().toLowerCase();
    const options = query
      ? this.species().filter((entry) => entry.reference.toLowerCase().includes(query))
      : this.species();
    return options.slice(0, MAX_AUTOCOMPLETE_OPTIONS);
  });

  /** Suggestions du catalogue quercitum filtrées sur le nom saisi. */
  readonly nameOptions = computed(() => {
    const query = (this.nameQuery() ?? '').trim().toLowerCase();
    if (!query) return [];
    return this.species()
      .filter(
        (entry) =>
          entry.nom_scientifique.toLowerCase().includes(query) ||
          entry.nom_usage.toLowerCase().includes(query)
      )
      .slice(0, MAX_AUTOCOMPLETE_OPTIONS);
  });

  constructor(
    private readonly fb: FormBuilder,
    private readonly geolocationService: GeolocationService,
    private readonly speciesService: SpeciesService,
    private readonly treeService: TreeService,
    private readonly snackBar: MatSnackBar
  ) {}

  /** Sélection d'une entrée existante via son numéro de référence : on synchronise le nom. */
  onReferenceSelected(event: MatAutocompleteSelectedEvent): void {
    const species = this.species().find((entry) => entry.reference === event.option.value);
    if (species) {
      this.syncFromSpecies(species);
    }
  }

  /** Sélection d'une entrée existante via son nom : on synchronise la référence. */
  onNameSelected(event: MatAutocompleteSelectedEvent): void {
    const species = this.species().find(
      (entry) => (entry.nom_usage || entry.nom_scientifique) === event.option.value
    );
    if (species) {
      this.syncFromSpecies(species);
    }
  }

  private syncFromSpecies(species: Species): void {
    this.form.patchValue({
      reference: species.reference,
      name: species.nom_usage || species.nom_scientifique,
    });
  }

  ngOnInit(): void {
    this.clockIntervalId = setInterval(() => this.now.set(Date.now()), CLOCK_TICK_MS);
  }

  ngOnDestroy(): void {
    if (this.clockIntervalId !== null) {
      clearInterval(this.clockIntervalId);
    }
  }

  submit(): void {
    const coordinates = this.recordableCoordinates();
    if (!coordinates || this.form.invalid || this.submitting()) {
      this.form.markAllAsTouched();
      return;
    }

    const reference = (this.form.value.reference ?? '').trim();
    const name = (this.form.value.name ?? '').trim();

    this.submitting.set(true);
    this.treeService
      .create({
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
        accuracy: coordinates.accuracy,
        reference: reference || null,
        name: name || null,
      })
      .subscribe({
        next: () => {
          this.submitting.set(false);
          this.form.reset({ reference: '', name: '' });
          this.snackBar.open('Arbre enregistré.', 'OK', { duration: 3000 });
        },
        error: () => {
          this.submitting.set(false);
          this.snackBar.open("Échec de l'enregistrement, veuillez réessayer.", 'Fermer', {
            duration: 5000,
          });
        },
      });
  }
}
