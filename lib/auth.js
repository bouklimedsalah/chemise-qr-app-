const jwt = require("jsonwebtoken");
const { HttpError } = require("./store");

function secret() {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET manquant dans les variables d'environnement.");
  return s;
}

function signToken(user) {
  return jwt.sign(
    { email: user.email, nom: user.nom, poste: String(user.poste) },
    secret(),
    { expiresIn: "12h" }
  );
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Non connecté." });
  try {
    req.user = jwt.verify(token, secret());
    next();
  } catch (e) {
    res.status(401).json({ error: "Session expirée ou invalide — reconnecte-toi." });
  }
}

// Un poste "tous" (admin) peut agir sur n'importe quelle étape.
// Les autres ne peuvent agir que sur l'étape correspondant à leur poste.
function checkPoste(user, etapeIdx) {
  if (!user) throw new HttpError(401, "Non connecté.");
  if (user.poste === "tous") return;
  if (Number(user.poste) !== Number(etapeIdx)) {
    throw new HttpError(403, "Ton poste ne permet pas d'agir sur cette étape.");
  }
}

module.exports = { signToken, requireAuth, checkPoste };
