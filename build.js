// Erzeugt index.html aus Breinology.md und template.html.
//   node build.js          einmal erzeugen
//   node build.js --watch  bei jeder Änderung der md-Datei neu erzeugen
const fs = require("fs");
const path = require("path");

const DIR = __dirname;
const MD = path.join(DIR, "Breinology.md");
const TEMPLATE = path.join(DIR, "template.html");
const OUT = path.join(DIR, "index.html");

// "<1" -> bis 0, ">9" -> ab 10, "1-9", "<=0", ">=10", "20%" -> Anteil an der Punktespanne
function parseRange(r) {
  r = r.replace(/\s/g, "");
  let m;
  if ((m = r.match(/^(\d+(?:[.,]\d+)?)%$/))) return { percent: +m[1].replace(",", ".") };
  if ((m = r.match(/^<=(-?\d+)$/))) return { min: null, max: +m[1] };
  if ((m = r.match(/^<(-?\d+)$/))) return { min: null, max: +m[1] - 1 };
  if ((m = r.match(/^>=(-?\d+)$/))) return { min: +m[1], max: null };
  if ((m = r.match(/^>(-?\d+)$/))) return { min: +m[1] + 1, max: null };
  if ((m = r.match(/^(-?\d+)-(-?\d+)$/))) return { min: +m[1], max: +m[2] };
  throw new Error(`Unbekannter Punktebereich "(${r})" – erlaubt sind z.B. (<1), (1-9), (>9) oder (20%)`);
}

// Prozentangaben in Punktegrenzen umrechnen: die Stufen teilen die Spanne min..max der Reihe nach auf
function resolvePercent(levels, min, max) {
  const total = levels.reduce((s, l) => s + l.percent, 0);
  if (Math.abs(total - 100) > 0.01) throw new Error(`Die Prozentangaben der Stufen ergeben ${total}% statt 100%`);
  let acc = 0;
  let lower = min;
  levels.forEach((l, i) => {
    acc += l.percent;
    const last = i === levels.length - 1;
    const upper = last ? max : Math.floor(min + (max - min) * acc / 100);
    l.min = i === 0 ? null : lower;
    l.max = last ? null : upper;
    lower = upper + 1;
    delete l.percent;
  });
}

function parse(md) {
  const data = { title: "", subtitle: "", start: [], questions: [], levels: [] };
  let mode = "intro";
  let para = [];
  const flush = () => {
    const target = mode === "start" ? data.start
      : mode === "questions" ? data.questions[data.questions.length - 1]?.info
      : data.levels[data.levels.length - 1]?.text;
    if (para.length && target) target.push(para.join(" "));
    para = [];
  };

  md.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    const where = `Zeile ${i + 1}`;
    let m;
    if (mode === "levels") {
      if ((m = line.match(/^###\s+(.*?)\s*\(([^)]*)\)\s*$/))) {
        flush();
        data.levels.push({ title: m[1], ...parseRange(m[2]), text: [] });
      } else if (line.startsWith("#")) {
        throw new Error(`${where}: Stufe braucht einen Punktebereich, z.B. "### Name (1-9)"`);
      } else if (line === "") {
        flush();
      } else if (!/^_.*_$/.test(line)) {
        para.push(line);
      }
      return;
    }
    // Freier Text (auch Bilder) auf der Startseite und zu einer Frage; leere "o"-Zeilen werden ignoriert
    const isText = line && line !== "---" && line !== "o" && !/^(#|o\s|_.*_$)/.test(line);
    if ((mode === "start" || mode === "questions") && isText) {
      para.push(line);
      return;
    }
    flush();
    if (mode === "start" && line.startsWith("#")) mode = "intro";
    if ((m = line.match(/^#\s+(.*)$/))) {
      data.title = m[1];
    } else if (/^##\s+Startseite\s*$/i.test(line)) {
      mode = "start";
    } else if (/^##\s+LEVELS\s*$/i.test(line)) {
      mode = "levels";
    } else if ((m = line.match(/^##\s+(.*)$/))) {
      mode = "questions";
      data.questions.push({ q: m[1], info: [], a: [] });
    } else if ((m = line.match(/^o\s+(.*?)\s*\(([+-]?\d+)\)$/))) {
      const q = data.questions[data.questions.length - 1];
      if (!q) throw new Error(`${where}: Antwort steht vor der ersten Frage`);
      q.a.push([m[1], +m[2]]);
    } else if (/^o\s/.test(line)) {
      throw new Error(`${where}: Antwort ohne Punkte am Ende, z.B. "(+2)": ${line}`);
    } else if (mode === "intro" && line && line !== "---" && !data.subtitle) {
      data.subtitle = line;
    }
  });
  flush();

  if (!data.questions.length) throw new Error("Keine Fragen gefunden (## Frage)");
  for (const q of data.questions) {
    if (q.a.length < 2) throw new Error(`Frage hat weniger als 2 Antworten: ${q.q}`);
  }
  if (!data.levels.length) throw new Error("Keine Stufen gefunden (## LEVELS mit ### Name (Bereich))");

  data.minScore = data.questions.reduce((s, q) => s + Math.min(...q.a.map(a => a[1])), 0);
  data.maxScore = data.questions.reduce((s, q) => s + Math.max(...q.a.map(a => a[1])), 0);
  const withPercent = data.levels.filter(l => "percent" in l).length;
  if (withPercent === data.levels.length) resolvePercent(data.levels, data.minScore, data.maxScore);
  else if (withPercent) throw new Error("Stufen bitte entweder alle in Prozent oder alle in Punkten angeben");
  return data;
}

const escHtml = s => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function build() {
  const data = parse(fs.readFileSync(MD, "utf8"));
  const json = JSON.stringify(data, null, 2).replace(/</g, "\\u003c");
  const html = fs.readFileSync(TEMPLATE, "utf8")
    .replaceAll("/*TITLE*/", escHtml(data.title))
    .replace("<p>/*SUBTITLE*/</p>", data.subtitle ? `<p>${escHtml(data.subtitle)}</p>` : "")
    .replace("/*DATA*/null", () => json);
  fs.writeFileSync(OUT, html);

  const time = new Date().toLocaleTimeString("de-AT");
  const ranges = data.levels.map(l => `${l.title} ${l.min ?? "…"}..${l.max ?? "…"}`).join(", ");
  console.log(`[${time}] index.html erzeugt: ${data.start.length ? "Startseite, " : ""}${data.questions.length} Fragen, Punkte ${data.minScore} bis ${data.maxScore}; Stufen: ${ranges}`);
}

function safeBuild() {
  try { build(); } catch (e) { console.error(`FEHLER in Breinology.md: ${e.message} – index.html bleibt unverändert`); }
}

safeBuild();

if (process.argv.includes("--watch")) {
  // Den Ordner beobachten, weil Editoren und OneDrive die Datei oft ersetzen statt sie zu ändern
  let timer;
  fs.watch(DIR, (event, file) => {
    if (file !== "Breinology.md" && file !== "template.html") return;
    clearTimeout(timer);
    timer = setTimeout(safeBuild, 300);
  });
  console.log("Beobachte Breinology.md … (Beenden mit Strg+C)");
}
