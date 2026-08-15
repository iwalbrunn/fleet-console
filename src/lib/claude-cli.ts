import { AUTOCOMPACT, CLAUDE_BIN } from './config'

/** Steht als Systemanweisung in JEDER Runde — nicht nur in der ersten
 *  Nachricht. Die Umsetzung bleibt beim Orchestrator selbst; die Prüfrollen
 *  laufen als eigene Sessions (Rollenlauf), nicht über sein Agent-Tool.
 *  Der frühere Delegations-Zwang hat aus jeder Folgefrage eine Review-Runde
 *  gemacht und die eigentliche Umsetzung verdrängt. */
export function orchestratorAuftrag(roles: string[], anforderungenDatei?: string): string {
  const liste = roles.map((r) => `\`${r}\``).join(', ')
  const teile = [
    'Du bist die umsetzende Session dieser Aufgabe. Setze Anforderungen selbst um —',
    'Recherche-Subagenten (z. B. Explore) darfst du dafür frei nutzen.',
    '',
  ]
  if (roles.length) {
    teile.push(
      `Die Prüfrollen (${liste}) laufen als separate, parallele Sessions („Rollenlauf")`,
      'außerhalb dieser Unterhaltung. Beauftrage sie NICHT über das Agent-Tool — auch nicht',
      'am Ende der Aufgabe. Einzige Ausnahme: der Nutzer verlangt es ausdrücklich in seiner Nachricht.',
      ''
    )
  }
  teile.push('Regeln — auch für Folgeaufträge:')
  if (anforderungenDatei) {
    teile.push(
      `- Die Anforderungsliste dieser Session liegt in ${anforderungenDatei}`,
      '  (JSON-Array; Felder id, t, text, status, notiz). Die Konsole trägt jede Nutzer-Nachricht',
      '  dort automatisch mit status "offen" ein. Pflege NUR die Felder status und notiz:',
      '  "erledigt" erst, wenn umgesetzt und geprüft; "verworfen" mit kurzer notiz, wenn eine',
      '  Nachricht keine eigene Anforderung ist (z. B. eine reine Bestätigung). Füge keine',
      '  Einträge hinzu und lösche keine.',
      '- Prüfe vor jedem „fertig" die Liste: kein offener Eintrag darf unerledigt und unerwähnt bleiben.'
    )
  } else {
    teile.push(
      '- Führe bei mehrteiligen Aufträgen eine Aufgabenliste und trage jede nachgereichte Anforderung',
      '  sofort dort ein. Prüfe vor jedem „fertig" die Liste: keine Anforderung — auch keine aus',
      '  früheren Nachrichten — darf unerledigt und unerwähnt bleiben.'
    )
  }
  teile.push(
    '- Nach Code-Änderungen laufen die vorhandenen deterministischen Prüfungen des Projekts',
    '  (Tests, Lint, Build) — kein zusätzliches Selbst-Review darüber hinaus.',
    '- Sag am Ende jeder Runde in je einem Satz, was umgesetzt ist und was noch offen ist.'
  )
  return teile.join('\n')
}

export function buildArgs(opts: {
  model: string
  skipPermissions: boolean
  roles?: string[]
  anforderungenDatei?: string
}): string[] {
  const args = [
    '-p',
    '--output-format',
    'stream-json',
    '--input-format',
    'stream-json',
    '--verbose',
    '--model',
    opts.model,
  ]
  if (opts.roles?.length || opts.anforderungenDatei) {
    args.push(
      '--append-system-prompt',
      orchestratorAuftrag(opts.roles ?? [], opts.anforderungenDatei)
    )
  }
  if (opts.roles?.length) {
    // Ohne das schweigt der Stream, solange ein Subagent arbeitet: seine
    // Ereignisse kommen dann mit parent_tool_use_id herein und lassen sich
    // dem Knoten zuordnen — Phase, Werkzeuge und Tokens je Rolle.
    args.push('--forward-subagent-text')
  }
  // Früher verdichten hält den Kontext je Anfrage klein — der größte Hebel
  // gegen davonlaufenden Verbrauch in langen Sitzungen.
  args.push('--autocompact', AUTOCOMPACT)
  if (opts.skipPermissions) args.push('--dangerously-skip-permissions')
  return args
}

/** Aufruf als Text für die Anzeige. Der Rollenauftrag hinter
 *  `--append-system-prompt` ist ein Absatz Fließtext — ungekürzt sprengt er
 *  jeden Kasten und verdeckt die Flags, auf die es ankommt. */
export function cliText(args: string[]): string {
  const teile: string[] = []
  for (let i = 0; i < args.length; i++) {
    teile.push(args[i])
    if (args[i] === '--append-system-prompt' && i + 1 < args.length) {
      teile.push('«Rollenauftrag»')
      i++
    }
  }
  return [CLAUDE_BIN, ...teile].join(' ')
}

export function cliPreview(opts: {
  model: string
  skipPermissions: boolean
  roles?: string[]
}): string {
  return cliText(buildArgs(opts))
}
