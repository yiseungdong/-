const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = 3000;
const JWT_SECRET = 'asteria-empire-secret';

const db = new sqlite3.Database(path.join(__dirname, 'asteria.db'));
db.run(`CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nickname TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  league TEXT NOT NULL DEFAULT 'dust',
  level INTEGER NOT NULL DEFAULT 1,
  ap INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/auth/register', async (req, res) => {
  const { nickname, email, password } = req.body;
  if (!nickname || !email || !password) return res.status(400).json({ message: '모든 항목을 입력해 주세요.' });
  if (password.length < 8) return res.status(400).json({ message: '비밀번호는 8자 이상이어야 합니다.' });
  db.get('SELECT id FROM users WHERE email = ?', [email], async (err, row) => {
    if (row) return res.status(409).json({ message: '이미 사용 중인 이메일입니다.' });
    const hashed = await bcrypt.hash(password, 10);
    db.run('INSERT INTO users (nickname, email, password) VALUES (?, ?, ?)', [nickname, email, hashed], function (err) {
      if (err) return res.status(500).json({ message: '서버 오류입니다.' });
      const token = jwt.sign({ id: this.lastID, nickname, email, league: 'dust', level: 1 }, JWT_SECRET, { expiresIn: '7d' });
      res.status(201).json({ token, nickname, league: 'dust', level: 1 });
    });
  });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ message: '이메일과 비밀번호를 입력해 주세요.' });
  db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
    if (!user) return res.status(401).json({ message: '이메일 또는 비밀번호가 틀립니다.' });
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ message: '이메일 또는 비밀번호가 틀립니다.' });
    const token = jwt.sign({ id: user.id, nickname: user.nickname, email: user.email, league: user.league, level: user.level }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, nickname: user.nickname, league: user.league, level: user.level });
  });
});

app.get('/api/auth/me', (req, res) => {
  const header = req.headers['authorization'];
  const token = header && header.split(' ')[1];
  if (!token) return res.status(401).json({ message: '인증이 필요합니다.' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    db.get('SELECT id, nickname, email, league, level, ap FROM users WHERE id = ?', [decoded.id], (err, user) => {
      if (!user) return res.status(404).json({ message: '사용자를 찾을 수 없습니다.' });
      res.json(user);
    });
  } catch { res.status(403).json({ message: '유효하지 않은 토큰입니다.' }); }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`✦ ASTERIA 실행 중: http://localhost:${PORT}`));