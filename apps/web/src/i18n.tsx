import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export type Locale = "en" | "es";
type Variables = Record<string, number | string>;

const english = {
  "language.label": "Language",
  "language.english": "English",
  "language.spanish": "Español",
  "brand.home": "L4DStats home",
  "brand.banjaTab": "by Banja Labs (opens in a new tab)",
  "brand.banjaEmail": "Email Banja Labs at labs@banja.au",
  "brand.banjaName": "Banja Labs",
  "brand.banjaAddress": "labs@banja.au",
  "brand.developers": "L4DStats developer API",
  "brand.by": "by",
  "upload.choose": "Choose demo files",
  "upload.drop": "DROP DEMOS",
  "upload.hint":
    "or choose .dem, .zip, .gz, .xz, .bz2 or .zst · maximum {maximum}",
  "upload.unavailable": "Demo source is unavailable",
  "upload.queued": "Queued for analysis",
  "upload.failed": "Upload failed",
  "playerSearch.title": "FIND A PLAYER",
  "playerSearch.subtitle": "Open every retained game for a Steam identity",
  "playerSearch.label": "SteamID64 or Steam profile URL",
  "playerSearch.placeholder": "SteamID64 or steamcommunity.com profile",
  "playerSearch.search": "SEARCH",
  "playerSearch.searching": "SEARCHING",
  "playerSearch.switchTo": "Search by player",
  "playerSearch.switchBack": "Back to demo upload",
  "playerSearch.failed": "Player lookup failed",
  "playerSearch.unknownName": "Steam player",
  "playerSearch.steamProfile": "Steam profile",
  "playerSearch.game": "L4D2 game",
  "playerSearch.demoCount": "{count} demo",
  "playerSearch.demoCountPlural": "{count} demos",
  "analysis.complete": "Analysis complete",
  "analysis.analyzing": "Analyzing demo",
  "analysis.safeRoom": "Safe room reached",
  "analysis.reconstructing": "RECONSTRUCTING THE VERSUS ROUND",
  "analysis.horde": "THE HORDE",
  "analysis.leavesEvidence": "LEAVES EVIDENCE",
  "analysis.heading": "L4DStats demo analyzer",
  "analysis.illustration": "Illustrated bloated infected",
  "results.complete": "ANALYSIS COMPLETE",
  "results.provenance": "Parser provenance",
  "results.defaultGame": "L4D2 GAME",
  "results.defaultMatch": "MATCH RESULTS",
  "results.addDemos": "ADD DEMOS",
  "results.exampleGame": "View example game",
  "results.demoLimit": "10 / 10 DEMOS",
  "results.update": "Analysis update available",
  "results.updateDetail":
    "Re-run the selected demos to apply corrected hit HP, infected-kill semantics, and the latest competitive derivations.",
  "results.reanalyze": "Reanalyze",
  "results.sections": "Statistics sections",
  "tabs.overview": "overview",
  "tabs.players": "players",
  "tabs.combat": "combat",
  "tabs.timeline": "timeline",
  "tabs.signals": "signals",
  "tabs.quality": "data coverage",
  "filters.game": "Game",
  "filters.gameNumber": "Game {number}",
  "filters.mapNumber": "Map {number}",
  "filters.mapCount": "{count} map",
  "filters.mapCountPlural": "{count} maps",
  "filters.maps": "Maps {enabled} / {total}",
  "filters.rounds": "Rounds {enabled} / {total}",
  "filters.chapter": "chapter {chapter}",
  "filters.observedRound": "Observed round",
  "filters.half": "{half} half",
  "filters.ticks": "ticks {start} to {end}",
  "group.maps": "{count} maps grouped as one game",
  "group.highConfidence": "high confidence",
  "group.provisional": "provisional",
  "group.unassociated": "unassociated",
  "group.unassociatedDetail":
    "This map lacks enough compatible session evidence to merge safely.",
  "group.provisionalDetail":
    "One map has strong session evidence. An adjacent compatible chapter is needed to confirm the game.",
  "group.highDetail":
    "Embedded server continuity, stable roster, campaign sequence, and Source server counters agree.",
  "group.recalculate": "Disable a map or round above to recalculate every tab.",
  "overview.restartTitle": "Versus restart state observed",
  "overview.restartDetailOne":
    "1 selected map entered the networked vote-restart state. Counter decreases remain reset boundaries and are never subtracted from player output.",
  "overview.restartDetailMany":
    "{count} selected maps entered the networked vote-restart state. Counter decreases remain reset boundaries and are never subtracted from player output.",
  "overview.gameMvp": "Game MVP",
  "overview.mvpUnavailable": "MVP unavailable",
  "overview.mvpUnresolved": "MVP edge unresolved",
  "overview.mvpNoData": "Not enough eligible two-role data",
  "overview.coverage": "{value} coverage",
  "overview.mvpShared":
    "Leaders are within the declared {resolution} resolution.",
  "overview.mvpMethod":
    "Experimental L4DStats Rating v0.2 across the selected maps and rounds.",
  "overview.spectatorOne": "1 spectator",
  "overview.spectatorMany": "{count} spectators",
  "overview.spectatorExcluded": "excluded from player stats and ratings",
  "overview.finalScore": "Final score",
  "overview.latestScore": "Latest confirmed score",
  "overview.neutralIndex": "neutral team index",
  "overview.finalUnavailable": "Final result unavailable",
  "overview.scoreIncomplete":
    "The last demo ends after one side's score commits. A following map or second-half artifact is required before declaring the final result.",
  "overview.drawDetail": "The selected maps finish level.",
  "overview.winDetail":
    "{team} wins. Roster-to-score naming remains unverified.",
  "overview.scoreByMap": "Score after each map",
  "overview.pending": "pending",
  "overview.chapter": "chapter",
  "overview.progressionDetail": "Round progression and side detail",
  "overview.progressionDetailHelp":
    "Score curves, Survivor distance and reconstructed halves",
  "overview.playTime": "Play time",
  "overview.acrossDemoOne": "across 1 demo",
  "overview.acrossDemoMany": "across {count} demos",
  "overview.players": "Players",
  "overview.uniquePlayers": "unique competitive participants",
  "overview.siKilled": "Special Infected killed",
  "overview.attributedDeaths": "attributed death events",
  "overview.survivorDeaths": "Survivor deaths",
  "overview.selectedRounds": "across selected rounds",
  "overview.finalResult": "Final result",
  "overview.winningTeam": "Winning team",
  "overview.tied": "The final score is tied.",
  "overview.winnerUnavailable":
    "A complete score and high-confidence side swap are required.",
  "overview.demoSet": "Demo set",
  "overview.mapsAnalyzed": "Maps analyzed",
  "overview.unknownMap": "Unknown map",
  "overview.observations": "{count} observations",
  "overview.tick": "tick",
  "overview.openAnalysis": "Open analysis for {map}",
  "overview.open": "Open",
  "overview.competitiveLeaders": "Competitive leaders",
  "overview.matchAwards": "Match awards",
  "overview.about": "About",
  "overview.reanalyzeTank": "Reanalyze these demos to extract Tank damage",
  "overview.noPositive": "No positive value in selected data",
  "overview.unavailableSelected": "Unavailable in selected data",
  "overview.halfLabel": "{half} half · neutral roster labels",
  "overview.survivorSide": "Survivor side",
  "overview.infectedSide": "Infected side",
  "overview.roundProgression": "Round progression",
  "overview.campaignScore": "Cumulative campaign score",
  "overview.teamA": "Team A",
  "overview.teamB": "Team B",
  "overview.draw": "Draw",
  "overview.scoreChart": "Versus score over demo time",
  "overview.scoreChartHelp":
    "Tick-stamped cumulative game-rules values. Chapter score is already included. Team indices are not inferred roster names.",
  "overview.survivorProgression": "Survivor progression",
  "overview.distance": "Furthest engine-reported distance",
  "overview.units": "{count} units",
  "overview.distanceChart": "Furthest Survivor distance over demo time",
  "overview.distanceHelp":
    "Direct game-rules distance, not nav-flow percentage. Roster-to-score team attribution remains unavailable.",
  "awards.infectedKills": "Most infected kills",
  "awards.infectedKillsUnit": "kills",
  "awards.infectedKillsHelp":
    "Total infected kills from the networked checkpoint counter. It includes Common and Special Infected and has no weapon attribution.",
  "awards.siKills": "Most SI kills",
  "awards.siUnit": "SI",
  "awards.siKillsHelp": "Attributed Special Infected death events.",
  "awards.hunterKills": "Most Hunter kills",
  "awards.hunterUnit": "Hunters",
  "awards.hunterKillsHelp":
    "Hunter death events. These are not claimed as airborne skeets.",
  "awards.siDamage": "Most SI damage",
  "awards.damageUnit": "damage",
  "awards.siDamageHelp":
    "Engine checkpoint damage dealt while controlling non-Tank Special Infected.",
  "awards.clears": "Most clears",
  "awards.clearsUnit": "clears",
  "awards.clearsHelp":
    "Death-correlated teammate clears reconstructed from pin endings.",
  "awards.pinTime": "Most pin time",
  "awards.secondsUnit": "seconds",
  "awards.pinTimeHelp": "Observed active SI control time across selected maps.",
  "awards.revives": "Most revives",
  "awards.revivesUnit": "revives",
  "awards.revivesHelp": "Networked checkpoint teammate revives.",
  "awards.bestPounce": "Best pounce",
  "awards.bestPounceHelp": "Highest networked Hunter pounce-damage value.",
  "awards.siIncaps": "Most SI incaps",
  "awards.incapsUnit": "incaps",
  "awards.siIncapsHelp": "Networked checkpoint Survivor incaps by SI.",
  "awards.tankDamage": "Most Tank damage dealt",
  "awards.tankDamageHelp":
    "Engine checkpoint damage credited while controlling Tank.",
  "player.missing": "Player not found",
  "player.missingDetail":
    "This identity is not present in the selected game data.",
  "player.back": "Back to players",
  "player.profile": "Game player profile",
  "player.rating": "L4DStats Rating",
  "player.survivorRating": "Survivor {rating}",
  "player.infectedRating": "Infected {rating}",
  "player.totals": "Player totals",
  "player.siKills": "SI kills",
  "player.survivorDeaths": "Survivor deaths",
  "player.siIncaps": "SI incaps",
  "player.pinTime": "Pin time",
  "player.revives": "Revives",
  "player.selectedGame": "Selected game",
  "player.mapByMap": "Map by map",
  "player.mapContributions": "Map contributions",
  "player.map": "Map",
  "player.allInfected": "All infected",
  "player.pin": "Pin",
  "player.survivorContribution": "Survivor contribution",
  "player.survivorContributionTitle": "Threat removal and support",
  "player.totalInfectedKills": "Total infected kills",
  "player.specialInfectedKills": "Special Infected kills",
  "player.incapsSuffered": "Incaps suffered",
  "player.tankDamage": "Tank damage",
  "player.witchDamage": "Witch damage",
  "player.infectedContribution": "Infected contribution",
  "player.infectedContributionTitle": "Control and conversion",
  "player.siDeaths": "SI deaths",
  "player.survivorsIncapped": "Survivors incapped",
  "player.pounces": "Pounces",
  "player.bestPounce": "Best pounce",
  "player.ghostTime": "Ghost time",
  "player.tankDamageDealt": "Tank damage dealt",
  "player.networkCounters": "Networked checkpoint counters",
  "common.notAvailable": "N/A",
  "error.renderTitle": "L4DStats could not render this page",
  "error.renderDetail": "Reload the page to try again.",
} as const;

const spanish: Record<keyof typeof english, string> = {
  "language.label": "Idioma",
  "language.english": "English",
  "language.spanish": "Español",
  "brand.home": "Inicio de L4DStats",
  "brand.banjaTab": "por Banja Labs (se abre en una pestaña nueva)",
  "brand.banjaEmail": "Enviar un correo a Banja Labs a labs@banja.au",
  "brand.banjaName": "Banja Labs",
  "brand.banjaAddress": "labs@banja.au",
  "brand.developers": "API para desarrolladores de L4DStats",
  "brand.by": "por",
  "upload.choose": "Elegir archivos de demo",
  "upload.drop": "SUELTA LAS DEMOS",
  "upload.hint": "o elige .dem, .zip, .gz, .xz, .bz2 o .zst · máximo {maximum}",
  "upload.unavailable": "La fuente de la demo no está disponible",
  "upload.queued": "En cola para el análisis",
  "upload.failed": "Error al subir",
  "playerSearch.title": "BUSCAR JUGADOR",
  "playerSearch.subtitle":
    "Abre todas las partidas conservadas de una identidad de Steam",
  "playerSearch.label": "SteamID64 o URL del perfil de Steam",
  "playerSearch.placeholder": "SteamID64 o perfil de steamcommunity.com",
  "playerSearch.search": "BUSCAR",
  "playerSearch.searching": "BUSCANDO",
  "playerSearch.switchTo": "Buscar por jugador",
  "playerSearch.switchBack": "Volver a subir demos",
  "playerSearch.failed": "La búsqueda del jugador falló",
  "playerSearch.unknownName": "Jugador de Steam",
  "playerSearch.steamProfile": "Perfil de Steam",
  "playerSearch.game": "Partida de L4D2",
  "playerSearch.demoCount": "{count} demo",
  "playerSearch.demoCountPlural": "{count} demos",
  "analysis.complete": "Análisis completado",
  "analysis.analyzing": "Analizando la demo",
  "analysis.safeRoom": "Refugio alcanzado",
  "analysis.reconstructing": "RECONSTRUYENDO LA RONDA VERSUS",
  "analysis.horde": "LA HORDA",
  "analysis.leavesEvidence": "DEJA EVIDENCIA",
  "analysis.heading": "Analizador de demos de L4DStats",
  "analysis.illustration": "Ilustración de un infectado hinchado",
  "results.complete": "ANÁLISIS COMPLETADO",
  "results.provenance": "Procedencia del analizador",
  "results.defaultGame": "PARTIDA DE L4D2",
  "results.defaultMatch": "RESULTADOS DE LA PARTIDA",
  "results.addDemos": "AÑADIR DEMOS",
  "results.exampleGame": "Ver partida de ejemplo",
  "results.demoLimit": "10 / 10 DEMOS",
  "results.update": "Hay una actualización del análisis",
  "results.updateDetail":
    "Vuelve a analizar las demos seleccionadas para aplicar la corrección de PV por impacto, la semántica de bajas de infectados y las últimas derivaciones competitivas.",
  "results.reanalyze": "Volver a analizar",
  "results.sections": "Secciones de estadísticas",
  "tabs.overview": "resumen",
  "tabs.players": "jugadores",
  "tabs.combat": "combate",
  "tabs.timeline": "cronología",
  "tabs.signals": "señales",
  "tabs.quality": "cobertura de datos",
  "filters.game": "Partida",
  "filters.gameNumber": "Partida {number}",
  "filters.mapNumber": "Mapa {number}",
  "filters.mapCount": "{count} mapa",
  "filters.mapCountPlural": "{count} mapas",
  "filters.maps": "Mapas {enabled} / {total}",
  "filters.rounds": "Rondas {enabled} / {total}",
  "filters.chapter": "capítulo {chapter}",
  "filters.observedRound": "Ronda observada",
  "filters.half": "mitad {half}",
  "filters.ticks": "ticks {start} a {end}",
  "group.maps": "{count} mapas agrupados como una partida",
  "group.highConfidence": "confianza alta",
  "group.provisional": "provisional",
  "group.unassociated": "sin asociación",
  "group.unassociatedDetail":
    "Este mapa no contiene suficientes pruebas de sesión compatibles para combinarlo de forma segura.",
  "group.provisionalDetail":
    "Un mapa contiene pruebas de sesión sólidas. Hace falta un capítulo adyacente compatible para confirmar la partida.",
  "group.highDetail":
    "La continuidad del servidor integrada, la plantilla estable, la secuencia de campaña y los contadores del servidor Source coinciden.",
  "group.recalculate":
    "Desactiva un mapa o una ronda arriba para recalcular todas las pestañas.",
  "overview.restartTitle": "Se observó un reinicio de Versus",
  "overview.restartDetailOne":
    "1 mapa seleccionado entró en el estado de reinicio por votación de red. Las disminuciones de contadores siguen siendo límites de reinicio y nunca se restan del resultado del jugador.",
  "overview.restartDetailMany":
    "{count} mapas seleccionados entraron en el estado de reinicio por votación de red. Las disminuciones de contadores siguen siendo límites de reinicio y nunca se restan del resultado del jugador.",
  "overview.gameMvp": "MVP de la partida",
  "overview.mvpUnavailable": "MVP no disponible",
  "overview.mvpUnresolved": "Ventaja de MVP sin resolver",
  "overview.mvpNoData": "No hay suficientes datos válidos de ambos roles",
  "overview.coverage": "{value} de cobertura",
  "overview.mvpShared":
    "Los líderes están dentro de la resolución declarada de {resolution}.",
  "overview.mvpMethod":
    "Puntuación experimental L4DStats v0.2 para los mapas y rondas seleccionados.",
  "overview.spectatorOne": "1 espectador",
  "overview.spectatorMany": "{count} espectadores",
  "overview.spectatorExcluded":
    "excluidos de las estadísticas y puntuaciones de jugadores",
  "overview.finalScore": "Puntuación final",
  "overview.latestScore": "Última puntuación confirmada",
  "overview.neutralIndex": "índice neutral de equipo",
  "overview.finalUnavailable": "Resultado final no disponible",
  "overview.scoreIncomplete":
    "La última demo termina después de confirmarse la puntuación de un bando. Hace falta un mapa posterior o un artefacto de la segunda mitad para declarar el resultado final.",
  "overview.drawDetail": "Los mapas seleccionados terminan empatados.",
  "overview.winDetail":
    "Gana {team}. La asignación de nombres entre plantilla y puntuación sigue sin verificarse.",
  "overview.scoreByMap": "Puntuación después de cada mapa",
  "overview.pending": "pendiente",
  "overview.chapter": "capítulo",
  "overview.progressionDetail": "Progresión de rondas y detalle de bandos",
  "overview.progressionDetailHelp":
    "Curvas de puntuación, distancia de supervivientes y mitades reconstruidas",
  "overview.playTime": "Tiempo de juego",
  "overview.acrossDemoOne": "en 1 demo",
  "overview.acrossDemoMany": "en {count} demos",
  "overview.players": "Jugadores",
  "overview.uniquePlayers": "participantes competitivos únicos",
  "overview.siKilled": "Infectados especiales eliminados",
  "overview.attributedDeaths": "eventos de muerte atribuidos",
  "overview.survivorDeaths": "Muertes de supervivientes",
  "overview.selectedRounds": "en las rondas seleccionadas",
  "overview.finalResult": "Resultado final",
  "overview.winningTeam": "Equipo ganador",
  "overview.tied": "La puntuación final está empatada.",
  "overview.winnerUnavailable":
    "Se necesitan una puntuación completa y un cambio de bando de alta confianza.",
  "overview.demoSet": "Conjunto de demos",
  "overview.mapsAnalyzed": "Mapas analizados",
  "overview.unknownMap": "Mapa desconocido",
  "overview.observations": "{count} observaciones",
  "overview.tick": "tick",
  "overview.openAnalysis": "Abrir el análisis de {map}",
  "overview.open": "Abrir",
  "overview.competitiveLeaders": "Líderes competitivos",
  "overview.matchAwards": "Premios de la partida",
  "overview.about": "Acerca de",
  "overview.reanalyzeTank":
    "Vuelve a analizar estas demos para extraer el daño de Tank",
  "overview.noPositive": "No hay valores positivos en los datos seleccionados",
  "overview.unavailableSelected": "No disponible en los datos seleccionados",
  "overview.halfLabel": "mitad {half} · etiquetas neutrales de plantilla",
  "overview.survivorSide": "Bando superviviente",
  "overview.infectedSide": "Bando infectado",
  "overview.roundProgression": "Progresión de la ronda",
  "overview.campaignScore": "Puntuación acumulada de campaña",
  "overview.teamA": "Equipo A",
  "overview.teamB": "Equipo B",
  "overview.draw": "Empate",
  "overview.scoreChart": "Puntuación de Versus durante la demo",
  "overview.scoreChartHelp":
    "Valores acumulados de reglas de juego marcados por tick. La puntuación del capítulo ya está incluida. Los índices de equipo no se interpretan como nombres de plantilla.",
  "overview.survivorProgression": "Progresión de supervivientes",
  "overview.distance": "Mayor distancia indicada por el motor",
  "overview.units": "{count} unidades",
  "overview.distanceChart": "Mayor distancia de supervivientes durante la demo",
  "overview.distanceHelp":
    "Distancia directa de las reglas del juego, no porcentaje de flujo de navegación. La atribución de plantilla a equipo de puntuación sigue sin estar disponible.",
  "awards.infectedKills": "Más bajas de infectados",
  "awards.infectedKillsUnit": "bajas",
  "awards.infectedKillsHelp":
    "Bajas totales de infectados según el contador de checkpoint de red. Incluye infectados comunes y especiales, sin atribución de arma.",
  "awards.siKills": "Más bajas de IE",
  "awards.siUnit": "IE",
  "awards.siKillsHelp":
    "Eventos atribuidos de muerte de infectados especiales.",
  "awards.hunterKills": "Más bajas de Hunter",
  "awards.hunterUnit": "Hunters",
  "awards.hunterKillsHelp":
    "Eventos de muerte de Hunter. No se presentan como skeets en el aire.",
  "awards.siDamage": "Más daño de IE",
  "awards.damageUnit": "daño",
  "awards.siDamageHelp":
    "Daño de checkpoint del motor infligido al controlar infectados especiales que no sean Tank.",
  "awards.clears": "Más liberaciones",
  "awards.clearsUnit": "liberaciones",
  "awards.clearsHelp":
    "Liberaciones de compañeros correlacionadas con muertes y reconstruidas a partir del fin de inmovilizaciones.",
  "awards.pinTime": "Mayor tiempo inmovilizando",
  "awards.secondsUnit": "segundos",
  "awards.pinTimeHelp":
    "Tiempo activo observado de control por IE en los mapas seleccionados.",
  "awards.revives": "Más reanimaciones",
  "awards.revivesUnit": "reanimaciones",
  "awards.revivesHelp":
    "Reanimaciones de compañeros según el contador de checkpoint de red.",
  "awards.bestPounce": "Mejor abalanzamiento",
  "awards.bestPounceHelp":
    "Mayor valor de daño de abalanzamiento de Hunter indicado por la red.",
  "awards.siIncaps": "Más incapacitados por IE",
  "awards.incapsUnit": "incapacitaciones",
  "awards.siIncapsHelp":
    "Incapacitaciones de supervivientes por IE según el contador de checkpoint de red.",
  "awards.tankDamage": "Más daño infligido como Tank",
  "awards.tankDamageHelp":
    "Daño de checkpoint del motor atribuido mientras se controlaba al Tank.",
  "player.missing": "Jugador no encontrado",
  "player.missingDetail":
    "Esta identidad no aparece en los datos de la partida seleccionada.",
  "player.back": "Volver a jugadores",
  "player.profile": "Perfil del jugador en la partida",
  "player.rating": "Puntuación L4DStats",
  "player.survivorRating": "Superviviente {rating}",
  "player.infectedRating": "Infectado {rating}",
  "player.totals": "Totales del jugador",
  "player.siKills": "Bajas de IE",
  "player.survivorDeaths": "Muertes como superviviente",
  "player.siIncaps": "Incapacitados por IE",
  "player.pinTime": "Tiempo inmovilizado",
  "player.revives": "Reanimaciones",
  "player.selectedGame": "Partida seleccionada",
  "player.mapByMap": "Mapa por mapa",
  "player.mapContributions": "Contribuciones por mapa",
  "player.map": "Mapa",
  "player.allInfected": "Todos los infectados",
  "player.pin": "Inmovilización",
  "player.survivorContribution": "Contribución como superviviente",
  "player.survivorContributionTitle": "Eliminación de amenazas y apoyo",
  "player.totalInfectedKills": "Bajas totales de infectados",
  "player.specialInfectedKills": "Bajas de infectados especiales",
  "player.incapsSuffered": "Incapacitaciones sufridas",
  "player.tankDamage": "Daño al Tank",
  "player.witchDamage": "Daño a la Witch",
  "player.infectedContribution": "Contribución como infectado",
  "player.infectedContributionTitle": "Control y conversión",
  "player.siDeaths": "Muertes como IE",
  "player.survivorsIncapped": "Supervivientes incapacitados",
  "player.pounces": "Abalanzamientos",
  "player.bestPounce": "Mejor abalanzamiento",
  "player.ghostTime": "Tiempo como fantasma",
  "player.tankDamageDealt": "Daño infligido como Tank",
  "player.networkCounters": "Contadores de checkpoint de red",
  "common.notAvailable": "N/D",
  "error.renderTitle": "L4DStats no ha podido mostrar esta página",
  "error.renderDetail": "Recarga la página para volver a intentarlo.",
};

export type TranslationKey = keyof typeof english;
type I18nValue = {
  locale: Locale;
  setLocale(locale: Locale): void;
  t(key: TranslationKey, variables?: Variables): string;
  tx(english: string, spanish: string, variables?: Variables): string;
};

const I18nContext = createContext<I18nValue | undefined>(undefined);
const localeKey = "l4dstats.locale";

export function resolveLocale(
  stored: string | null,
  cookie: string,
  languages: readonly string[],
): Locale {
  if (stored === "en" || stored === "es") return stored;
  const cookieLocale = cookie
    .split(";")
    .map((part) => part.trim().split("="))
    .find(([name]) => name === "l4dstats_locale")?.[1];
  if (cookieLocale === "en" || cookieLocale === "es") return cookieLocale;
  for (const language of languages) {
    const base = language.toLowerCase().split("-")[0];
    if (base === "en" || base === "es") return base;
  }
  return "en";
}

function preferredLocale(): Locale {
  return resolveLocale(
    localStorage.getItem(localeKey),
    document.cookie,
    navigator.languages,
  );
}

function interpolate(template: string, variables: Variables = {}): string {
  return template.replace(/\{([^}]+)\}/g, (match, key: string) =>
    key in variables ? String(variables[key]) : match,
  );
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, updateLocale] = useState<Locale>(preferredLocale);
  useEffect(() => {
    document.documentElement.lang = locale;
    document.cookie = `l4dstats_locale=${locale}; Path=/; Max-Age=31536000; SameSite=Lax`;
  }, [locale]);
  const value = useMemo<I18nValue>(
    () => ({
      locale,
      setLocale(next) {
        localStorage.setItem(localeKey, next);
        updateLocale(next);
      },
      t(key, variables) {
        return interpolate(
          (locale === "es" ? spanish : english)[key],
          variables,
        );
      },
      tx(englishText, spanishText, variables) {
        return interpolate(
          locale === "es" ? spanishText : englishText,
          variables,
        );
      },
    }),
    [locale],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used inside I18nProvider");
  return value;
}
