# Student Progress & Academic Management System

A polished full-stack student productivity/academic management web app built with **Node.js + Express + EJS + MySQL + vanilla JavaScript/CSS**.

## Features

- Secure registration/login with bcrypt password hashing
- Personal dashboard with today's goals and weekly progress
- Add, edit, delete and complete/pause study goals
- Goal search and status filters
- Study material library
- Upload/download/delete PDF, DOC/DOCX, PPT/PPTX, JPG and PNG files
- Material search and type/subject filters
- Weekly analytics with daily progress bars and subject breakdown
- Profile management
- Responsive modern UI for desktop, tablet and mobile
- MySQL connection pooling
- File-size/type validation
- User ownership checks on every goal/material operation
- Friendly flash messages and error/404 pages
- `/health` endpoint to verify the server and database

## Tech stack

**Frontend:** EJS, HTML5, CSS3, JavaScript  
**Backend:** Node.js, Express  
**Database:** MySQL  
**Authentication:** Express Session + bcrypt  
**Uploads:** Multer

---

# 1. Requirements

Install these first:

- Node.js 20 LTS or newer
- npm (comes with Node.js)
- MySQL 8.x (or MariaDB compatible with the schema)
- A browser
- VS Code is recommended

Check Node/npm:

```bash
node -v
npm -v
```

If Windows says `where.exe node` cannot find Node after installation, close **all** old terminals/VS Code windows and open a new terminal. If it still fails, add the Node.js installation folder to Windows PATH and reopen the terminal.

---

# 2. Extract the project

Extract the ZIP and open this folder in VS Code:

```text
Student_management_sys/
└── student-progress-system/
```

All commands below must be run **inside `student-progress-system`**.

---

# 3. Install Node packages

```bash
npm install
```

For development with automatic restart:

```bash
npm run dev
```

For normal use:

```bash
npm start
```

---

# 4. Create the MySQL database

## Option A — MySQL Workbench

1. Open MySQL Workbench.
2. Connect to your local MySQL server.
3. Open `database.sql`.
4. Run the complete file.

It creates:

```text
student_progress_db
  ├── users
  ├── goals
  └── materials
```

## Option B — MySQL terminal

```bash
mysql -u root -p < database.sql
```

Enter your MySQL password when asked.

If your MySQL command is not available, open MySQL Workbench and use Option A.

---

# 5. Configure the application

Copy:

```text
.env.example
```

to:

```text
.env
```

Then edit `.env`.

Example:

```env
PORT=3000
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=your_mysql_password
MYSQL_DATABASE=student_progress_db
SESSION_SECRET=put_a_long_random_secret_here
MAX_UPLOAD_MB=10
```

### Important

Replace:

```env
MYSQL_PASSWORD=your_mysql_password
```

with the password of your local MySQL `root` user.

Do not upload `.env` to GitHub. It is already ignored by `.gitignore`.

---

# 6. Start the application

```bash
npm start
```

You should see:

```text
Student Progress System running at http://localhost:3000
```

Open:

**http://localhost:3000**

You can also check:

**http://localhost:3000/health**

A healthy installation returns:

```json
{
  "status": "ok",
  "database": "connected"
}
```

---

# 7. First use

1. Open `/register`.
2. Create an account.
3. Login.
4. Add a few goals.
5. Mark goals completed.
6. Upload notes/PYQs/assignments.
7. Open **Analysis** to see weekly progress.
8. Open **Profile** to update your course/semester.

---

# 8. Recommended demo data

For a college presentation/demo, create these goals:

- Complete DSA Arrays — DSA — 60 min
- Revise Operating Systems — OS — 45 min
- Practice SQL Queries — DBMS — 45 min
- Read Cloud Computing Notes — Cloud — 30 min
- Solve Previous Year Questions — DSA — 60 min

Mark 2–3 as completed. The dashboard and analysis pages will immediately look populated.

Upload sample:
- OS Notes.pdf
- DSA PYQ.pdf
- DBMS Assignment.pdf

---

# 9. Project structure

```text
student-progress-system/
├── server.js
├── package.json
├── database.sql
├── .env.example
├── .gitignore
├── README.md
├── uploads/
│   └── .gitkeep
├── static/
│   ├── css/
│   │   └── style.css
│   └── js/
│       └── script.js
└── views/
    ├── layout.ejs
    ├── login.ejs
    ├── register.ejs
    ├── dashboard.ejs
    ├── goals.ejs
    ├── edit_goal.ejs
    ├── materials.ejs
    ├── analysis.ejs
    ├── profile.ejs
    ├── 404.ejs
    └── partials/
        └── header.ejs
```

## Request flow

```text
Browser
   ↓
EJS + CSS + JavaScript
   ↓
Express / Node.js
   ↓
Authentication / Validation
   ↓
MySQL database
   ↓
uploads/ file storage
```

---

# 10. Common errors

### `npm is not recognized`

Node.js is not available in PATH.

Windows:
- Restart VS Code/PowerShell after Node installation.
- Check:

```powershell
node -v
npm -v
where.exe node
```

If `where.exe node` is empty, fix the Node.js PATH and reopen the terminal.

### `ECONNREFUSED 127.0.0.1:3306`

MySQL is not running.

Start MySQL, then run:

```bash
npm start
```

### `Access denied for user 'root'`

Your `.env` MySQL username/password is incorrect.

### `Unknown database 'student_progress_db'`

Run `database.sql` in MySQL Workbench.

### Port 3000 already in use

Change:

```env
PORT=3001
```

Then open:

```text
http://localhost:3001
```

### Upload does not work

Check:
- `uploads/` exists
- file is one of the allowed formats
- file is smaller than `MAX_UPLOAD_MB`

---

# 11. Security notes

This version includes password hashing, session authentication, parameterized SQL queries, file extension validation, upload size limits and ownership checks.

For a real public deployment, additionally use:
- HTTPS
- a production session store such as Redis
- secure cookies
- CSRF protection
- rate limiting
- stronger upload MIME/content validation
- environment-specific secrets
- a reverse proxy such as NGINX
- regular database/file backups

The included configuration is intended for a local/college project and demonstration.

---

# 12. Viva explanation

### Frontend
The frontend uses EJS templates, HTML, CSS and JavaScript. EJS renders dynamic data received from the Express server.

### Backend
Node.js with Express handles routes, authentication, form processing, goal operations and file uploads.

### Database
MySQL stores user accounts, goals and material metadata. SQL queries use parameters instead of string-concatenated user input.

### Authentication
Passwords are hashed using bcrypt. Express sessions keep the logged-in user's ID on the server.

### Goals
Each goal belongs to a user using `user_id`. This prevents one user from accessing another user's goals.

### Materials
Uploaded files are stored under `uploads/`, while MySQL stores the title, type, original filename and storage path.

### Analysis
The server calculates the current week's total and completed goals and groups goals by subject.

### Architecture

```text
User
 │
 ▼
Responsive Web UI
 │
 ▼
Express.js Server
 ├── Authentication
 ├── Goal Management
 ├── Material Management
 └── Analytics
 │
 ├───────────────┐
 ▼               ▼
MySQL         File Storage
Database       uploads/
```
