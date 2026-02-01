import express from "express";
import sqlite3 from "sqlite3";
import cors from "cors";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const app = express();
const PORT = 4000;

app.use(cors());
app.use(express.json());

/* ================= Paths ================= */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = path.join(__dirname, "recipes.db");
const UPLOADS_DIR = path.join(__dirname, "uploads");

/* Ensure uploads folder exists */
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

/* ================= SQLite DB ================= */

const db = new sqlite3.Database(DB_PATH);

/* ---- Migration: add is_favorite column if missing ---- */
db.run(
  "ALTER TABLE recipes ADD COLUMN is_favorite INTEGER DEFAULT 0",
  (err) => {
    if (err && !err.message.includes("duplicate column")) {
      console.error("Add is_favorite column error:", err);
    }
  }
);

/* ---- Tables ---- */

db.run(
  `
  CREATE TABLE IF NOT EXISTS recipes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    photo TEXT,
    is_favorite INTEGER DEFAULT 0,
    created_at INTEGER,
    updated_at INTEGER
  )
`,
  (err) => {
    if (err) console.error("Create recipes table error:", err);
  }
);

db.run(
  `
  CREATE TABLE IF NOT EXISTS ingredients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recipe_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    quantity REAL NOT NULL,
    unit TEXT NOT NULL,
    FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE
  )
`,
  (err) => {
    if (err) console.error("Create ingredients table error:", err);
  }
);

db.run(
  `
  CREATE TABLE IF NOT EXISTS instructions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recipe_id INTEGER NOT NULL,
    step_number INTEGER NOT NULL,
    text TEXT NOT NULL,
    FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE
  )
`,
  (err) => {
    if (err) console.error("Create instructions table error:", err);
  }
);

/* ================= Multer ================= */

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});

const upload = multer({ storage });

app.use("/uploads", express.static(UPLOADS_DIR));

/* ================= Routes ================= */

app.get("/", (_req, res) => {
  res.send("My Cuisine API is running");
});

/* ---------- Recipes ---------- */

app.get("/recipes", (_req, res) => {
  db.all("SELECT * FROM recipes ORDER BY id DESC", (err, rows) => {
    if (err) return res.status(500).json(err);
    res.json(rows);
  });
});

app.get("/recipes/favorites", (_req, res) => {
  db.all(
    "SELECT * FROM recipes WHERE is_favorite = 1 ORDER BY updated_at DESC",
    (err, rows) => {
      if (err) return res.status(500).json(err);
      res.json(rows);
    }
  );
});

app.post("/recipes", (req, res) => {
  const { title } = req.body;
  const now = Date.now();

  if (!title || !title.trim()) {
    return res.status(400).json({ message: "Title is required" });
  }

  db.run(
    "INSERT INTO recipes (title, created_at, updated_at) VALUES (?, ?, ?)",
    [title.trim(), now, now],
    function (err) {
      if (err) return res.status(500).json(err);
      res.json({ id: this.lastID, title: title.trim() });
    }
  );
});

app.get("/recipes/:id", (req, res) => {
  db.get("SELECT * FROM recipes WHERE id = ?", [req.params.id], (err, row) => {
    if (err) return res.status(500).json(err);
    if (!row) return res.status(404).json({ message: "Not found" });
    res.json(row);
  });
});

app.put("/recipes/:id", (req, res) => {
  const { title } = req.body;
  const now = Date.now();

  if (!title || !title.trim()) {
    return res.status(400).json({ message: "Title is required" });
  }

  db.run(
    "UPDATE recipes SET title = ?, updated_at = ? WHERE id = ?",
    [title.trim(), now, req.params.id],
    function (err) {
      if (err) return res.status(500).json(err);
      res.json({ success: true });
    }
  );
});

/* ⭐ FAVORITE TOGGLE — CORRECT LOCATION */
app.patch("/recipes/:id/favorite", (req, res) => {
  const { isFavorite } = req.body;

  db.run(
    "UPDATE recipes SET is_favorite = ?, updated_at = ? WHERE id = ?",
    [isFavorite ? 1 : 0, Date.now(), req.params.id],
    function (err) {
      if (err) return res.status(500).json(err);
      res.json({ success: true });
    }
  );
});

app.delete("/recipes/:id", (req, res) => {
  db.run("DELETE FROM recipes WHERE id = ?", [req.params.id], function (err) {
    if (err) return res.status(500).json(err);
    res.json({ success: true });
  });
});

app.post("/recipes/:id/photo", upload.single("photo"), (req, res) => {
  if (!req.file) return res.status(400).json({ message: "No file uploaded" });

  db.run(
    "UPDATE recipes SET photo = ?, updated_at = ? WHERE id = ?",
    [req.file.filename, Date.now(), req.params.id],
    function (err) {
      if (err) return res.status(500).json(err);
      res.json({ photo: req.file.filename });
    }
  );
});

/* ---------- Ingredients ---------- */

app.get("/recipes/:id/ingredients", (req, res) => {
  db.all(
    "SELECT * FROM ingredients WHERE recipe_id = ? ORDER BY id ASC",
    [req.params.id],
    (err, rows) => {
      if (err) return res.status(500).json(err);
      res.json(rows);
    }
  );
});

app.post("/recipes/:id/ingredients", (req, res) => {
  const { name, quantity, unit } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ message: "Ingredient name required" });
  }
  if (Number.isNaN(Number(quantity))) {
    return res.status(400).json({ message: "Ingredient quantity required" });
  }
  if (!unit || !unit.trim()) {
    return res.status(400).json({ message: "Ingredient unit required" });
  }

  db.run(
    "INSERT INTO ingredients (recipe_id, name, quantity, unit) VALUES (?, ?, ?, ?)",
    [req.params.id, name.trim(), Number(quantity), unit.trim()],
    function (err) {
      if (err) return res.status(500).json(err);
      res.json({
        id: this.lastID,
        recipe_id: Number(req.params.id),
        name: name.trim(),
        quantity: Number(quantity),
        unit: unit.trim()
      });
    }
  );
});

app.delete("/ingredients/:id", (req, res) => {
  db.run("DELETE FROM ingredients WHERE id = ?", [req.params.id], function (err) {
    if (err) return res.status(500).json(err);
    res.json({ success: true });
  });
});

/* ---------- Instructions ---------- */

app.get("/recipes/:id/instructions", (req, res) => {
  db.all(
    "SELECT * FROM instructions WHERE recipe_id = ? ORDER BY step_number ASC",
    [req.params.id],
    (err, rows) => {
      if (err) return res.status(500).json(err);
      res.json(rows);
    }
  );
});

app.post("/recipes/:id/instructions", (req, res) => {
  const { text } = req.body;

  if (!text || !text.trim()) {
    return res.status(400).json({ message: "Instruction text required" });
  }

  db.get(
    "SELECT COALESCE(MAX(step_number), 0) AS maxStep FROM instructions WHERE recipe_id = ?",
    [req.params.id],
    (err, row) => {
      if (err) return res.status(500).json(err);

      const nextStep = row.maxStep + 1;

      db.run(
        "INSERT INTO instructions (recipe_id, step_number, text) VALUES (?, ?, ?)",
        [req.params.id, nextStep, text.trim()],
        function (err2) {
          if (err2) return res.status(500).json(err2);
          res.json({
            id: this.lastID,
            recipe_id: Number(req.params.id),
            step_number: nextStep,
            text: text.trim()
          });
        }
      );
    }
  );
});

app.delete("/instructions/:id", (req, res) => {
  db.run("DELETE FROM instructions WHERE id = ?", [req.params.id], function (err) {
    if (err) return res.status(500).json(err);
    res.json({ success: true });
  });
});

/* ================= Start ================= */

app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
});
