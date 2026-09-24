require('dotenv').config();

const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const expressLayouts = require('express-ejs-layouts');
const path = require('path');
const bcrypt = require('bcrypt');
const mysql = require('mysql2/promise');
const multer = require('multer');
const fs = require('fs');
const sanitize = require('sanitize-filename');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const UPLOAD_DIR = path.join(ROOT, 'uploads');
const TEMP_DIR = path.join(UPLOAD_DIR, 'tmp');
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 10);

fs.mkdirSync(TEMP_DIR, { recursive: true });

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST || 'localhost',
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || 'student_progress_db',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4'
});

app.set('view engine', 'ejs');
app.set('views', path.join(ROOT, 'views'));
app.use(expressLayouts);
app.set('layout', 'layout');

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use('/static', express.static(path.join(ROOT, 'static')));
app.use('/uploads', express.static(UPLOAD_DIR));

app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-only-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 8 }
}));
app.use(flash());

function todayISO() {
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}
function addDays(iso, amount) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + amount);
  return d.toISOString().slice(0, 10);
}
function escapeLike(value) {
  return value.replace(/[\\%_]/g, '\\$&');
}
function safeFileName(name) {
  const clean = sanitize(name || 'file');
  return clean || 'file';
}
function loginRequired(req, res, next) {
  if (!req.session.user_id) return res.redirect('/login');
  next();
}

app.use((req, res, next) => {
  res.locals.currentUser = req.session.user_name || null;
  res.locals.currentPath = req.path;
  res.locals.messages = req.flash();
  res.locals.formatDate = value => {
    if (!value) return '';
    const d = new Date(`${String(value).slice(0, 10)}T00:00:00`);
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  };
  next();
});

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', database: 'connected' });
  } catch (err) {
    res.status(503).json({ status: 'error', database: 'unavailable' });
  }
});

app.get('/', (req, res) => {
  if (req.session.user_id) return res.redirect('/dashboard');
  res.render('login', { pageTitle: 'Welcome back' });
});

app.get('/register', (req, res) => {
  if (req.session.user_id) return res.redirect('/dashboard');
  res.render('register', { pageTitle: 'Create account' });
});

app.post('/register', async (req, res) => {
  const name = (req.body.name || '').trim();
  const email = (req.body.email || '').trim().toLowerCase();
  const password = req.body.password || '';
  const course = (req.body.course || '').trim();
  const semester = (req.body.semester || '').trim();

  if (!name || !email || !password || !course || !semester) {
    req.flash('danger', 'Please fill in all fields.');
    return res.redirect('/register');
  }
  if (name.length > 150 || email.length > 150 || course.length > 100 || semester.length > 30) {
    req.flash('danger', 'One or more fields are too long.');
    return res.redirect('/register');
  }
  if (password.length < 6) {
    req.flash('danger', 'Password must contain at least 6 characters.');
    return res.redirect('/register');
  }

  try {
    const hash = await bcrypt.hash(password, 12);
    await pool.execute(
      'INSERT INTO users (name,email,password,course,semester) VALUES (?,?,?,?,?)',
      [name, email, hash, course, semester]
    );
    req.flash('success', 'Account created successfully. You can now sign in.');
    res.redirect('/login');
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') req.flash('danger', 'An account with this email already exists.');
    else {
      console.error(err);
      req.flash('danger', 'Could not create the account. Check your database setup.');
    }
    res.redirect('/register');
  }
});

app.get('/login', (req, res) => {
  if (req.session.user_id) return res.redirect('/dashboard');
  res.render('login', { pageTitle: 'Welcome back' });
});

app.post('/login', async (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  const password = req.body.password || '';
  if (!email || !password) {
    req.flash('danger', 'Enter your email and password.');
    return res.redirect('/login');
  }

  try {
    const [rows] = await pool.execute('SELECT * FROM users WHERE email=? LIMIT 1', [email]);
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password))) {
      req.flash('danger', 'Invalid email or password.');
      return res.redirect('/login');
    }
    req.session.user_id = user.id;
    req.session.user_name = user.name;
    req.flash('success', `Welcome back, ${user.name.split(' ')[0]}!`);
    res.redirect('/dashboard');
  } catch (err) {
    console.error(err);
    req.flash('danger', 'Login failed. Please try again.');
    res.redirect('/login');
  }
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});
app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// Dashboard
app.get('/dashboard', loginRequired, async (req, res) => {
  const userId = req.session.user_id;
  const today = todayISO();
  const weekStart = addDays(today, -new Date(`${today}T12:00:00`).getDay() + 1);
  const weekEnd = addDays(weekStart, 6);

  try {
    const [[todayStats]] = await pool.execute(`
      SELECT COUNT(*) total,
      COALESCE(SUM(status='completed'),0) completed
      FROM goals WHERE user_id=? AND goal_date=?`, [userId, today]);

    const [[weekStats]] = await pool.execute(`
      SELECT COUNT(*) total,
      COALESCE(SUM(status='completed'),0) completed
      FROM goals WHERE user_id=? AND goal_date BETWEEN ? AND ?`,
      [userId, weekStart, weekEnd]);

    const [[materialStats]] = await pool.execute(
      'SELECT COUNT(*) total FROM materials WHERE user_id=?', [userId]
    );

    const [todaysGoals] = await pool.execute(
      'SELECT * FROM goals WHERE user_id=? AND goal_date=? ORDER BY status ASC, created_at DESC',
      [userId, today]
    );

    const [recentMaterials] = await pool.execute(
      'SELECT * FROM materials WHERE user_id=? ORDER BY uploaded_at DESC LIMIT 5',
      [userId]
    );

    const weeklyProgress = weekStats.total
      ? Math.round((weekStats.completed / weekStats.total) * 100) : 0;

    res.render('dashboard', {
      pageTitle: 'Dashboard',
      today, weekStart, weekEnd,
      todaysTotal: todayStats.total,
      todaysCompleted: Number(todayStats.completed),
      todaysPending: todayStats.total - Number(todayStats.completed),
      weeklyProgress,
      materialCount: materialStats.total,
      todaysGoals,
      recentMaterials
    });
  } catch (err) {
    console.error(err);
    req.flash('danger', 'Could not load dashboard.');
    res.redirect('/login');
  }
});

// Goals
app.get('/goals', loginRequired, async (req, res) => {
  const status = ['pending', 'completed'].includes(req.query.status) ? req.query.status : '';
  const subject = (req.query.subject || '').trim();
  const userId = req.session.user_id;
  let sql = 'SELECT * FROM goals WHERE user_id=?';
  const params = [userId];

  if (status) { sql += ' AND status=?'; params.push(status); }
  if (subject) { sql += ' AND subject LIKE ?'; params.push(`%${escapeLike(subject)}%`); }
  sql += ' ORDER BY goal_date DESC, created_at DESC';

  try {
    const [goals] = await pool.execute(sql, params);
    const [[counts]] = await pool.execute(`
      SELECT COUNT(*) total,
      COALESCE(SUM(status='completed'),0) completed,
      COALESCE(SUM(status='pending'),0) pending
      FROM goals WHERE user_id=?`, [userId]);

    res.render('goals', {
      pageTitle: 'Goals',
      goals, counts,
      filters: { status, subject },
      today: todayISO()
    });
  } catch (err) {
    console.error(err);
    req.flash('danger', 'Could not load goals.');
    res.redirect('/dashboard');
  }
});

app.post('/goals/add', loginRequired, async (req, res) => {
  const title = (req.body.title || '').trim();
  const description = (req.body.description || '').trim();
  const subject = (req.body.subject || '').trim();
  const goalDate = req.body.goal_date;
  const targetMinutes = Math.max(0, Number(req.body.target_minutes || 0));

  if (!title || !goalDate) {
    req.flash('danger', 'Goal title and date are required.');
    return res.redirect('/goals');
  }
  try {
    await pool.execute(
      'INSERT INTO goals (user_id,title,description,subject,goal_date,target_minutes) VALUES (?,?,?,?,?,?)',
      [req.session.user_id, title, description || null, subject || null, goalDate, targetMinutes]
    );
    req.flash('success', 'Goal added successfully.');
  } catch (err) {
    console.error(err);
    req.flash('danger', 'Could not add the goal.');
  }
  res.redirect('/goals');
});

app.get('/goals/edit/:id', loginRequired, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM goals WHERE id=? AND user_id=?', [req.params.id, req.session.user_id]
    );
    if (!rows[0]) {
      req.flash('danger', 'Goal not found.');
      return res.redirect('/goals');
    }
    res.render('edit_goal', { pageTitle: 'Edit Goal', goal: rows[0] });
  } catch (err) {
    console.error(err);
    req.flash('danger', 'Could not load the goal.');
    res.redirect('/goals');
  }
});

app.post('/goals/edit/:id', loginRequired, async (req, res) => {
  const { title, description, subject, goal_date } = req.body;
  const targetMinutes = Math.max(0, Number(req.body.target_minutes || 0));
  if (!title || !goal_date) {
    req.flash('danger', 'Goal title and date are required.');
    return res.redirect(`/goals/edit/${req.params.id}`);
  }
  try {
    const [result] = await pool.execute(`
      UPDATE goals SET title=?, description=?, subject=?, goal_date=?, target_minutes=?
      WHERE id=? AND user_id=?`,
      [title.trim(), (description || '').trim() || null, (subject || '').trim() || null,
       goal_date, targetMinutes, req.params.id, req.session.user_id]
    );
    if (!result.affectedRows) req.flash('danger', 'Goal not found.');
    else req.flash('success', 'Goal updated successfully.');
  } catch (err) {
    console.error(err);
    req.flash('danger', 'Could not update the goal.');
  }
  res.redirect('/goals');
});

app.post('/goals/delete/:id', loginRequired, async (req, res) => {
  try {
    const [result] = await pool.execute(
      'DELETE FROM goals WHERE id=? AND user_id=?', [req.params.id, req.session.user_id]
    );
    req.flash(result.affectedRows ? 'success' : 'danger',
      result.affectedRows ? 'Goal deleted.' : 'Goal not found.');
  } catch (err) {
    console.error(err);
    req.flash('danger', 'Could not delete the goal.');
  }
  res.redirect('/goals');
});

app.post('/goals/toggle/:id', loginRequired, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT status FROM goals WHERE id=? AND user_id=?', [req.params.id, req.session.user_id]
    );
    if (!rows[0]) {
      req.flash('danger', 'Goal not found.');
      return res.redirect(req.get('referer') || '/goals');
    }
    const newStatus = rows[0].status === 'pending' ? 'completed' : 'pending';
    await pool.execute(
      'UPDATE goals SET status=? WHERE id=? AND user_id=?',
      [newStatus, req.params.id, req.session.user_id]
    );
    req.flash('success', newStatus === 'completed' ? 'Goal completed! 🎉' : 'Goal moved back to pending.');
  } catch (err) {
    console.error(err);
    req.flash('danger', 'Could not update goal status.');
  }
  res.redirect(req.get('referer') || '/goals');
});

// Materials
const ALLOWED_EXT = new Set(['.pdf','.doc','.docx','.ppt','.pptx','.jpg','.jpeg','.png']);
const upload = multer({
  dest: TEMP_DIR,
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 }
});

app.get('/materials', loginRequired, async (req, res) => {
  const q = (req.query.q || '').trim();
  const subject = (req.query.subject || '').trim();
  const type = ['PYQ','Notes','Assignment','Other'].includes(req.query.type) ? req.query.type : '';
  let sql = 'SELECT * FROM materials WHERE user_id=?';
  const params = [req.session.user_id];

  if (q) { sql += ' AND (title LIKE ? OR file_name LIKE ?)'; params.push(`%${escapeLike(q)}%`, `%${escapeLike(q)}%`); }
  if (subject) { sql += ' AND subject LIKE ?'; params.push(`%${escapeLike(subject)}%`); }
  if (type) { sql += ' AND material_type=?'; params.push(type); }
  sql += ' ORDER BY uploaded_at DESC';

  try {
    const [materials] = await pool.execute(sql, params);
    res.render('materials', { pageTitle: 'Study Materials', materials, filters: { q, subject, type }, maxUploadMb: MAX_UPLOAD_MB });
  } catch (err) {
    console.error(err);
    req.flash('danger', 'Could not load materials.');
    res.redirect('/dashboard');
  }
});

app.post('/materials/upload', loginRequired, upload.single('file'), async (req, res) => {
  const file = req.file;
  const title = (req.body.title || '').trim();
  const subject = (req.body.subject || '').trim();
  const materialType = req.body.material_type;

  try {
    if (!title || !materialType || !file) throw new Error('Please provide title, type and file.');
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) throw new Error('File type not allowed. Use PDF, DOC/DOCX, PPT/PPTX, JPG or PNG.');

    const folderMap = { PYQ:'pyq', Notes:'notes', Assignment:'assignments', Other:'other' };
    const destDir = path.join(UPLOAD_DIR, folderMap[materialType] || 'other');
    fs.mkdirSync(destDir, { recursive: true });

    const storedName = `${Date.now()}_${safeFileName(path.basename(file.originalname))}`;
    const dest = path.join(destDir, storedName);
    fs.renameSync(file.path, dest);

    await pool.execute(
      `INSERT INTO materials (user_id,title,subject,material_type,file_name,file_path)
       VALUES (?,?,?,?,?,?)`,
      [req.session.user_id, title, subject || null, materialType, file.originalname, path.relative(ROOT, dest)]
    );
    req.flash('success', 'Material uploaded successfully.');
  } catch (err) {
    if (file?.path && fs.existsSync(file.path)) fs.unlinkSync(file.path);
    req.flash('danger', err.code === 'LIMIT_FILE_SIZE'
      ? `File is too large. Maximum size is ${MAX_UPLOAD_MB} MB.`
      : (err.message || 'Upload failed.'));
  }
  res.redirect('/materials');
});

app.get('/materials/download/:id', loginRequired, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM materials WHERE id=? AND user_id=?', [req.params.id, req.session.user_id]
    );
    if (!rows[0]) {
      req.flash('danger', 'Material not found.');
      return res.redirect('/materials');
    }
    const absolute = path.resolve(ROOT, rows[0].file_path);
    if (!absolute.startsWith(path.resolve(UPLOAD_DIR) + path.sep) || !fs.existsSync(absolute)) {
      req.flash('danger', 'The stored file is missing.');
      return res.redirect('/materials');
    }
    res.download(absolute, rows[0].file_name);
  } catch (err) {
    console.error(err);
    req.flash('danger', 'Could not download the file.');
    res.redirect('/materials');
  }
});

app.post('/materials/delete/:id', loginRequired, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM materials WHERE id=? AND user_id=?', [req.params.id, req.session.user_id]
    );
    if (!rows[0]) {
      req.flash('danger', 'Material not found.');
      return res.redirect('/materials');
    }
    const absolute = path.resolve(ROOT, rows[0].file_path);
    if (fs.existsSync(absolute)) fs.unlinkSync(absolute);
    await pool.execute('DELETE FROM materials WHERE id=? AND user_id=?', [req.params.id, req.session.user_id]);
    req.flash('success', 'Material deleted.');
  } catch (err) {
    console.error(err);
    req.flash('danger', 'Could not delete the material.');
  }
  res.redirect('/materials');
});

// Analysis
app.get('/analysis', loginRequired, async (req, res) => {
  const userId = req.session.user_id;
  const today = todayISO();
  const weekStart = addDays(today, -new Date(`${today}T12:00:00`).getDay() + 1);
  const weekEnd = addDays(weekStart, 6);
  try {
    const [rows] = await pool.execute(`
      SELECT goal_date,
             COUNT(*) total,
             COALESCE(SUM(status='completed'),0) completed
      FROM goals
      WHERE user_id=? AND goal_date BETWEEN ? AND ?
      GROUP BY goal_date ORDER BY goal_date`,
      [userId, weekStart, weekEnd]
    );
    const byDate = Object.fromEntries(rows.map(r => [String(r.goal_date).slice(0,10), r]));
    const days = Array.from({ length: 7 }, (_, i) => {
      const date = addDays(weekStart, i);
      const row = byDate[date] || { total: 0, completed: 0 };
      return {
        date,
        label: new Date(`${date}T12:00:00`).toLocaleDateString('en-IN', { weekday: 'short' }),
        total: Number(row.total), completed: Number(row.completed),
        pct: row.total ? Math.round((row.completed * 100) / row.total) : 0
      };
    });
    const total = days.reduce((s,d) => s+d.total, 0);
    const completed = days.reduce((s,d) => s+d.completed, 0);

    const [subjectStats] = await pool.execute(`
      SELECT COALESCE(subject,'Unspecified') subject,
             COUNT(*) total,
             COALESCE(SUM(status='completed'),0) completed
      FROM goals WHERE user_id=? GROUP BY subject ORDER BY total DESC`, [userId]);

    res.render('analysis', {
      pageTitle: 'Weekly Analysis', days, weekStart, weekEnd,
      totalGoals: total, completedGoals: completed,
      completionPct: total ? Math.round(completed * 100 / total) : 0,
      subjectStats
    });
  } catch (err) {
    console.error(err);
    req.flash('danger', 'Could not load analysis.');
    res.redirect('/dashboard');
  }
});

// Profile
app.get('/profile', loginRequired, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id,name,email,course,semester,created_at FROM users WHERE id=?',
      [req.session.user_id]
    );
    res.render('profile', { pageTitle: 'Profile', user: rows[0] });
  } catch (err) {
    console.error(err);
    req.flash('danger', 'Could not load profile.');
    res.redirect('/dashboard');
  }
});

app.post('/profile/update', loginRequired, async (req, res) => {
  const name = (req.body.name || '').trim();
  const course = (req.body.course || '').trim();
  const semester = (req.body.semester || '').trim();
  if (!name || !course || !semester) {
    req.flash('danger', 'Name, course and semester are required.');
    return res.redirect('/profile');
  }
  try {
    await pool.execute(
      'UPDATE users SET name=?,course=?,semester=? WHERE id=?',
      [name, course, semester, req.session.user_id]
    );
    req.session.user_name = name;
    req.flash('success', 'Profile updated successfully.');
  } catch (err) {
    console.error(err);
    req.flash('danger', 'Could not update profile.');
  }
  res.redirect('/profile');
});

app.use((req, res) => {
  res.status(404).render('404', { pageTitle: 'Page not found' });
});
app.use((err, req, res, next) => {
  console.error(err);
  req.flash('danger', 'Something went wrong. Please try again.');
  res.redirect(req.get('referer') || '/dashboard');
});

async function start() {
  try {
    await pool.query('SELECT 1');
    app.listen(PORT, () => console.log(`\nStudent Progress System running at http://localhost:${PORT}\n`));
  } catch (err) {
    console.error('\nDatabase connection failed.');
    console.error('Check your .env values and make sure MySQL is running.');
    console.error(err.message);
    process.exit(1);
  }
}
start();
