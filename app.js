const dataUrl = "./data/torneo.json";
const errorBox = document.querySelector("#load-error");
let currentRanking = "net";
let currentStandings = [];
let currentValidRounds = [];

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
}

function validateData(data) {
  if (!data?.tournament || !Array.isArray(data.players) || !Array.isArray(data.calendar) || !Array.isArray(data.rounds)) {
    throw new Error("Il file dei dati non contiene giocatori, calendario e risultati nel formato previsto.");
  }

  const playerIds = new Set();
  for (const player of data.players) {
    if (!player.id || !player.name || playerIds.has(player.id)) {
      throw new Error("Il file contiene un giocatore senza identificativo o con un identificativo duplicato.");
    }
    playerIds.add(player.id);
  }

  const jokerUsers = new Set();
  for (const round of data.rounds) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(round.date) || !Array.isArray(round.placements)) {
      throw new Error("Ogni serata deve avere una data nel formato AAAA-MM-GG e un elenco di piazzamenti.");
    }
    if (round.placements.length > data.tournament.playerLimit) {
      throw new Error(`Troppi piazzamenti nella serata del ${round.date}.`);
    }
    const participants = round.placements.filter(Boolean);
    if (new Set(participants).size !== participants.length || participants.some((id) => !playerIds.has(id))) {
      throw new Error(`Giocatore sconosciuto o ripetuto nella serata del ${round.date}.`);
    }
    if (round.jokerPlayerId !== null) {
      if (!participants.includes(round.jokerPlayerId)) {
        throw new Error(`Il jolly della serata del ${round.date} non è tra i giocatori classificati.`);
      }
      if (jokerUsers.has(round.jokerPlayerId)) {
        throw new Error(`Il jolly risulta usato più di una volta da ${round.jokerPlayerId}.`);
      }
      jokerUsers.add(round.jokerPlayerId);
    }
  }
}

function getValidRounds(data) {
  return data.rounds.filter((round) => round.placements.filter(Boolean).length >= data.tournament.minimumPlayers);
}

function scoreFor(data, placement, usedJoker) {
  const f1Points = data.tournament.f1PointsByPlacement[placement - 1] ?? 0;
  return data.tournament.presencePoints + f1Points * (usedJoker ? data.tournament.jokerMultiplier : 1);
}

function getStandings(data, rounds) {
  const stats = new Map(data.players.map((player) => [player.id, {
    player,
    attendance: 0,
    wins: 0,
    seconds: 0,
    thirds: 0,
    scores: [],
    jokers: 0,
    jokerBonus: 0,
  }]));

  for (const round of rounds) {
    for (const [index, playerId] of round.placements.entries()) {
      if (!playerId) continue;
      const entry = stats.get(playerId);
      const placement = index + 1;
      const usedJoker = round.jokerPlayerId === playerId;
      entry.attendance += 1;
      entry.scores.push(scoreFor(data, placement, usedJoker));
      if (placement === 1) entry.wins += 1;
      if (placement === 2) entry.seconds += 1;
      if (placement === 3) entry.thirds += 1;
      if (usedJoker) {
        entry.jokers += 1;
        entry.jokerBonus += data.tournament.f1PointsByPlacement[placement - 1] ?? 0;
      }
    }

    const present = new Set(round.placements.filter(Boolean));
    for (const entry of stats.values()) {
      if (!present.has(entry.player.id)) entry.scores.push(0);
    }
  }

  return [...stats.values()]
    .map((entry) => {
      const orderedScores = [...entry.scores].sort((a, b) => a - b);
      const discarded = orderedScores.slice(0, data.tournament.discardedResults);
      const gross = entry.scores.reduce((sum, score) => sum + score, 0);
      return {
        ...entry,
        gross,
        discarded,
        net: gross - discarded.reduce((sum, score) => sum + score, 0),
      };
    });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function renderStandings(standings, validRounds, ranking = currentRanking) {
  const body = document.querySelector("#standings-body");
  const note = document.querySelector("#standings-note");
  if (validRounds.length === 0) {
    body.innerHTML = '<tr><td colspan="12" class="loading-cell">La classifica prenderà forma dopo la prima serata valida.</td></tr>';
    note.textContent = "Nessun risultato è stato ancora caricato.";
    return;
  }

  const scoreKey = ranking === "gross" ? "gross" : "net";
  const orderedStandings = [...standings].sort((a, b) =>
    b[scoreKey] - a[scoreKey] ||
    a.player.name.localeCompare(b.player.name, "it"));
  let previousPoints = null;
  let rank = 0;
  body.innerHTML = orderedStandings.map((entry, index) => {
    if (entry[scoreKey] !== previousPoints) rank = index + 1;
    previousPoints = entry[scoreKey];
    const firstDiscard = entry.discarded[0] ?? "—";
    const secondDiscard = entry.discarded[1] ?? "—";
    return `<tr>
      <td class="rank-cell">${rank === 1 ? "♛ 1°" : `${rank}°`}</td>
      <td class="player-cell">${escapeHtml(entry.player.name)}</td>
      <td>${entry.attendance}</td>
      <td>${entry.wins}</td>
      <td>${entry.seconds}</td>
      <td>${entry.thirds}</td>
      <td>${entry.gross}</td>
      <td>${entry.jokers}</td>
      <td>${entry.jokerBonus}</td>
      <td>${firstDiscard}</td>
      <td>${secondDiscard}</td>
      <td class="points-cell">${entry.net}</td>
    </tr>`;
  }).join("");
  note.textContent = ranking === "gross"
    ? `Ordinata per punti lordi: presenza e F1 inclusi; il jolly raddoppia solo F1. Il bonus jolly mostra i punti F1 aggiuntivi. Serate valide: ${validRounds.length}.`
    : `Ordinata per punti netti: punti lordi meno i due risultati peggiori delle serate valide, assenze incluse. Il bonus jolly è già compreso nei punti lordi. Serate valide: ${validRounds.length}.`;
}

function formatDate(isoDate) {
  const date = new Date(`${isoDate}T12:00:00`);
  return new Intl.DateTimeFormat("it-IT", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

function render(data) {
  validateData(data);
  const validRounds = getValidRounds(data);
  const standings = getStandings(data, validRounds);
  currentStandings = standings;
  currentValidRounds = validRounds;

  document.querySelector("#player-count").textContent = data.players.length;
  document.querySelector("#round-count").textContent = data.calendar.length;
  document.querySelector("#result-count").textContent = validRounds.length;
  document.querySelector("#roster-count").textContent = `${data.players.length} / ${data.tournament.playerLimit}`;
  document.querySelector("#calendar-list").innerHTML = data.calendar
    .map((date) => `<li>${escapeHtml(formatDate(date))}</li>`)
    .join("");
  document.querySelector("#roster-list").innerHTML = data.players
    .map((player) => `<li>${escapeHtml(player.name)}</li>`)
    .join("");
  renderStandings(standings, validRounds);
}

document.querySelectorAll(".standings-tab").forEach((button) => {
  button.addEventListener("click", () => {
    currentRanking = button.dataset.ranking;
    document.querySelectorAll(".standings-tab").forEach((tab) => {
      tab.setAttribute("aria-pressed", String(tab === button));
    });
    renderStandings(currentStandings, currentValidRounds, currentRanking);
  });
});

async function loadTournament() {
  try {
    const response = await fetch(dataUrl);
    if (!response.ok) throw new Error(`Impossibile caricare ${dataUrl} (HTTP ${response.status}).`);
    render(await response.json());
  } catch (error) {
    showError(`Non è stato possibile caricare i dati del torneo: ${error.message}`);
    document.querySelector("#standings-body").innerHTML =
      '<tr><td colspan="12" class="loading-cell">Classifica non disponibile.</td></tr>';
    document.querySelector("#calendar-list").innerHTML =
      '<li class="loading-cell">Calendario non disponibile.</li>';
    document.querySelector("#roster-list").innerHTML =
      '<li class="loading-cell">Elenco non disponibile.</li>';
  }
}

loadTournament();
