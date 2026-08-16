// Stockage sur Google Sheets. Utilise deux feuilles dans le classeur cible :
//   "Dossiers"   — un état courant, une ligne par chemise (mise à jour en place)
//   "Mouvements" — journal d'audit, uniquement des ajouts (append), jamais modifié
//
// Configuration requise (voir README.md) :
//   SPREADSHEET_ID              : l'ID du classeur Google Sheets (dans son URL)
//   GOOGLE_SERVICE_ACCOUNT_JSON : le contenu JSON complet de la clé de compte de service
//   (le compte de service doit être ajouté en "Éditeur" sur le classeur)

const { google } = require("googleapis");
const { ARCHIVE_IDX, REF_PATTERN } = require("./etapes");
const { HttpError } = require("./store");

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const DOSSIERS_RANGE = "Dossiers!A2:J";
const MOUVEMENTS_RANGE = "Mouvements!A2:H";

const DOSSIERS_HEADERS = [
  "id", "reference", "client", "numero_bc", "contrat", "type_prestation",
  "etapeIdx", "statut", "operateurs_json", "transit_json", "date_creation",
];
const MOUVEMENTS_HEADERS = ["reference", "etapeIdx", "utilisateur", "type", "ts", "destinataire", "nextIdx", "note"];

let sheetsClient = null;
async function sheets() {
  if (sheetsClient) return sheetsClient;
  if (!SPREADSHEET_ID) throw new Error("SPREADSHEET_ID manquant dans les variables d'environnement.");
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON manquant dans les variables d'environnement.");
  const credentials = JSON.parse(raw);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  sheetsClient = google.sheets({ version: "v4", auth });
  return sheetsClient;
}

function rowToDossier(row) {
  const [id, reference, client, numero_bc, contrat, type_prestation, etapeIdx, statutRaw, operateurs_json, transit_json, date_creation] = row;
  return {
    id,
    reference,
    client: client || "",
    numero_bc: numero_bc || "",
    contrat: contrat || "",
    type_prestation: type_prestation || "",
    etapeIdx: Number(etapeIdx),
    statut: statutRaw,
    operateurs: operateurs_json ? JSON.parse(operateurs_json) : [],
    transit: transit_json ? JSON.parse(transit_json) : null,
    date_creation: Number(date_creation),
  };
}
function dossierToRow(d) {
  return [
    d.id, d.reference, d.client, d.numero_bc, d.contrat, d.type_prestation,
    d.etapeIdx, d.statut, JSON.stringify(d.operateurs), d.transit ? JSON.stringify(d.transit) : "", d.date_creation,
  ];
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

// S'assure que les feuilles et leurs en-têtes existent (appelé au premier accès).
let ensured = false;
async function ensureSheets() {
  if (ensured) return;
  const api = await sheets();
  const meta = await api.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const titles = meta.data.sheets.map((s) => s.properties.title);
  const requests = [];
  if (!titles.includes("Dossiers")) requests.push({ addSheet: { properties: { title: "Dossiers" } } });
  if (!titles.includes("Mouvements")) requests.push({ addSheet: { properties: { title: "Mouvements" } } });
  if (requests.length) await api.spreadsheets.batchUpdate({ spreadsheetId: SPREADSHEET_ID, requestBody: { requests } });
  await api.spreadsheets.values.update({ spreadsheetId: SPREADSHEET_ID, range: "Dossiers!A1", valueInputOption: "RAW", requestBody: { values: [DOSSIERS_HEADERS] } });
  await api.spreadsheets.values.update({ spreadsheetId: SPREADSHEET_ID, range: "Mouvements!A1", valueInputOption: "RAW", requestBody: { values: [MOUVEMENTS_HEADERS] } });
  ensured = true;
}

async function getAllDossierRows() {
  await ensureSheets();
  const api = await sheets();
  const res = await api.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: DOSSIERS_RANGE });
  return res.data.values || [];
}

async function listDossiers(q) {
  const rows = await getAllDossierRows();
  let list = rows.filter((r) => r[1]).map(rowToDossier);
  const query = (q || "").toLowerCase().trim();
  if (query) {
    list = list.filter((d) => [d.reference, d.client, d.numero_bc, d.contrat, d.type_prestation].join(" ").toLowerCase().includes(query));
  }
  return list.map((d) => ({ ...d, ...statusOf(d) }));
}

async function getDossier(reference) {
  const ref = String(reference).toUpperCase();
  const rows = await getAllDossierRows();
  const idx = rows.findIndex((r) => r[1] === ref);
  if (idx === -1) return null;
  const d = rowToDossier(rows[idx]);
  const api = await sheets();
  const mv = await api.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: MOUVEMENTS_RANGE });
  const historique = (mv.data.values || [])
    .filter((r) => r[0] === ref)
    .map((r) => ({ reference: r[0], etapeIdx: Number(r[1]), utilisateur: r[2], type: r[3], ts: Number(r[4]), destinataire: r[5] || undefined, nextIdx: r[6] !== "" ? Number(r[6]) : undefined, note: r[7] || undefined }))
    .sort((a, b) => a.ts - b.ts);
  return { ...d, ...statusOf(d), historique };
}

async function appendMouvement(m) {
  const api = await sheets();
  await api.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: MOUVEMENTS_RANGE,
    valueInputOption: "RAW",
    requestBody: { values: [[m.reference, m.etapeIdx, m.utilisateur || "", m.type, m.ts, m.destinataire || "", m.nextIdx ?? "", m.note || ""]] },
  });
}

async function updateDossierRow(rowIndex, dossier) {
  const api = await sheets();
  await api.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `Dossiers!A${rowIndex + 2}:K${rowIndex + 2}`,
    valueInputOption: "RAW",
    requestBody: { values: [dossierToRow(dossier)] },
  });
}

async function createDossier({ reference, client, numero_bc, contrat, type_prestation }) {
  const ref = normalizeRef(reference);
  const rows = await getAllDossierRows();
  if (rows.some((r) => r[1] === ref)) throw new HttpError(409, "Cette référence existe déjà.");
  const now = Date.now();
  const dossier = {
    id: "D" + now, reference: ref, client: client || "", numero_bc: numero_bc || "",
    contrat: contrat || "", type_prestation: type_prestation || "", etapeIdx: 0,
    statut: "en_cours", operateurs: ["Service client"], transit: null, date_creation: now,
  };
  const api = await sheets();
  await api.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID, range: DOSSIERS_RANGE, valueInputOption: "RAW",
    requestBody: { values: [dossierToRow(dossier)] },
  });
  await appendMouvement({ reference: ref, etapeIdx: 0, utilisateur: "Service client", type: "IN", ts: now });
  return { ...dossier, ...statusOf(dossier) };
}

async function findRow(reference) {
  const ref = String(reference).toUpperCase();
  const rows = await getAllDossierRows();
  const rowIndex = rows.findIndex((r) => r[1] === ref);
  if (rowIndex === -1) throw new HttpError(404, "Chemise introuvable.");
  return { rowIndex, dossier: rowToDossier(rows[rowIndex]), ref };
}

async function checkin(reference, utilisateur) {
  const name = String(utilisateur || "").trim();
  if (!name) throw new HttpError(400, "Le nom de l'utilisateur est obligatoire.");
  const { rowIndex, dossier: d, ref } = await findRow(reference);
  const now = Date.now();

  if (d.transit) {
    d.etapeIdx = d.transit.nextIdx;
    d.statut = d.transit.nextIdx === ARCHIVE_IDX ? "archive" : "en_cours";
    d.transit = null;
    d.operateurs = [name];
    await appendMouvement({ reference: ref, etapeIdx: d.etapeIdx, utilisateur: name, type: "IN", ts: now });
  } else if (!d.operateurs.includes(name)) {
    d.operateurs.push(name);
    await appendMouvement({ reference: ref, etapeIdx: d.etapeIdx, utilisateur: name, type: "IN", ts: now });
  }
  await updateDossierRow(rowIndex, d);
  return { ...d, ...statusOf(d) };
}

async function quitter(reference, utilisateur) {
  const { rowIndex, dossier: d, ref } = await findRow(reference);
  const now = Date.now();
  d.operateurs = d.operateurs.filter((o) => o !== utilisateur);
  await appendMouvement({ reference: ref, etapeIdx: d.etapeIdx, utilisateur, type: "OUT", ts: now, note: "quitte sans faire avancer" });
  await updateDossierRow(rowIndex, d);
  return { ...d, ...statusOf(d) };
}

async function checkout(reference, nextIdx, destinataire) {
  const dest = String(destinataire || "").trim();
  if (nextIdx === undefined || nextIdx === null || !dest) {
    throw new HttpError(400, "L'étape suivante et le destinataire sont obligatoires.");
  }
  const { rowIndex, dossier: d, ref } = await findRow(reference);
  const now = Date.now();
  for (const op of d.operateurs) {
    await appendMouvement({ reference: ref, etapeIdx: d.etapeIdx, utilisateur: op, type: "OUT", ts: now });
  }
  await appendMouvement({ reference: ref, etapeIdx: d.etapeIdx, type: "TRANSIT", nextIdx: Number(nextIdx), destinataire: dest, ts: now });
  d.operateurs = [];
  d.transit = { nextIdx: Number(nextIdx), destinataire: dest };
  await updateDossierRow(rowIndex, d);
  return { ...d, ...statusOf(d) };
}

// ---- Utilisateurs (feuille "Utilisateurs" : email | mot_de_passe | nom | poste | actif) ----
const USERS_RANGE = "Utilisateurs!A2:E";

async function ensureUsersSheet() {
  const api = await sheets();
  const meta = await api.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const titles = meta.data.sheets.map((s) => s.properties.title);
  if (!titles.includes("Utilisateurs")) {
    await api.spreadsheets.batchUpdate({ spreadsheetId: SPREADSHEET_ID, requestBody: { requests: [{ addSheet: { properties: { title: "Utilisateurs" } } }] } });
    await api.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID, range: "Utilisateurs!A1", valueInputOption: "RAW",
      requestBody: { values: [["email", "mot_de_passe", "nom", "poste", "actif"]] },
    });
  }
}

async function getUserByEmail(email) {
  await ensureUsersSheet();
  const api = await sheets();
  const res = await api.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: USERS_RANGE });
  const rows = res.data.values || [];
  const row = rows.find((r) => (r[0] || "").toLowerCase() === String(email || "").toLowerCase() && r[4] !== "FALSE" && r[4] !== "false");
  if (!row) return null;
  return { email: row[0], mot_de_passe: row[1], nom: row[2], poste: row[3] };
}

module.exports = { listDossiers, getDossier, createDossier, checkin, quitter, checkout, getUserByEmail };
