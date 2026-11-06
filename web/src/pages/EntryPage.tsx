import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { api, listSpecies } from '../api';
import { Autocomplete, type AutocompleteOption, BackToMap, buttonClass, Icon, Spinner } from '../components/ui';
import { formatNumber } from '../format';
import type { Species } from '../models/species';
import { PING_INTERVAL_MS, useGeolocation } from '../stores/geolocation';
import { showToast } from '../stores/toast';

const MAX_AUTOCOMPLETE_OPTIONS = 20;
const ACCURACY_BAR_MAX_M = 200;
const ACCURACY_GOOD_M = 10;
const ACCURACY_MEDIUM_M = 50;
const CLOCK_TICK_MS = 100;

type AccuracyLevel = 'good' | 'medium' | 'bad';

const BAR_FILL: Record<AccuracyLevel | 'none', string> = {
  good: 'bg-ok',
  medium: 'bg-[#f9a825]',
  bad: 'bg-[#c62828]',
  none: 'bg-black/20',
};
const STATUS_TEXT: Record<AccuracyLevel | 'none', string> = {
  good: 'text-ok',
  medium: 'text-[#b56a00]',
  bad: 'text-danger',
  none: '',
};

const INPUT_CLASS =
  'h-12 w-full rounded-md border border-black/25 bg-white px-3 text-base hover:border-black/60 ' +
  'focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

function displayName(species: Species): string {
  return species.nom_usage || species.nom_scientifique;
}

function toOption(species: Species, value: string): AutocompleteOption {
  return {
    key: species.reference,
    value,
    primary: species.nom_scientifique,
    secondary: `${species.nom_usage} (${species.reference})`,
  };
}

export default function EntryPage() {
  const currentReading = useGeolocation((s) => s.currentReading);
  const locationError = useGeolocation((s) => s.currentError);
  const recordableCoordinates = useGeolocation((s) => s.recordableCoordinates);
  const nextPingAt = useGeolocation((s) => s.nextPingAt);
  const canRecord = recordableCoordinates !== null;

  const [now, setNow] = useState(Date.now());
  const [species, setSpecies] = useState<Species[]>([]);
  const [reference, setReference] = useState('');
  const [name, setName] = useState('');
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    listSpecies()
      .then((list) => !cancelled && setSpecies(list))
      .catch(() => undefined); // Sans catalogue, la saisie libre reste possible.
    return () => {
      cancelled = true;
    };
  }, []);

  const accuracy = currentReading?.accuracy;
  const accuracyLevel: AccuracyLevel | null =
    accuracy == null ? null : accuracy < ACCURACY_GOOD_M ? 'good' : accuracy < ACCURACY_MEDIUM_M ? 'medium' : 'bad';
  const accuracyBarWidth = accuracy == null ? 0 : (Math.min(accuracy, ACCURACY_BAR_MAX_M) / ACCURACY_BAR_MAX_M) * 100;
  /** Fraction du temps écoulé jusqu'au prochain ping GPS, pour animer le compte à rebours. */
  const pingProgress =
    nextPingAt == null ? 0 : Math.min(Math.max(1 - (nextPingAt - now) / PING_INTERVAL_MS, 0), 1) * 100;

  /** Suggestions du catalogue quercitum filtrées sur le numéro de référence saisi. */
  const referenceOptions = useMemo(() => {
    const query = reference.trim().toLowerCase();
    const matches = query ? species.filter((entry) => entry.reference.toLowerCase().includes(query)) : species;
    return matches.slice(0, MAX_AUTOCOMPLETE_OPTIONS).map((entry) => toOption(entry, entry.reference));
  }, [species, reference]);

  /** Suggestions du catalogue quercitum filtrées sur le nom saisi. */
  const nameOptions = useMemo(() => {
    const query = name.trim().toLowerCase();
    if (!query) return [];
    return species
      .filter(
        (entry) =>
          entry.nom_scientifique.toLowerCase().includes(query) || entry.nom_usage.toLowerCase().includes(query),
      )
      .slice(0, MAX_AUTOCOMPLETE_OPTIONS)
      .map((entry) => toOption(entry, displayName(entry)));
  }, [species, name]);

  /** Sélection d'une fiche existante (par référence ou par nom) : on synchronise les deux champs. */
  const syncFromOption = (option: AutocompleteOption) => {
    const entry = species.find((candidate) => candidate.reference === option.key);
    if (entry) {
      setReference(entry.reference);
      setName(displayName(entry));
    }
  };

  const invalid = !reference.trim() && !name.trim();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const coordinates = recordableCoordinates;
    if (!coordinates || invalid || submitting) {
      setTouched(true);
      return;
    }
    setSubmitting(true);
    try {
      await api.createTree({
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
        accuracy: coordinates.accuracy,
        reference: reference.trim() || null,
        name: name.trim() || null,
      });
      setReference('');
      setName('');
      setTouched(false);
      showToast('Arbre enregistré.', { action: 'OK', duration: 3000 });
    } catch {
      showToast("Échec de l'enregistrement, veuillez réessayer.", { action: 'Fermer', duration: 5000 });
    } finally {
      setSubmitting(false);
    }
  };

  const level = accuracyLevel ?? 'none';

  return (
    <div className="mx-auto my-6 max-w-[640px] px-4 pb-12">
      <BackToMap />
      <section className="rounded-lg bg-white p-4 shadow ring-1 ring-black/5">
        <h1 className="mb-4 text-xl font-medium">Saisie d'un arbre</h1>

        <div className="mb-4 flex flex-col gap-3">
          <div className="overflow-hidden rounded">
            <div className="h-2 bg-black/[0.08]">
              <div
                className={`h-full transition-[width,background-color] duration-300 ${BAR_FILL[level]}`}
                style={{ width: `${accuracyBarWidth}%` }}
              />
            </div>
            <div className="h-0.5 bg-black/[0.08]">
              <div className="h-full bg-[#1976d2] transition-[width] duration-100 ease-linear" style={{ width: `${pingProgress}%` }} />
            </div>
          </div>

          {locationError ? (
            <Status icon="error_outline" className="text-danger">
              {locationError}
            </Status>
          ) : currentReading ? (
            <Status icon="my_location" className={STATUS_TEXT[level]}>
              {formatNumber(currentReading.latitude, 6, 6)}, {formatNumber(currentReading.longitude, 6, 6)} (précision ±
              {formatNumber(currentReading.accuracy, 0, 0)} m)
            </Status>
          ) : (
            <div className="flex items-center gap-2">
              <Spinner size={20} />
              <span>Localisation en cours…</span>
            </div>
          )}

          {canRecord ? (
            <Status icon="check_circle" className="text-ok">
              Précision suffisante, vous pouvez enregistrer.
            </Status>
          ) : (
            <Status icon="hourglass_empty" className="text-black/60">
              En attente d'une précision inférieure à 10 m…
            </Status>
          )}
        </div>

        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <Autocomplete
            id="entry-reference"
            label="Numéro de référence"
            value={reference}
            onChange={setReference}
            options={referenceOptions}
            onSelect={syncFromOption}
            onBlur={() => setTouched(true)}
            placeholder="ex : 42"
            inputClassName={INPUT_CLASS}
          />
          <Autocomplete
            id="entry-name"
            label="Nom de l'arbre"
            value={name}
            onChange={setName}
            options={nameOptions}
            onSelect={syncFromOption}
            onBlur={() => setTouched(true)}
            placeholder="ex : Chêne de Hongrie"
            inputClassName={INPUT_CLASS}
          />

          {invalid && touched && (
            <p className="-mt-2 text-sm text-danger">Renseignez au moins un numéro de référence ou un nom.</p>
          )}

          <div>
            <button type="submit" className={buttonClass.primary} disabled={!canRecord || invalid || submitting}>
              {submitting ? <Spinner size={18} className="text-white" /> : <Icon name="save" className="text-xl" />}
              Enregistrer
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function Status({ icon, className, children }: { icon: string; className: string; children: ReactNode }) {
  return (
    <div className={`flex items-center gap-2 text-[0.95rem] ${className}`}>
      <Icon name={icon} />
      <span>{children}</span>
    </div>
  );
}
