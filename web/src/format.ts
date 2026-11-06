/** Équivalent des pipes Angular `number: '1.min-max'` (locale en-US, comme avant la migration). */
export function formatNumber(value: number | null | undefined, minFraction: number, maxFraction: number): string {
  if (value == null || Number.isNaN(value)) {
    return '';
  }
  return value.toLocaleString('en-US', {
    minimumFractionDigits: minFraction,
    maximumFractionDigits: maxFraction,
  });
}

/** Équivalent de `date: 'dd/MM/yyyy HH:mm'`, en heure locale. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) {
    return '';
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}
