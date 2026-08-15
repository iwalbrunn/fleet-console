import type { RollenVerdict } from './types'

/** Standardauftrag eines Rollenlaufs, wenn der Stand NICHT mitgegeben wird.
 *  Jeder andere Text ist erlaubt — damit taugt der Lauf auch für Umsetzung,
 *  nicht nur für die Diff-Prüfung. */
export const PRUEFAUFTRAG = [
  'Prüfe ausschließlich die uncommitteten Änderungen in diesem Projekt.',
  'Ermittle sie selbst mit `git diff HEAD` sowie `git status --porcelain` für neue Dateien.',
  'Lies nur die Dateien, die im Diff vorkommen — nicht die ganze Codebasis.',
  'Dein Ergebnis wird als strukturiertes JSON erfasst (Schema ist vorgegeben):',
  'Befunde ab Schweregrad Mittel, je Befund Datei, Zeile, Titel und 1–2 Sätze Beschreibung.',
  'Wenn nichts zu beanstanden ist: verdict "ok" mit leerer Befundliste. Nimm keine Änderungen vor.',
].join(' ')

/** Schema für das Review-Ergebnis eines Rollenlaufs. Erzwingt Struktur, damit
 *  Code — nicht das Modell — über Terminierung und Anzeige entscheidet. */
export const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['ok', 'befunde'] },
    befunde: {
      type: 'array',
      maxItems: 10,
      items: {
        type: 'object',
        properties: {
          schweregrad: { type: 'string', enum: ['kritisch', 'hoch', 'mittel', 'niedrig'] },
          datei: { type: 'string' },
          zeile: { type: ['integer', 'null'] },
          titel: { type: 'string' },
          beschreibung: { type: 'string' },
          status: { type: 'string', enum: ['neu', 'offen', 'behoben'] },
        },
        required: ['schweregrad', 'datei', 'titel', 'beschreibung'],
        additionalProperties: false,
      },
    },
    zusammenfassung: { type: 'string' },
  },
  required: ['verdict', 'befunde'],
  additionalProperties: false,
} as const

/** Macht aus dem Verdict-JSON den lesbaren Bericht für Anzeige und Ablage. */
export function verdictAlsText(v: RollenVerdict): string {
  if (v.verdict === 'ok' || !v.befunde.length) {
    return `Verdict: ok — ${v.zusammenfassung ?? 'keine Befunde ab Schweregrad Mittel.'}`
  }
  const zeilen = v.befunde.map((b) => {
    const ort = b.zeile ? `${b.datei}:${b.zeile}` : b.datei
    const status = b.status && b.status !== 'neu' ? ` (${b.status})` : ''
    return `- [${b.schweregrad}]${status} ${ort} — ${b.titel}: ${b.beschreibung}`
  })
  const kopf = v.zusammenfassung ? `${v.zusammenfassung}\n\n` : ''
  return `${kopf}${zeilen.join('\n')}`
}

/** Einzeiler für den Knoten: Verdict plus Zählung statt der ersten Textzeilen. */
export function verdictKurz(v: RollenVerdict): string {
  if (v.verdict === 'ok' || !v.befunde.length) return '✓ ok — keine Befunde'
  const behoben = v.befunde.filter((b) => b.status === 'behoben').length
  const offen = v.befunde.length - behoben
  const schwer = v.befunde.filter(
    (b) => b.status !== 'behoben' && (b.schweregrad === 'kritisch' || b.schweregrad === 'hoch')
  ).length
  const teile = [`${offen} Befund(e)`]
  if (schwer) teile.push(`davon ${schwer} hoch/kritisch`)
  if (behoben) teile.push(`${behoben} behoben`)
  return teile.join(' · ')
}

/** Derselbe Auftrag, wenn der Arbeitsstand unten schon angehängt ist. Ohne
 *  diese Fassung würde jede Rolle die Ermittlung trotzdem selbst ausführen —
 *  genau die Anfragen, die eingespart werden sollen. */
export const PRUEFAUFTRAG_MIT_STAND = [
  'Prüfe ausschließlich die unten angehängten uncommitteten Änderungen dieses Projekts.',
  'Der Stand ist vollständig beigelegt — ermittle ihn NICHT noch einmal selbst.',
  'Lies eine Datei nur dann nach, wenn der beigelegte Ausschnitt für die Beurteilung nicht reicht.',
  'Dein Ergebnis wird als strukturiertes JSON erfasst (Schema ist vorgegeben):',
  'Befunde ab Schweregrad Mittel, je Befund Datei, Zeile, Titel und 1–2 Sätze Beschreibung.',
  'Wenn nichts zu beanstanden ist: verdict "ok" mit leerer Befundliste. Nimm keine Änderungen vor.',
].join(' ')

/** Auftrag für die Nachprüfung: die Rolle kennt ihre Befunde schon — sie soll
 *  nur abhaken statt den ganzen Diff noch einmal von vorn zu reviewen. */
export const NACHPRUEFUNGS_AUFTRAG = [
  'NACHPRÜFUNG: Unten stehen deine Befunde aus dem letzten Lauf (als JSON) und der aktuelle',
  'Arbeitsstand. Prüfe ausschließlich: (1) Je Altbefund — behoben oder offen? Gib ihn mit',
  'status "behoben" bzw. "offen" wieder. (2) Neue Befunde (status "neu") nur an den seither',
  'geänderten Stellen. Dein Ergebnis wird als strukturiertes JSON erfasst (Schema ist',
  'vorgegeben). Nimm keine Änderungen vor.',
].join(' ')
