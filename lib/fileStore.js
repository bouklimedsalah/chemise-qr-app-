const fs = require("fs");
const path = require("path");
const { ARCHIVE_IDX, REF_PATTERN } = require("./etapes");
const { HttpError } = require("./store");

const DATA_FILE = path.join(__dirname, "..", "server", "data.json");
const SEED_FILE = path.join(__dirname, "..", "server", "data.seed.json");

function load() {
  if (!fs.existsSync(DATA_FILE)) fs.copyFileSync(SEED_FILE, DATA_FILE);
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
}
function save(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function statusOf(d) {
  if (d.transit) return { statut: "en_transit", label: `En transit vers l'étape ${d.transit.nextIdx}`, cible: d.transit };
  if (d.statut === "archive") return { statut: "archive", label: "Archivé" };
  return { statut: "en_cours", label: `En cours — étape ${d.etapeIdx}` };
}

function normalizeRef(reference) {
  const ref = String(reference || "").trim().toUpperCase();
  if (!REF_PATTERN.test(ref)) {
    throw new HttpError(400, "Format invalide — le N° de chemise doit être du type 26OT0000 (2 chiffres, 2 lettres, 4 chiffres).");
  }
  return ref;
}

async function listDossiers(q) {
  const data = load();
  const query = (q || "").toLowerCase().trim();
  let list = data.dossiers;
  if (query) {
    list = list.filter((d) =>
      [d.reference, d.client, d.numero_bc, d.contrat, d.type_prestation].join(" ").toLowerCase().includes(query)
    );
  }
  return list.map((d) => ({ ...d, ...statusOf(d) }));
}

async function getDossier(reference) {
  const data = load();
  const ref = String(reference).toUpperCase();
  const d = data.dossiers.find((x) => x.reference === ref);
  if (!d) return null;
  const historique = data.mouvements.filter((m) => m.reference === ref).sort((a, b) => a.ts - b.ts);
  return { ...d, ...statusOf(d), historique };
}

async function createDossier({ reference, client, numero_bc, contrat, type_prestation }) {
  const ref = normalizeRef(reference);
  const data = load();
  if (data.dossiers.some((d) => d.reference === ref)) {
    throw new HttpError(409, "Cette référence existe déjà.");
  }
  const now = Date.now();
  const dossier = {
    id: "D" + now,
    reference: ref,
    client: client || "",
    numero_bc: numero_bc || "",
    contrat: contrat || "",
    type_prestation: type_prestation || "",
    etapeIdx: 0,
    statut: "en_cours",
    operateurs: ["Service client"],
    transit: null,
    date_creation: now,
  };
  data.dossiers.unshift(dossier);
  data.mouvements.push({ reference: ref, etapeIdx: 0, utilisateur: "Service client", type: "IN", ts: now });
  save(data);
  return { ...dossier, ...statusOf(dossier) };
}

async function checkin(reference, utilisateur) {
  const name = String(utilisateur || "").trim();
  if (!name) throw new HttpError(400, "Le nom de l'utilisateur est obligatoire.");
  const data = load();
  const ref = String(reference).toUpperCase();
  const d = data.dossiers.find((x) => x.reference === ref);
  if (!d) throw new HttpError(404, "Chemise introuvable.");
  const now = Date.now();

  if (d.transit) {
    d.etapeIdx = d.transit.nextIdx;
    d.statut = d.transit.nextIdx === ARCHIVE_IDX ? "archive" : "en_cours";
    d.transit = null;
    d.operateurs = [name];
    data.mouvements.push({ reference: ref, etapeIdx: d.etapeIdx, utilisateur: name, type: "IN", ts: now });
  } else if (!d.operateurs.includes(name)) {
    d.operateurs.push(name);
    data.mouvements.push({ reference: ref, etapeIdx: d.etapeIdx, utilisateur: name, type: "IN", ts: now });
  }
  save(data);
  return { ...d, ...statusOf(d) };
}

async function quitter(reference, utilisateur) {
  const data = load();
  const ref = String(reference).toUpperCase();
  const d = data.dossiers.find((x) => x.reference === ref);
  if (!d) throw new HttpError(404, "Chemise introuvable.");
  const now = Date.now();
  d.operateurs = d.operateurs.filter((o) => o !== utilisateur);
  data.mouvements.push({ reference: ref, etapeIdx: d.etapeIdx, utilisateur, type: "OUT", ts: now, note: "quitte sans faire avancer" });
  save(data);
  return { ...d, ...statusOf(d) };
}

async function checkout(reference, nextIdx, destinataire) {
  const dest = String(destinataire || "").trim();
  if (nextIdx === undefined || nextIdx === null || !dest) {
    throw new HttpError(400, "L'étape suivante et le destinataire sont obligatoires.");
  }
  const data = load();
  const ref = String(reference).toUpperCase();
  const d = data.dossiers.find((x) => x.reference === ref);
  if (!d) throw new HttpError(404, "Chemise introuvable.");
  const now = Date.now();

  for (const op of d.operateurs) {
    data.mouvements.push({ reference: ref, etapeIdx: d.etapeIdx, utilisateur: op, type: "OUT", ts: now });
  }
  data.mouvements.push({ reference: ref, etapeIdx: d.etapeIdx, type: "TRANSIT", nextIdx: Number(nextIdx), destinataire: dest, ts: now });
  d.operateurs = [];
  d.transit = { nextIdx: Number(nextIdx), destinataire: dest };
  save(data);
  return { ...d, ...statusOf(d) };
}

async function getUserByEmail(email) {
  const data = load();
  const users = data.utilisateurs || [];
  const u = users.find((x) => x.email.toLowerCase() === String(email || "").toLowerCase() && x.actif !== false);
  return u || null;
}

module.exports = { listDossiers, getDossier, createDossier, checkin, quitter, checkout, getUserByEmail };
