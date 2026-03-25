const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'asteria-empire-secret';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      nickname VARCHAR(50) NOT NULL,
      email VARCHAR(100) NOT NULL UNIQUE,
      password VARCHAR(255) NOT NULL,
      league VARCHAR(20) NOT NULL DEFAULT 'dust',
      level INTEGER NOT NULL DEFAULT 1,
      ap INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log('DB 준비 완료');
}
initDB();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/auth/register', async (req, res) => {
  const { nickname, email, password } = req.body;
  if (!nickname || !email || !password) return res.status(400).json({ message: '모든 항목을 입력해 주세요.' });
  if (password.length < 8) return res.status(400).json({ message: '비밀번호는 8자 이상이어야 합니다.' });
  try {
    const exists = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (exists.rows.length > 0) return res.status(409).json({ message: '이미 사용 중인 이메일입니다.' });
    const hashed = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (nickname, email, password) VALUES ($1, $2, $3) RETURNING id',
      [nickname, email, hashed]
    );
    const token = jwt.sign(
      { id: result.rows[0].id, nickname, email, league: 'dust', level: 1 },
      JWT_SECRET, { expiresIn: '7d' }
    );
    res.status(201).json({ token, nickname, league: 'dust', level: 1 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ message: '이메일과 비밀번호를 입력해 주세요.' });
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];
    if (!user) return res.status(401).json({ message: '이메일 또는 비밀번호가 틀립니다.' });
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ message: '이메일 또는 비밀번호가 틀립니다.' });
    const token = jwt.sign(
      { id: user.id, nickname: user.nickname, email: user.email, league: user.league, level: user.level },
      JWT_SECRET, { expiresIn: '7d' }
    );
    res.json({ token, nickname: user.nickname, league: user.league, level: user.level });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

app.get('/api/auth/me', async (req, res) => {
  const header = req.headers['authorization'];
  const token = header && header.split(' ')[1];
  if (!token) return res.status(401).json({ message: '인증이 필요합니다.' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const result = await pool.query(
      'SELECT id, nickname, email, league, level, ap, created_at FROM users WHERE id = $1',
      [decoded.id]
    );
    const user = result.rows[0];
    if (!user) return res.status(404).json({ message: '사용자를 찾을 수 없습니다.' });
    res.json(user);
  } catch {
    res.status(403).json({ message: '유효하지 않은 토큰입니다.' });
  }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log('ASTERIA 실행 중: http://localhost:' + PORT));