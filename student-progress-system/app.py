import os
from datetime import datetime, date, timedelta

from flask import Flask, render_template, request, redirect, url_for, session, flash, send_from_directory, abort
import mysql.connector
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename

import config

app = Flask(__name__)
app.secret_key = config.SECRET_KEY
app.config['UPLOAD_FOLDER'] = config.UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = 5 * 1024 * 1024  # 5 MB

ALLOWED_EXTENSIONS = {'pdf', 'doc', 'docx', 'ppt', 'pptx', 'jpg', 'jpeg', 'png'}


def get_db_connection():
    return mysql.connector.connect(
        host=config.MYSQL_HOST,
        user=config.MYSQL_USER,
        password=config.MYSQL_PASSWORD,
        database=config.MYSQL_DATABASE,
        autocommit=False
    )


def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


def login_required(f):
    from functools import wraps

    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user_id' not in session:
            return redirect(url_for('login'))
        return f(*args, **kwargs)

    return decorated_function


@app.route('/')
def index():
    if 'user_id' in session:
        return redirect(url_for('dashboard'))
    return redirect(url_for('login'))


@app.route('/register', methods=['GET', 'POST'])
def register():
    if request.method == 'POST':
        name = request.form.get('name')
        email = request.form.get('email')
        password = request.form.get('password')
        course = request.form.get('course')
        semester = request.form.get('semester')

        if not (name and email and password and course and semester):
            flash('Please fill all required fields', 'danger')
            return redirect(url_for('register'))

        hashed = generate_password_hash(password)

        conn = get_db_connection()
        cursor = conn.cursor()
        try:
            cursor.execute('INSERT INTO users (name, email, password, course, semester) VALUES (%s,%s,%s,%s,%s)',
                           (name, email, hashed, course, semester))
            conn.commit()
            flash('Registration successful. Please log in.', 'success')
            return redirect(url_for('login'))
        except mysql.connector.IntegrityError:
            flash('Email already exists.', 'danger')
            return redirect(url_for('register'))
        except Exception:
            flash('Database error. Please check your configuration.', 'danger')
            return redirect(url_for('register'))
        finally:
            cursor.close()
            conn.close()

    return render_template('register.html')


@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        email = request.form.get('email')
        password = request.form.get('password')

        if not (email and password):
            flash('Please provide email and password', 'danger')
            return redirect(url_for('login'))

        conn = get_db_connection()
        cursor = conn.cursor(dictionary=True)
        cursor.execute('SELECT * FROM users WHERE email=%s', (email,))
        user = cursor.fetchone()
        cursor.close()
        conn.close()

        if user and check_password_hash(user['password'], password):
            session['user_id'] = user['id']
            session['user_name'] = user['name']
            flash('Logged in successfully', 'success')
            return redirect(url_for('dashboard'))
        else:
            flash('Invalid credentials', 'danger')
            return redirect(url_for('login'))

    return render_template('login.html')


@app.route('/logout')
def logout():
    session.clear()
    flash('Logged out', 'success')
    return redirect(url_for('login'))


@app.route('/dashboard')
@login_required
def dashboard():
    user_id = session['user_id']
    today = date.today()

    conn = get_db_connection()
    cursor = conn.cursor(dictionary=True)

    # Today's goals
    cursor.execute('SELECT COUNT(*) AS total FROM goals WHERE user_id=%s AND goal_date=%s', (user_id, today))
    todays_total = cursor.fetchone()['total']

    cursor.execute("SELECT COUNT(*) AS completed FROM goals WHERE user_id=%s AND goal_date=%s AND status='completed'", (user_id, today))
    todays_completed = cursor.fetchone()['completed']

    todays_pending = todays_total - todays_completed

    # Weekly progress percentage
    start_of_week = today - timedelta(days=today.weekday())
    end_of_week = start_of_week + timedelta(days=6)
    cursor.execute('SELECT COUNT(*) AS total FROM goals WHERE user_id=%s AND goal_date BETWEEN %s AND %s', (user_id, start_of_week, end_of_week))
    week_total = cursor.fetchone()['total']
    if week_total:
        cursor.execute("SELECT COUNT(*) AS completed FROM goals WHERE user_id=%s AND status='completed' AND goal_date BETWEEN %s AND %s", (user_id, start_of_week, end_of_week))
        week_completed = cursor.fetchone()['completed']
        weekly_progress = int((week_completed / week_total) * 100)
    else:
        weekly_progress = 0

    # Fetch today's goals list
    cursor.execute('SELECT * FROM goals WHERE user_id=%s AND goal_date=%s ORDER BY created_at DESC', (user_id, today))
    todays_goals = cursor.fetchall()

    cursor.close()
    conn.close()

    return render_template('dashboard.html', name=session.get('user_name'), today=today, todays_total=todays_total,
                           todays_completed=todays_completed, todays_pending=todays_pending,
                           weekly_progress=weekly_progress, todays_goals=todays_goals)


@app.route('/goals')
@login_required
def goals():
    user_id = session['user_id']
    conn = get_db_connection()
    cursor = conn.cursor(dictionary=True)
    cursor.execute('SELECT * FROM goals WHERE user_id=%s ORDER BY goal_date DESC, created_at DESC', (user_id,))
    all_goals = cursor.fetchall()
    # today's goals for review
    today = date.today()
    cursor.execute('SELECT * FROM goals WHERE user_id=%s AND goal_date=%s ORDER BY created_at DESC', (user_id, today))
    todays_goals = cursor.fetchall()
    cursor.close()
    conn.close()
    return render_template('goals.html', goals=all_goals, todays_goals=todays_goals)


@app.route('/goals/add', methods=['POST'])
@login_required
def add_goal():
    user_id = session['user_id']
    title = request.form.get('title')
    description = request.form.get('description')
    subject = request.form.get('subject')
    goal_date = request.form.get('goal_date')
    target_minutes = request.form.get('target_minutes') or 0

    if not (title and goal_date):
        flash('Title and Date are required', 'danger')
        return redirect(url_for('goals'))

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('INSERT INTO goals (user_id, title, description, subject, goal_date, target_minutes) VALUES (%s,%s,%s,%s,%s,%s)',
                   (user_id, title, description, subject, goal_date, target_minutes))
    conn.commit()
    cursor.close()
    conn.close()
    flash('Goal added', 'success')
    return redirect(url_for('goals'))


@app.route('/goals/edit/<int:goal_id>', methods=['GET', 'POST'])
@login_required
def edit_goal(goal_id):
    user_id = session['user_id']
    conn = get_db_connection()
    cursor = conn.cursor(dictionary=True)
    cursor.execute('SELECT * FROM goals WHERE id=%s AND user_id=%s', (goal_id, user_id))
    goal = cursor.fetchone()
    if not goal:
        cursor.close()
        conn.close()
        flash('Goal not found', 'danger')
        return redirect(url_for('goals'))

    if request.method == 'POST':
        title = request.form.get('title')
        description = request.form.get('description')
        subject = request.form.get('subject')
        goal_date = request.form.get('goal_date')
        target_minutes = request.form.get('target_minutes') or 0

        cursor.execute('UPDATE goals SET title=%s, description=%s, subject=%s, goal_date=%s, target_minutes=%s WHERE id=%s',
                       (title, description, subject, goal_date, target_minutes, goal_id))
        conn.commit()
        cursor.close()
        conn.close()
        flash('Goal updated', 'success')
        return redirect(url_for('goals'))

    cursor.close()
    conn.close()
    return render_template('edit_goal.html', goal=goal)


@app.route('/goals/delete/<int:goal_id>', methods=['POST'])
@login_required
def delete_goal(goal_id):
    user_id = session['user_id']
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('DELETE FROM goals WHERE id=%s AND user_id=%s', (goal_id, user_id))
    conn.commit()
    cursor.close()
    conn.close()
    flash('Goal deleted', 'success')
    return redirect(url_for('goals'))


@app.route('/goals/toggle/<int:goal_id>', methods=['POST'])
@login_required
def toggle_goal(goal_id):
    user_id = session['user_id']
    conn = get_db_connection()
    cursor = conn.cursor(dictionary=True)
    cursor.execute('SELECT status FROM goals WHERE id=%s AND user_id=%s', (goal_id, user_id))
    row = cursor.fetchone()
    if not row:
        cursor.close()
        conn.close()
        flash('Goal not found', 'danger')
        return redirect(url_for('goals'))
    new_status = 'completed' if row['status'] == 'pending' else 'pending'
    cursor.execute('UPDATE goals SET status=%s WHERE id=%s', (new_status, goal_id))
    conn.commit()
    cursor.close()
    conn.close()
    flash('Goal status updated', 'success')
    return redirect(request.referrer or url_for('goals'))


@app.route('/materials')
@login_required
def materials():
    user_id = session['user_id']
    q = request.args.get('q', '').strip()
    subject = request.args.get('subject', '')
    mtype = request.args.get('type', '')

    conn = get_db_connection()
    cursor = conn.cursor(dictionary=True)
    base_query = 'SELECT * FROM materials WHERE user_id=%s'
    params = [user_id]
    if q:
        base_query += ' AND title LIKE %s'
        params.append('%' + q + '%')
    if subject:
        base_query += ' AND subject=%s'
        params.append(subject)
    if mtype:
        base_query += ' AND material_type=%s'
        params.append(mtype)
    base_query += ' ORDER BY uploaded_at DESC'
    cursor.execute(base_query, tuple(params))
    results = cursor.fetchall()
    cursor.close()
    conn.close()
    return render_template('materials.html', materials=results)


@app.route('/materials/upload', methods=['POST'])
@login_required
def upload_material():
    user_id = session['user_id']
    title = request.form.get('title')
    subject = request.form.get('subject')
    material_type = request.form.get('material_type')
    file = request.files.get('file')

    if not (title and material_type and file):
        flash('Missing required fields', 'danger')
        return redirect(url_for('materials'))

    if not allowed_file(file.filename):
        flash('File type not allowed', 'danger')
        return redirect(url_for('materials'))

    filename = secure_filename(file.filename)
    folder_map = {'PYQ': 'pyq', 'Notes': 'notes', 'Assignment': 'assignments', 'Other': 'other'}
    subfolder = folder_map.get(material_type, 'other')
    save_dir = os.path.join(app.config['UPLOAD_FOLDER'], subfolder)
    os.makedirs(save_dir, exist_ok=True)

    timestamp = datetime.now().strftime('%Y%m%d%H%M%S')
    safe_name = f"{timestamp}_{filename}"
    file_path = os.path.join(save_dir, safe_name)
    file.save(file_path)

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('INSERT INTO materials (user_id, title, subject, material_type, file_name, file_path) VALUES (%s,%s,%s,%s,%s,%s)',
                   (user_id, title, subject, material_type, filename, file_path))
    conn.commit()
    cursor.close()
    conn.close()
    flash('Material uploaded', 'success')
    return redirect(url_for('materials'))


@app.route('/materials/download/<int:material_id>')
@login_required
def download_material(material_id):
    user_id = session['user_id']
    conn = get_db_connection()
    cursor = conn.cursor(dictionary=True)
    cursor.execute('SELECT * FROM materials WHERE id=%s AND user_id=%s', (material_id, user_id))
    row = cursor.fetchone()
    cursor.close()
    conn.close()
    if not row:
        flash('Material not found', 'danger')
        return redirect(url_for('materials'))

    directory = os.path.dirname(row['file_path'])
    real_name = row['file_name']
    return send_from_directory(directory, os.path.basename(row['file_path']), as_attachment=True, attachment_filename=real_name)


@app.route('/materials/delete/<int:material_id>', methods=['POST'])
@login_required
def delete_material(material_id):
    user_id = session['user_id']
    conn = get_db_connection()
    cursor = conn.cursor(dictionary=True)
    cursor.execute('SELECT * FROM materials WHERE id=%s AND user_id=%s', (material_id, user_id))
    row = cursor.fetchone()
    if not row:
        cursor.close()
        conn.close()
        flash('Material not found', 'danger')
        return redirect(url_for('materials'))

    try:
        if os.path.exists(row['file_path']):
            os.remove(row['file_path'])
    except Exception:
        pass

    cursor.execute('DELETE FROM materials WHERE id=%s', (material_id,))
    conn.commit()
    cursor.close()
    conn.close()
    flash('Material deleted', 'success')
    return redirect(url_for('materials'))


@app.route('/analysis')
@login_required
def analysis():
    user_id = session['user_id']
    today = date.today()
    start_of_week = today - timedelta(days=today.weekday())
    days = []
    conn = get_db_connection()
    cursor = conn.cursor(dictionary=True)

    total_goals_week = 0
    completed_goals_week = 0

    for i in range(7):
        d = start_of_week + timedelta(days=i)
        cursor.execute('SELECT COUNT(*) AS total FROM goals WHERE user_id=%s AND goal_date=%s', (user_id, d))
        total = cursor.fetchone()['total']
        cursor.execute("SELECT COUNT(*) AS completed FROM goals WHERE user_id=%s AND goal_date=%s AND status='completed'", (user_id, d))
        completed = cursor.fetchone()['completed']
        pct = int((completed / total) * 100) if total else 0
        days.append({'label': d.strftime('%A'), 'date': d, 'total': total, 'completed': completed, 'pct': pct})
        total_goals_week += total
        completed_goals_week += completed

    completion_pct = int((completed_goals_week / total_goals_week) * 100) if total_goals_week else 0

    # Subject-wise stats
    cursor.execute("SELECT subject, COUNT(*) AS total, SUM(status='completed') AS completed FROM goals WHERE user_id=%s GROUP BY subject", (user_id,))
    subject_stats = cursor.fetchall()

    cursor.close()
    conn.close()
    return render_template('analysis.html', days=days, total_goals_week=total_goals_week,
                           completed_goals_week=completed_goals_week, completion_pct=completion_pct,
                           subject_stats=subject_stats)


@app.route('/profile')
@login_required
def profile():
    user_id = session['user_id']
    conn = get_db_connection()
    cursor = conn.cursor(dictionary=True)
    cursor.execute('SELECT id, name, email, course, semester, created_at FROM users WHERE id=%s', (user_id,))
    user = cursor.fetchone()
    cursor.close()
    conn.close()
    return render_template('profile.html', user=user)


@app.route('/profile/update', methods=['POST'])
@login_required
def update_profile():
    user_id = session['user_id']
    name = request.form.get('name')
    course = request.form.get('course')
    semester = request.form.get('semester')

    if not name:
        flash('Name is required', 'danger')
        return redirect(url_for('profile'))

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('UPDATE users SET name=%s, course=%s, semester=%s WHERE id=%s', (name, course, semester, user_id))
    conn.commit()
    cursor.close()
    conn.close()
    session['user_name'] = name
    flash('Profile updated', 'success')
    return redirect(url_for('profile'))


if __name__ == '__main__':
    os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
    # create subfolders
    for s in ['pyq', 'notes', 'assignments', 'other']:
        os.makedirs(os.path.join(app.config['UPLOAD_FOLDER'], s), exist_ok=True)
    app.run(debug=True)
