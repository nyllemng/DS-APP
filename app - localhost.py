# app.py - Backend with Task Data Storage & API
# v7: Hardcoded specific LAN IP for host binding (Use with caution - '0.0.0.0' is generally preferred)
# v6: Subtract percentage equivalent from project status when non-deduction forecast marked incomplete.
# v5: Fix NameError: name 'NaN' is not defined in calculation helpers.
# v4: Update project status based on forecast item's percentage equivalent when completed (if not deduction)
# Includes detailed logging in api_dashboard
import sqlite3
import json
from flask import Flask, request, jsonify, send_from_directory
import datetime # Import datetime for date calculations
import os # Import os for checking file existence
import re # Import re for date validation
import csv # Import csv for CSV handling
import io # Import io for reading file stream
import traceback # Import for detailed error logging
from math import isnan # Import isnan to check for NaN

# --- Configuration ---
DATABASE = 'projects.db'
MAX_UPDATES_PER_PROJECT = 30 # Limit updates per project
FORECAST_LIMIT = 100 # Increased limit, adjust as needed
STATIC_FOLDER_PATH = 'static' # Define static folder path

# --- Flask App Initialization ---
# Ensure the static folder exists
if not os.path.exists(STATIC_FOLDER_PATH):
    print(f"Warning: Static folder '{STATIC_FOLDER_PATH}' not found. Creating it.")
    try:
        os.makedirs(STATIC_FOLDER_PATH)
        # Create dummy files if they don't exist after creating the folder
        for filename in ['index.html', 'updates_log.html', 'project_gantt.html', 'forecast.html', 'style.css', 'script.js', 'forecast.js', 'project_gantt.js']:
            filepath = os.path.join(STATIC_FOLDER_PATH, filename)
            if not os.path.exists(filepath):
                with open(filepath, 'w') as f:
                    if filename.endswith('.html'):
                        f.write(f"<html><head><title>{filename}</title></head><body>Placeholder for {filename}</body></html>")
                    else:
                        f.write(f"/* Placeholder for {filename} */")
                print(f" -> Created placeholder '{filename}'")
    except OSError as e:
        print(f"Error: Could not create static folder '{STATIC_FOLDER_PATH}': {e}")
        # exit(1) # Consider exiting if static folder is critical

app = Flask(__name__, static_folder=STATIC_FOLDER_PATH, static_url_path='')

# --- Database Management ---
def get_db():
    """Establishes a new database connection."""
    try:
        conn = sqlite3.connect(DATABASE)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        return conn
    except sqlite3.Error as e:
        print(f"Database connection error: {e}")
        raise

# <<< MODIFIED init_db with more logging >>>
def init_db():
    """Initializes the database schema if needed."""
    conn = None
    print("Attempting to initialize database schema...")
    try:
        conn = get_db()
        cursor = conn.cursor()
        print(f"Database connection established to '{DATABASE}'.")

        # --- Projects Table ---
        print(" -> Checking 'projects' table...")
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='projects';")
        table_exists = cursor.fetchone()
        if not table_exists:
            print(" -> Creating 'projects' table...")
            cursor.execute('''
                CREATE TABLE projects (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    ds TEXT,
                    year INTEGER,
                    project_no TEXT UNIQUE,
                    client TEXT,
                    project_name TEXT NOT NULL,
                    amount REAL,
                    status REAL NOT NULL DEFAULT 0.0 CHECK(status >= 0.0 AND status <= 100.0),
                    remaining_amount REAL,
                    total_running_weeks INTEGER,
                    po_date TEXT,
                    po_no TEXT,
                    date_completed TEXT,
                    pic TEXT,
                    address TEXT
                )
            ''')
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_project_no ON projects (project_no)")
            print(" -> 'projects' table created.")
        else:
            print(" -> 'projects' table already exists. Checking columns...")
            cursor.execute("PRAGMA table_info(projects)")
            project_columns = {column['name'] for column in cursor.fetchall()}
            # --- Schema Migrations (Example) ---
            if 'address' not in project_columns:
                try:
                    cursor.execute("ALTER TABLE projects ADD COLUMN address TEXT")
                    print(" -> Added 'address' column to 'projects'.")
                except sqlite3.OperationalError as e: print(f" -> Could not add 'address': {e}")
            # Remove old denormalized columns if they exist (optional, can be commented out)
            # if 'updates' in project_columns:
            #     try: cursor.execute("ALTER TABLE projects DROP COLUMN updates"); print(" -> Removed old 'updates' column.")
            #     except sqlite3.OperationalError: pass
            # if 'updates_completed' in project_columns:
            #     try: cursor.execute("ALTER TABLE projects DROP COLUMN updates_completed"); print(" -> Removed old 'updates_completed' column.")
            #     except sqlite3.OperationalError: pass
            # --- End Schema Migrations ---

        # --- Project Updates Table ---
        print(" -> Checking 'project_updates' table...")
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='project_updates';")
        table_exists = cursor.fetchone()
        if not table_exists:
            print(" -> Creating 'project_updates' table...")
            cursor.execute('''
                CREATE TABLE project_updates (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    project_id INTEGER NOT NULL,
                    update_text TEXT NOT NULL,
                    is_completed INTEGER NOT NULL DEFAULT 0 CHECK(is_completed IN (0, 1)),
                    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                    completion_timestamp DATETIME,
                    due_date TEXT,
                    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
                )
            ''')
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_update_project_id ON project_updates (project_id)")
            print(" -> 'project_updates' table created.")
        else:
            print(" -> 'project_updates' table exists. Checking columns...")
            cursor.execute("PRAGMA table_info(project_updates)")
            update_columns = {column['name'] for column in cursor.fetchall()}
            if 'completion_timestamp' not in update_columns:
                try: cursor.execute("ALTER TABLE project_updates ADD COLUMN completion_timestamp DATETIME"); print(" -> Added 'completion_timestamp'.")
                except sqlite3.OperationalError as e: print(f" -> Could not add 'completion_timestamp': {e}")
            if 'due_date' not in update_columns:
                try: cursor.execute("ALTER TABLE project_updates ADD COLUMN due_date TEXT"); print(" -> Added 'due_date'.")
                except sqlite3.OperationalError as e: print(f" -> Could not add 'due_date': {e}")


        # --- Forecast Items Table ---
        print(" -> Checking 'forecast_items' table...")
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='forecast_items';")
        table_exists = cursor.fetchone()
        if not table_exists:
            print(" -> Creating 'forecast_items' table...")
            cursor.execute('''
                CREATE TABLE forecast_items (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    project_id INTEGER NOT NULL,
                    forecast_date TEXT,
                    forecast_input_type TEXT NOT NULL CHECK(forecast_input_type IN ('percent', 'amount')),
                    forecast_input_value REAL NOT NULL,
                    is_forecast_completed INTEGER NOT NULL DEFAULT 0 CHECK(is_forecast_completed IN (0, 1)),
                    is_deduction INTEGER NOT NULL DEFAULT 0 CHECK(is_deduction IN (0, 1)),
                    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
                )
            ''')
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_forecast_project_id ON forecast_items (project_id)")
            print(" -> 'forecast_items' table created.")
        else:
             print(" -> 'forecast_items' table exists. Checking columns...")
             cursor.execute("PRAGMA table_info(forecast_items)")
             forecast_columns = {column['name'] for column in cursor.fetchall()}
             if 'forecast_date' not in forecast_columns:
                 try:
                     cursor.execute("ALTER TABLE forecast_items ADD COLUMN forecast_date TEXT")
                     print(" -> Added 'forecast_date' column to 'forecast_items'.")
                 except sqlite3.OperationalError as e: print(f" -> Could not add 'forecast_date' column: {e}")
             if 'is_deduction' not in forecast_columns:
                 try:
                     cursor.execute("ALTER TABLE forecast_items ADD COLUMN is_deduction INTEGER NOT NULL DEFAULT 0 CHECK(is_deduction IN (0, 1))")
                     print(" -> Added 'is_deduction' column to 'forecast_items'.")
                 except sqlite3.OperationalError as e: print(f" -> Could not add 'is_deduction' column: {e}")


        # --- Project Tasks Table (for Gantt) ---
        print(" -> Checking 'project_tasks' table...")
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='project_tasks';")
        table_exists = cursor.fetchone()
        if not table_exists:
            print(" -> Creating 'project_tasks' table...")
            cursor.execute('''
                CREATE TABLE project_tasks (
                    task_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    project_id INTEGER NOT NULL,
                    task_name TEXT NOT NULL,
                    start_date TEXT,
                    end_date TEXT,
                    planned_weight REAL,
                    actual_start TEXT,
                    actual_end TEXT,
                    assigned_to TEXT,
                    parent_task_id INTEGER,
                    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
                    FOREIGN KEY(parent_task_id) REFERENCES project_tasks(task_id) ON DELETE SET NULL
                )
            ''')
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_task_project_id ON project_tasks (project_id)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_task_parent_id ON project_tasks (parent_task_id)")
            print(" -> 'project_tasks' table created.")
        else:
            print(" -> 'project_tasks' table exists. Checking columns...")
            cursor.execute("PRAGMA table_info(project_tasks)")
            task_columns = {column['name'] for column in cursor.fetchall()}
            if 'assigned_to' not in task_columns:
                try: cursor.execute("ALTER TABLE project_tasks ADD COLUMN assigned_to TEXT"); print(" -> Added 'assigned_to'.")
                except sqlite3.OperationalError as e: print(f" -> Could not add 'assigned_to': {e}")
            if 'parent_task_id' not in task_columns:
                try:
                    cursor.execute("ALTER TABLE project_tasks ADD COLUMN parent_task_id INTEGER REFERENCES project_tasks(task_id) ON DELETE SET NULL")
                    cursor.execute("CREATE INDEX IF NOT EXISTS idx_task_parent_id ON project_tasks (parent_task_id)")
                    print(" -> Added 'parent_task_id' and index.")
                except sqlite3.OperationalError as e: print(f" -> Could not add 'parent_task_id': {e}")

        conn.commit()
        print("Database schema initialization/verification complete.") # Changed message

    except sqlite3.Error as e:
        print(f"!!!!!!!! ERROR DURING DATABASE INITIALIZATION !!!!!!!!")
        print(f"Error initializing database: {e}")
        print(traceback.format_exc()) # Print full traceback
        if conn: conn.rollback()
        # Optionally re-raise the error to stop the app if DB init is critical
        # raise e
    except Exception as e:
        print(f"!!!!!!!! UNEXPECTED ERROR DURING DATABASE INITIALIZATION !!!!!!!!")
        print(f"An unexpected error occurred during DB init: {e}")
        print(traceback.format_exc()) # Print full traceback
        if conn: conn.rollback()
        # raise e
    finally:
        if conn:
            conn.close()
            print("Database connection closed.")

# --- Data Validation & Utility Functions ---
def safe_float(value, default=None):
    """Safely convert value to float, handling None, empty strings, commas, and percent signs."""
    if value is None: return default
    str_value = str(value).replace(',', '').replace('%', '').strip()
    if str_value == '': return default
    try: return float(str_value)
    except (ValueError, TypeError): return default

def safe_int(value, default=None):
    """Safely convert value to integer, handling floats if they represent whole numbers."""
    float_val = safe_float(value, default=None)
    if float_val is None: return default
    try:
        # Check if the float is essentially an integer
        if abs(float_val - int(float_val)) < 1e-9: # Tolerance for floating point inaccuracies
             return int(float_val)
        else:
             print(f"Warning: Converting non-integer float {float_val} to int. Truncation occurred.");
             return int(float_val) # Explicitly truncate if needed, or handle as error
    except (ValueError, TypeError):
        return default


def calculate_remaining(amount_val, status_percent_val):
    """Calculate remaining amount based on total amount and status percentage."""
    amount = safe_float(amount_val)
    status_percent = safe_float(status_percent_val)
    if amount is None or status_percent is None: return None
    status_percent = max(0.0, min(100.0, status_percent))
    return amount * (1 - status_percent / 100.0)

def is_valid_date_format(date_str):
    """Check if a string is in YYYY-MM-DD format."""
    if not isinstance(date_str, str): return False
    return bool(re.match(r'^\d{4}-\d{2}-\d{2}$', date_str))

def parse_flexible_date(date_str):
    """Attempts to parse date strings in YYYY-MM-DD or M/D/YYYY formats."""
    if not date_str or not isinstance(date_str, str):
        return None
    date_str = date_str.strip()
    try:
        # Try ISO format first (more specific)
        return datetime.date.fromisoformat(date_str)
    except ValueError:
        try:
            # Try MM/DD/YYYY format
            dt_obj = datetime.datetime.strptime(date_str, '%m/%d/%Y')
            return dt_obj.date()
        except ValueError:
            # Add more formats here if needed
            # print(f"Warning: Could not parse date '{date_str}' with known formats.")
            return None # Return None if all formats fail

# --- Forecast Calculation Helpers ---
# (These are used in forecast.js as well, ensure consistency if changed)
def calculate_individual_forecast_amount(forecast_item_dict, project_amount):
    """Calculates the monetary value of a single forecast item dict."""
    if not forecast_item_dict: return 0
    # FIX: Use float('nan') instead of NaN, import isnan from math
    proj_amt = safe_float(project_amount, float('nan'))
    input_value = safe_float(forecast_item_dict.get('forecast_input_value'), 0)
    input_type = forecast_item_dict.get('forecast_input_type')
    is_deduction = bool(forecast_item_dict.get('is_deduction', False))

    forecast_amount = 0
    if input_type == 'percent':
        if isnan(proj_amt): return 0 # Check using math.isnan
        forecast_amount = proj_amt * (input_value / 100.0)
    elif input_type == 'amount':
        forecast_amount = input_value

    multiplier = -1.0 if is_deduction else 1.0
    final_amount = forecast_amount * multiplier
    # FIX: Check using math.isnan
    return 0 if isnan(final_amount) else final_amount

def calculate_individual_forecast_percent(forecast_item_dict, project_amount):
    """Calculates the percentage value of a single forecast item dict."""
    if not forecast_item_dict: return 0
    # FIX: Use float('nan') instead of NaN, import isnan from math
    proj_amt = safe_float(project_amount, float('nan'))
    # FIX: Check using math.isnan
    if isnan(proj_amt) or proj_amt == 0: return 0

    input_value = safe_float(forecast_item_dict.get('forecast_input_value'), 0)
    input_type = forecast_item_dict.get('forecast_input_type')
    is_deduction = bool(forecast_item_dict.get('is_deduction', False))

    percent = 0
    if input_type == 'percent':
        percent = input_value
    elif input_type == 'amount':
        percent = (input_value / proj_amt) * 100.0

    multiplier = -1.0 if is_deduction else 1.0
    final_percent = percent * multiplier
    # FIX: Check using math.isnan
    return 0 if isnan(final_percent) else final_percent


# --- Helper Function to Process Project Rows ---
def _process_project_rows(project_rows, cursor, forecasted_project_ids):
    """Helper to fetch updates, calculate running weeks, add forecast flag, and combine."""
    projects = []
    project_ids = [row['id'] for row in project_rows]
    updates_map = {pid: [] for pid in project_ids}
    latest_update_map = {}

    # Fetch all updates and latest update text for the retrieved projects
    if project_ids:
        placeholders = ','.join('?' * len(project_ids))
        # Fetch Updates
        cursor.execute(f"""
            SELECT project_id, id as update_id, update_text, is_completed,
                   timestamp, completion_timestamp, due_date
            FROM project_updates
            WHERE project_id IN ({placeholders})
            ORDER BY project_id, timestamp DESC, id DESC
        """, tuple(project_ids))
        for update_row in cursor.fetchall():
            update_dict = dict(update_row)
            update_dict['is_completed'] = bool(update_dict['is_completed'])
            project_id = update_dict['project_id']
            if project_id in updates_map:
                updates_map[project_id].append(update_dict)

        # Fetch Latest Update Text
        cursor.execute(f"""
            SELECT p_id, update_text
            FROM (
                SELECT
                    pu.project_id as p_id, pu.update_text,
                    ROW_NUMBER() OVER(PARTITION BY pu.project_id ORDER BY pu.timestamp DESC, pu.id DESC) as rn
                FROM project_updates pu WHERE pu.project_id IN ({placeholders})
            ) WHERE rn = 1
        """, tuple(project_ids))
        for latest_row in cursor.fetchall():
            latest_update_map[latest_row['p_id']] = latest_row['update_text']

    # Combine projects with their updates, forecast flag, and calculate running weeks
    today = datetime.date.today()

    for row in project_rows:
        project_dict = dict(row)
        project_id = project_dict['id']
        project_dict['updates'] = updates_map.get(project_id, [])
        project_dict['latest_update'] = latest_update_map.get(project_id, '')

        # --- Add has_forecasts flag ---
        project_dict['has_forecasts'] = project_id in forecasted_project_ids
        # --- End forecast flag ---

        # --- Calculate total_running_weeks with Flexible Parsing ---
        calculated_weeks = None
        po_date_str = project_dict.get('po_date')
        completed_date_str = project_dict.get('date_completed')

        start_date = parse_flexible_date(po_date_str) # Use the flexible parser

        if start_date:
            end_date = today # Default end date
            completion_date = parse_flexible_date(completed_date_str)
            if completion_date:
                end_date = min(completion_date, today) # Use earlier of completion or today

            if start_date <= end_date:
                delta = end_date - start_date
                calculated_weeks = (delta.days // 7) + 1
            else:
                calculated_weeks = 0 # PO date is in the future relative to end date
        else:
            calculated_weeks = None

        project_dict['total_running_weeks'] = calculated_weeks
        # --- End Calculation ---

        projects.append(project_dict)
    return projects


# --- API Endpoints ---

# --- Project Endpoints ---
@app.route('/api/projects', methods=['GET'])
def get_projects():
    """Fetches all active projects, calculates running weeks, includes updates and forecast flag."""
    conn = None
    try:
        conn = get_db()
        cursor = conn.cursor()
        # Fetch basic project data
        cursor.execute("""
            SELECT id, ds, year, project_no, client, project_name, amount, status,
                   remaining_amount, po_date, po_no, date_completed, pic, address
            FROM projects
            WHERE (date_completed IS NULL OR date_completed = '') AND status < 100.0
            ORDER BY CASE WHEN remaining_amount IS NULL THEN 1 ELSE 0 END, remaining_amount DESC
        """)
        project_rows = cursor.fetchall()

        # --- Get IDs of projects that have forecasts ---
        forecasted_project_ids = set()
        project_ids = [row['id'] for row in project_rows]
        if project_ids:
            placeholders = ','.join('?' * len(project_ids))
            cursor.execute(f"""
                SELECT DISTINCT project_id
                FROM forecast_items
                WHERE project_id IN ({placeholders})
            """, tuple(project_ids))
            forecasted_project_ids = {row['project_id'] for row in cursor.fetchall()}
        # --- End forecast ID fetch ---

        # Process rows using the helper, passing the forecast IDs
        projects = _process_project_rows(project_rows, cursor, forecasted_project_ids) # Pass the set

        return jsonify(projects), 200
    except Exception as e:
        print(f"Error fetching active projects: {e}")
        # Log the full traceback for server-side debugging
        traceback.print_exc()
        return jsonify({"error": "Error fetching active projects"}), 500
    finally:
        if conn: conn.close()

@app.route('/api/projects/completed', methods=['GET'])
def api_completed_projects():
    """Fetches projects marked as completed, calculates running weeks, includes updates and forecast flag."""
    conn = None
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, ds, year, project_no, client, project_name, amount, status,
                   remaining_amount, po_date, po_no, date_completed, pic, address
            FROM projects
            WHERE (date_completed IS NOT NULL AND date_completed != '') OR status >= 100.0
            ORDER BY date_completed DESC, id DESC
        """)
        project_rows = cursor.fetchall()

        # --- Get IDs of completed projects that have forecasts ---
        forecasted_project_ids = set()
        project_ids = [row['id'] for row in project_rows]
        if project_ids:
            placeholders = ','.join('?' * len(project_ids))
            cursor.execute(f"""
                SELECT DISTINCT project_id
                FROM forecast_items
                WHERE project_id IN ({placeholders})
            """, tuple(project_ids))
            forecasted_project_ids = {row['project_id'] for row in cursor.fetchall()}
        # --- End forecast ID fetch ---

        projects = _process_project_rows(project_rows, cursor, forecasted_project_ids) # Pass the set
        return jsonify(projects), 200
    except Exception as e:
        print(f"Error fetching completed projects: {e}")
        traceback.print_exc()
        return jsonify({"error": "Error fetching completed projects"}), 500
    finally:
        if conn: conn.close()

# --- Helper Function for Processing Project Data (Used by Bulk/CSV Upload) ---
def _process_and_save_project(project_data, row_num, cursor, existing_projects_map):
    """Validates, sanitizes, and inserts/updates a single project. Returns status and error message."""
    if not isinstance(project_data, dict):
        return "skipped", f"Row {row_num}: Invalid format (expected dictionary)."

    # Normalize keys
    normalized_data = {}
    for k, v in project_data.items():
        if k:
            key_str = str(k).strip()
            if not key_str: continue
            normalized_key = key_str.lower()

            # --- START FIX: Explicit Header Mapping ---
            # Map common CSV header variations to the database column name
            if normalized_key in ["project #", "project#", "project_#", "project no", "project_no."]:
                normalized_key = "project_no"
            elif normalized_key in ["project name", "project_name"]:
                 normalized_key = "project_name"
            elif normalized_key in ["client"]:
                 normalized_key = "client"
            elif normalized_key in ["amount"]:
                 normalized_key = "amount"
            elif normalized_key in ["status (%)", "status(%)", "status_%", "status"]:
                 normalized_key = "status"
            elif normalized_key in ["po date", "po_date"]:
                 normalized_key = "po_date"
            elif normalized_key in ["po no.", "po no", "po_no.", "po_no"]:
                 normalized_key = "po_no"
            elif normalized_key in ["date completed", "date_completed"]:
                 normalized_key = "date_completed"
            elif normalized_key in ["pic"]:
                 normalized_key = "pic"
            elif normalized_key in ["address"]:
                 normalized_key = "address"
            elif normalized_key in ["ds"]:
                 normalized_key = "ds"
            elif normalized_key in ["year"]:
                 normalized_key = "year"
            # Add more specific mappings if other headers are common
            else:
                # Apply general normalization as a fallback for other columns
                normalized_key = re.sub(r'[\s\(\)#%\.]+', '_', normalized_key) # Replace relevant symbols/spaces with _
                normalized_key = re.sub(r'_+', '_', normalized_key) # Collapse multiple underscores
                normalized_key = normalized_key.strip('_') # Remove leading/trailing underscores
            # --- END FIX ---

            normalized_data[normalized_key] = v


    project_name = normalized_data.get('project_name')
    if not project_name or str(project_name).strip() == '':
        return "skipped", f"Row {row_num}: Missing or empty 'Project Name'."

    # Use the correctly mapped key 'project_no'
    project_no = normalized_data.get('project_no')
    if isinstance(project_no, str): project_no = project_no.strip()
    # Treat empty string or specific non-value strings as None
    if project_no == '' or project_no == '#N/A' or project_no == 'N/A':
        project_no = None

    # Sanitize status
    raw_status = normalized_data.get('status')
    status_percent = safe_float(raw_status, default=None)
    error_status_msg = None
    if status_percent is None:
        if raw_status is not None and str(raw_status).strip() != '':
            error_status_msg = f"Row {row_num} ('{project_name}'): Invalid 'Status' value '{raw_status}'. Using DB default 0.0."
        status_percent = 0.0
    clamped_status = max(0.0, min(100.0, status_percent))

    # Sanitize amount and calculate remaining
    amount_val = safe_float(normalized_data.get('amount'))
    calculated_remaining = calculate_remaining(amount_val, clamped_status)

    # Get other fields
    ds = normalized_data.get('ds')
    year = safe_int(normalized_data.get('year'))
    client = normalized_data.get('client')
    po_date_raw = normalized_data.get('po_date')
    po_no_raw = normalized_data.get('po_no')
    po_no = None
    if po_no_raw is not None:
        po_no = str(po_no_raw).strip()
        if po_no == '': po_no = None
    date_completed_raw = normalized_data.get('date_completed')
    pic = normalized_data.get('pic')
    address = normalized_data.get('address')

    # Validate and format dates
    po_date = None
    date_completed = None
    error_date_msg = None
    if po_date_raw and str(po_date_raw).strip():
        parsed_po = parse_flexible_date(str(po_date_raw))
        if parsed_po: po_date = parsed_po.isoformat()
        else: error_date_msg = f"Invalid PO Date format '{po_date_raw}'."
    if date_completed_raw and str(date_completed_raw).strip():
        parsed_completed = parse_flexible_date(str(date_completed_raw))
        if parsed_completed: date_completed = parsed_completed.isoformat()
        else: error_date_msg = (error_date_msg + " " if error_date_msg else "") + f"Invalid Date Completed format '{date_completed_raw}'."

    final_error_msg = error_status_msg
    if error_date_msg:
        # Combine errors but don't automatically skip, let user decide or log warnings
        final_error_msg = (final_error_msg + " " if final_error_msg else "") + error_date_msg
        # If strict date validation is required, uncomment the below:
        # print(f"[Upload Row {row_num}] Skipping due to date format error: {error_date_msg}")
        # return "skipped", f"Row {row_num} ('{project_name}'): {error_date_msg}"


    # Check if project exists using project_no if it's not None
    existing_id = existing_projects_map.get(project_no) if project_no else None

    try:
        if existing_id is not None: # Update
            cursor.execute("""
                UPDATE projects SET ds=?, year=?, client=?, project_name=?, amount=?, status=?, remaining_amount=?, po_date=?, po_no=?, date_completed=?, pic=?, address=?
                WHERE id = ?
            """, (ds, year, client, project_name, amount_val, clamped_status, calculated_remaining, po_date, po_no, date_completed, pic, address, existing_id))
            if cursor.rowcount > 0: return "updated", final_error_msg
            else: return "skipped", f"Row {row_num} ('{project_name}'): No changes detected." + (f" (Warning: {final_error_msg})" if final_error_msg else "")
        else: # Insert
            cursor.execute("""
                INSERT INTO projects (ds, year, project_no, client, project_name, amount, status, remaining_amount, po_date, po_no, date_completed, pic, address)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (ds, year, project_no, client, project_name, amount_val, clamped_status, calculated_remaining, po_date, po_no, date_completed, pic, address))
            new_id = cursor.lastrowid
            # Update map if a new project with a project_no was inserted
            if project_no and new_id: existing_projects_map[project_no] = new_id
            return "inserted", final_error_msg
    except sqlite3.IntegrityError as db_err:
        error_detail = str(db_err)
        if "UNIQUE constraint failed: projects.project_no" in error_detail and project_no:
            error_msg = f"Row {row_num} ('{project_name}'): Skipped. Project Number '{project_no}' already exists."
        else: error_msg = f"Row {row_num} ('{project_name}'): Skipped. DB Integrity Error: {error_detail}"
        print(error_msg)
        if final_error_msg: error_msg += f" (Additional Warning: {final_error_msg})"
        return "skipped", error_msg
    except sqlite3.Error as db_err:
        error_msg = f"Row {row_num} ('{project_name}'): Skipped. DB Error: {db_err}"
        print(error_msg)
        if final_error_msg: error_msg += f" (Additional Warning: {final_error_msg})"
        return "skipped", error_msg


# --- CSV Upload Endpoint ---
@app.route('/api/projects/upload', methods=['POST'])
def upload_projects_csv():
    """Handles CSV file upload to add or update projects."""
    if 'csv-file' not in request.files: return jsonify({"error": "No 'csv-file' part"}), 400
    file = request.files['csv-file']
    if file.filename == '': return jsonify({"error": "No selected file"}), 400
    if not file or not file.filename.lower().endswith('.csv'): return jsonify({"error": "Invalid file type"}), 400

    inserted_count, updated_count, skipped_count, errors = 0, 0, 0, []
    conn = None
    try:
        conn = get_db()
        cursor = conn.cursor()
        # Ensure projects table exists before proceeding
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='projects';")
        if not cursor.fetchone():
             print("ERROR: 'projects' table does not exist during CSV upload.")
             return jsonify({"error": "Database not initialized correctly. 'projects' table missing."}), 500

        cursor.execute("SELECT id, project_no FROM projects WHERE project_no IS NOT NULL AND project_no != ''")
        existing_projects_map = {row['project_no']: row['id'] for row in cursor.fetchall()}

        # Detect encoding
        try:
            first_bytes = file.stream.read(3)
            file.stream.seek(0)
            encoding = 'utf-8-sig' if first_bytes == b'\xef\xbb\xbf' else 'utf-8'
            stream = io.StringIO(file.stream.read().decode(encoding), newline=None)
        except UnicodeDecodeError:
            file.stream.seek(0)
            try:
                stream = io.StringIO(file.stream.read().decode('latin-1'), newline=None)
                encoding = 'latin-1'
                print("Warning: CSV file might not be UTF-8, decoded as latin-1.")
            except Exception as decode_err:
                print(f"Error decoding CSV file: {decode_err}")
                return jsonify({"error": "Could not decode CSV file. Please ensure it's UTF-8 or compatible."}), 400

        csv_reader = csv.DictReader(stream)
        if not csv_reader.fieldnames:
            return jsonify({"error": "CSV file appears to be empty or has no header row."}), 400

        conn.execute("BEGIN TRANSACTION")
        for row_num, row_data in enumerate(csv_reader, start=2):
            status, msg = _process_and_save_project(row_data, row_num, cursor, existing_projects_map)
            if status == "inserted": inserted_count += 1
            elif status == "updated": updated_count += 1
            else: skipped_count += 1
            if msg and isinstance(msg, str): errors.append(msg)

        conn.commit()
        response_status = 200 if not errors else 207 # Multi-Status
        response_message = f"CSV process finished. Inserted: {inserted_count}, Updated: {updated_count}, Skipped/Warnings: {skipped_count}." # Changed Errors->Warnings
        print(f"[CSV Upload] Result: {response_message}")
        if errors: print(f"[CSV Upload] Errors/Warnings encountered:\n" + "\n".join(errors))

    except csv.Error as csv_err:
        if conn: conn.rollback()
        print(f"CSV parsing error: {csv_err}")
        return jsonify({"error": f"Error parsing CSV file: {csv_err}"}), 400
    except sqlite3.Error as db_err:
        if conn: conn.rollback()
        print(f"Critical DB error during CSV upload: {db_err}")
        # Explicitly check for "no such table"
        if "no such table" in str(db_err):
             return jsonify({"error": "DB error during upload: 'projects' table not found. Initialization may have failed."}), 500
        else:
             return jsonify({"error": f"DB error during upload: {db_err}"}), 500
    except Exception as e:
        if conn: conn.rollback()
        print(f"Critical unexpected error during CSV upload: {e}")
        traceback.print_exc() # Print stack trace for unexpected errors
        return jsonify({"error": "Unexpected server error during CSV processing."}), 500
    finally:
        if conn: conn.close()

    response_body = {
        "message": response_message, "inserted_count": inserted_count, "updated_count": updated_count,
        "skipped_count": skipped_count, "errors": errors[:100] # Limit errors in response
    }
    if len(errors) > 100: response_body["errors"].append(f"...and {len(errors)-100} more errors/warnings.")
    return jsonify(response_body), response_status

# --- Existing JSON Bulk Upload Endpoint ---
@app.route('/api/projects/bulk', methods=['POST'])
def add_projects_bulk():
    """Adds or updates multiple projects from a JSON list."""
    projects_data = request.get_json()
    if not isinstance(projects_data, list): return jsonify({"error": "Expected a list of projects"}), 400

    inserted_count, updated_count, skipped_count, errors = 0, 0, 0, []
    conn = None
    try:
        conn = get_db()
        cursor = conn.cursor()
        # Ensure projects table exists before proceeding
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='projects';")
        if not cursor.fetchone():
             print("ERROR: 'projects' table does not exist during bulk add.")
             return jsonify({"error": "Database not initialized correctly. 'projects' table missing."}), 500

        cursor.execute("SELECT id, project_no FROM projects WHERE project_no IS NOT NULL AND project_no != ''")
        existing_projects_map = {row['project_no']: row['id'] for row in cursor.fetchall()}
        conn.execute("BEGIN TRANSACTION")
        for index, project_dict in enumerate(projects_data):
            row_num = index + 1
            status, msg = _process_and_save_project(project_dict, row_num, cursor, existing_projects_map)
            if status == "inserted": inserted_count += 1
            elif status == "updated": updated_count += 1
            else: skipped_count += 1
            if msg and isinstance(msg, str): errors.append(msg)
        conn.commit()
        response_status = 200 if not errors else 207
        response_message = f"JSON Bulk process finished. Inserted: {inserted_count}, Updated: {updated_count}, Skipped/Warnings: {skipped_count}." # Changed Errors->Warnings
    except sqlite3.Error as db_err:
        if conn: conn.rollback(); print(f"DB error during JSON bulk: {db_err}")
        return jsonify({"error": f"DB error: {db_err}"}), 500
    except Exception as e:
        if conn: conn.rollback(); print(f"Unexpected error during JSON bulk: {e}")
        traceback.print_exc()
        return jsonify({"error": "Unexpected server error during bulk processing."}), 500
    finally:
        if conn: conn.close()

    response_body = { "message": response_message, "inserted_count": inserted_count, "updated_count": updated_count, "skipped_count": skipped_count, "errors": errors[:50] }
    if len(errors) > 50: response_body["errors"].append(f"...and {len(errors)-50} more errors/warnings.") # Changed errors->errors/warnings
    return jsonify(response_body), response_status


# --- Endpoint to Update Single Project Field ---
@app.route('/api/projects/<int:project_id>', methods=['PUT'])
def update_project_field(project_id):
    """Updates specific fields of a project."""
    data = request.get_json()
    allowed_fields = { # Field name -> type or validation key
        'client': str, 'status': 'status_float', 'po_date': 'date_str_optional',
        'po_no': 'po_no_str_optional', 'date_completed': 'date_str_optional', 'pic': str,
        'address': str, 'amount': 'amount_float', 'project_name': str,
        'year': int, 'ds': str
    }
    if not data: return jsonify({"error": "Request body must contain JSON data."}), 400

    fields_to_update = {}
    update_amount = None; update_status = None
    validation_errors = []

    # Validate and sanitize each field provided
    for field, field_type in allowed_fields.items():
        if field in data:
            value = data[field]; sanitized_value = None; error_msg = None
            try:
                if field_type == 'status_float':
                    status_percent = safe_float(value, default=None) if value is not None and str(value).strip() != '' else 0.0 # Default empty to 0
                    if status_percent is None or not (0 <= status_percent <= 100): error_msg = f"Invalid 'status': '{value}'. Must be 0-100 or empty."
                    else: sanitized_value = status_percent; update_status = sanitized_value
                elif field_type == 'amount_float':
                    amount_val = safe_float(value, default=None) if value is not None and str(value).strip() != '' else None # Allow clearing amount
                    if amount_val is None and value is not None and str(value).strip() != '': error_msg = f"Invalid 'amount': '{value}'. Must be number or empty."
                    else: sanitized_value = amount_val; update_amount = sanitized_value
                elif field_type == int:
                    int_val = safe_int(value, default=None) if value is not None and str(value).strip() != '' else None # Allow clearing year
                    if int_val is None and value is not None and str(value).strip() != '': error_msg = f"Invalid value for '{field}': '{value}'. Expected integer or empty."
                    else: sanitized_value = int_val
                elif field_type == 'date_str_optional':
                    str_val = str(value).strip() if value is not None else None
                    if str_val == '': sanitized_value = None # Allow clearing date
                    elif str_val:
                        parsed_dt = parse_flexible_date(str_val)
                        if not parsed_dt:
                            error_msg = f"Invalid date format for '{field}': '{value}'. Expected YYYY-MM-DD or MM/DD/YYYY or empty."
                        else:
                            sanitized_value = parsed_dt.isoformat() # Store as ISO
                    else:
                        sanitized_value = None # Keep None if originally None
                elif field_type == 'po_no_str_optional': # Allow empty PO No to be saved as NULL
                    sanitized_value = str(value).strip() if value is not None else None
                    if sanitized_value == '': sanitized_value = None # Store empty as NULL
                elif field_type == str:
                    # Ensure project_name is not empty if provided
                    if field == 'project_name':
                        sanitized_value = str(value).strip() if value is not None else None
                        if not sanitized_value: # Check if empty after stripping
                            error_msg = "Project Name cannot be empty."
                        # else: keep sanitized_value
                    else:
                        sanitized_value = str(value).strip() if value is not None else None
                else: error_msg = f"Internal error: Unknown validation type for field '{field}'."
            except Exception as val_err: error_msg = f"Error processing field '{field}': {val_err}"

            if error_msg: validation_errors.append(error_msg)
            # Add field only if no error occurred *for this specific field*
            elif field not in [err.split("'")[1] for err in validation_errors if "'" in err]: # Avoid adding if already errored
                fields_to_update[field] = sanitized_value


    if validation_errors: return jsonify({"error": "Validation failed", "details": validation_errors}), 400
    if not fields_to_update: return jsonify({"message": "No valid fields provided for update."}), 200 # Return 200 if no changes needed

    conn = None
    try:
        conn = get_db(); cursor = conn.cursor()
        cursor.execute("SELECT id, amount, status FROM projects WHERE id = ?", (project_id,))
        project = cursor.fetchone()
        if not project: return jsonify({"error": "Project not found."}), 404

        # Recalculate remaining_amount if amount or status was updated
        original_amount = project['amount']
        original_status = project['status']
        # Determine the amount and status to use for calculation
        amount_for_calc = update_amount if 'amount' in fields_to_update else original_amount
        status_for_calc = update_status if 'status' in fields_to_update else original_status

        # Only calculate remaining if amount or status actually changed
        if 'amount' in fields_to_update or 'status' in fields_to_update:
            num_amount = safe_float(amount_for_calc); num_status = safe_float(status_for_calc)
            if num_amount is not None and num_status is not None:
                fields_to_update['remaining_amount'] = calculate_remaining(num_amount, num_status)
            else:
                fields_to_update['remaining_amount'] = None # Set to None if amount or status is cleared

        # Construct and execute UPDATE only if there are fields to update
        if fields_to_update:
            set_clause = ", ".join([f"`{field}` = ?" for field in fields_to_update])
            update_values = list(fields_to_update.values()) + [project_id]
            sql = f"UPDATE projects SET {set_clause} WHERE id = ?"
            cursor.execute(sql, tuple(update_values))
            conn.commit()
        else:
            # This case should be handled by the check above, but as a safeguard:
            return jsonify({"message": "No fields needed updating."}), 200


        # Fetch the updated project data to return (including forecast flag)
        cursor.execute("SELECT * FROM projects WHERE id = ?", (project_id,))
        updated_project_row = cursor.fetchone()
        if not updated_project_row: return jsonify({"message": "Project updated, but failed to retrieve updated record."}), 207

        # --- Get forecast flag for the single updated project ---
        cursor.execute("SELECT 1 FROM forecast_items WHERE project_id = ? LIMIT 1", (project_id,))
        has_forecasts = cursor.fetchone() is not None
        forecasted_ids_set = {project_id} if has_forecasts else set()
        # --- End forecast flag fetch ---

        updated_project_list = _process_project_rows([updated_project_row], cursor, forecasted_ids_set) # Use helper

        if not updated_project_list: return jsonify({"message": "Project updated, but failed to process updated record."}), 207

        response_data = { "message": "Project updated successfully.", "updatedFields": list(fields_to_update.keys()), "updatedProject": updated_project_list[0] }
        return jsonify(response_data), 200

    except sqlite3.IntegrityError as ie:
        if conn: conn.rollback()
        error_detail = str(ie)
        if "UNIQUE constraint failed: projects.project_no" in error_detail:
            updated_proj_no = fields_to_update.get('project_no', 'N/A')
            return jsonify({"error": f"Update failed. Project Number '{updated_proj_no}' already exists."}), 409 # Conflict
        else: print(f"DB integrity error: {ie}"); return jsonify({"error": f"DB integrity error: {error_detail}"}), 500
    except sqlite3.Error as db_err:
        if conn: conn.rollback(); print(f"DB error: {db_err}"); return jsonify({"error": f"DB error: {db_err}"}), 500
    except Exception as e:
        if conn: conn.rollback(); print(f"Unexpected error: {e}"); traceback.print_exc(); return jsonify({"error": "Unexpected server error during project update."}), 500
    finally:
        if conn: conn.close()

# --- DELETE Project Endpoint ---
@app.route('/api/projects/<int:project_id>', methods=['DELETE'])
def delete_project(project_id):
    conn = None
    try:
        conn = get_db(); cursor = conn.cursor()
        cursor.execute("SELECT id FROM projects WHERE id = ?", (project_id,))
        if not cursor.fetchone(): return jsonify({"error": "Project not found."}), 404
        cursor.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        conn.commit()
        if cursor.rowcount > 0: print(f"Project {project_id} deleted."); return jsonify({"message": "Project deleted successfully."}), 200
        else: print(f"Delete failed unexpectedly for project {project_id}."); return jsonify({"error": "Delete operation failed unexpectedly."}), 500
    except sqlite3.Error as db_err:
        if conn: conn.rollback(); print(f"DB error deleting project {project_id}: {db_err}")
        return jsonify({"error": f"Error deleting project: {db_err}"}), 500
    except Exception as e:
        if conn: conn.rollback(); print(f"Unexpected error deleting project {project_id}: {e}")
        traceback.print_exc()
        return jsonify({"error": "Unexpected error during project deletion."}), 500
    finally:
        if conn: conn.close()

# --- GET Project Details ---
@app.route('/api/projects/<int:project_id>/details', methods=['GET'])
def get_project_details(project_id):
    conn = None
    try:
        conn = get_db(); cursor = conn.cursor()
        cursor.execute("SELECT id, project_no, project_name, po_no FROM projects WHERE id = ?", (project_id,))
        project = cursor.fetchone()
        if project: return jsonify(dict(project)), 200
        else: return jsonify({"error": "Project not found"}), 404
    except Exception as e:
        print(f"Error fetching details for project {project_id}: {e}")
        traceback.print_exc()
        return jsonify({"error": "Error fetching project details"}), 500
    finally:
        if conn: conn.close()


# --- Project Update Endpoints ---
@app.route('/api/projects/<int:project_id>/updates', methods=['GET'])
def get_project_updates(project_id):
     conn = None
     try:
         conn = get_db(); cursor = conn.cursor()
         cursor.execute("SELECT id FROM projects WHERE id = ?", (project_id,))
         if not cursor.fetchone(): return jsonify({"error": "Project not found."}), 404
         cursor.execute("""
             SELECT id as update_id, update_text, is_completed, timestamp, completion_timestamp, due_date
             FROM project_updates WHERE project_id = ? ORDER BY timestamp DESC, id DESC
         """, (project_id,))
         updates = [dict(row) for row in cursor.fetchall()]
         for u in updates: u['is_completed'] = bool(u['is_completed'])
         return jsonify(updates), 200
     except Exception as e:
         print(f"Error fetching updates for project {project_id}: {e}")
         traceback.print_exc()
         return jsonify({"error": "Error fetching project updates."}), 500
     finally:
         if conn: conn.close()

@app.route('/api/projects/<int:project_id>/updates', methods=['POST'])
def add_project_update(project_id):
    data = request.get_json()
    if not data or 'update_text' not in data or not str(data['update_text']).strip():
        return jsonify({"error": "Missing or empty 'update_text'."}), 400

    update_text = str(data['update_text']).strip()
    due_date_str = data.get('due_date'); validated_due_date = None
    if due_date_str is not None and str(due_date_str).strip() != '':
        due_date_str = str(due_date_str).strip()
        parsed_due = parse_flexible_date(due_date_str) # Use flexible parser here too
        if parsed_due: validated_due_date = parsed_due.isoformat() # Store as ISO
        else: return jsonify({"error": f"Invalid 'due_date' format: '{due_date_str}'. Expected YYYY-MM-DD or MM/DD/YYYY or null."}), 400

    conn = None
    try:
        conn = get_db(); cursor = conn.cursor()
        cursor.execute("SELECT id FROM projects WHERE id = ?", (project_id,))
        if not cursor.fetchone(): return jsonify({"error": "Project not found."}), 404

        cursor.execute("SELECT COUNT(*) as count FROM project_updates WHERE project_id = ?", (project_id,))
        count_row = cursor.fetchone()
        if count_row and count_row['count'] >= MAX_UPDATES_PER_PROJECT: # Use the constant
            return jsonify({"error": f"Maximum updates limit ({MAX_UPDATES_PER_PROJECT}) reached."}), 400

        cursor.execute("INSERT INTO project_updates (project_id, update_text, due_date) VALUES (?, ?, ?)",
                       (project_id, update_text, validated_due_date))
        new_update_id = cursor.lastrowid
        conn.commit()

        cursor.execute("SELECT id as update_id, update_text, is_completed, timestamp, completion_timestamp, due_date FROM project_updates WHERE id = ?", (new_update_id,))
        new_update_row = cursor.fetchone()
        if new_update_row:
            new_update_dict = dict(new_update_row)
            new_update_dict['is_completed'] = bool(new_update_dict['is_completed'])
            return jsonify({"message": "Update added successfully.", "new_update": new_update_dict}), 201
        else:
            print(f"Error retrieving newly added update {new_update_id} for project {project_id}.")
            return jsonify({"message": "Update added, but failed to retrieve the new record."}), 207
    except sqlite3.Error as db_err:
        if conn: conn.rollback(); print(f"DB error adding update: {db_err}")
        return jsonify({"error": f"Database error adding update: {db_err}"}), 500
    except Exception as e:
        if conn: conn.rollback(); print(f"Unexpected error adding update: {e}")
        traceback.print_exc()
        return jsonify({"error": "Unexpected server error adding update."}), 500
    finally:
        if conn: conn.close()

@app.route('/api/updates/<int:update_id>/complete', methods=['PUT'])
def toggle_update_completion(update_id):
      conn = None
      try:
          conn = get_db(); cursor = conn.cursor()
          cursor.execute("SELECT id, project_id, is_completed FROM project_updates WHERE id = ?", (update_id,))
          update_item = cursor.fetchone()
          if not update_item: return jsonify({"error": "Update not found."}), 404

          new_status_int = 1 - update_item['is_completed']
          completion_time_sql_part = "completion_timestamp = CURRENT_TIMESTAMP" if new_status_int == 1 else "completion_timestamp = NULL"
          sql = f"UPDATE project_updates SET is_completed = ?, {completion_time_sql_part} WHERE id = ?"
          cursor.execute(sql, (new_status_int, update_id))
          conn.commit()

          if cursor.rowcount > 0:
              new_status_bool = bool(new_status_int)
              message = f"Update marked as {'Complete' if new_status_bool else 'Incomplete'}."
              cursor.execute("SELECT completion_timestamp FROM project_updates WHERE id = ?", (update_id,))
              completion_ts = cursor.fetchone()['completion_timestamp']
              return jsonify({"message": message, "update_id": update_id, "is_completed": new_status_bool, "completion_timestamp": completion_ts }), 200
          else: print(f"Toggle completion failed unexpectedly for update {update_id}."); return jsonify({"error": "Toggle completion failed."}), 500
      except sqlite3.Error as db_err:
          if conn: conn.rollback(); print(f"DB error toggling update {update_id}: {db_err}")
          return jsonify({"error": f"Database error toggling update: {db_err}"}), 500
      except Exception as e:
          if conn: conn.rollback(); print(f"Unexpected error toggling update {update_id}: {e}")
          traceback.print_exc()
          return jsonify({"error": "Unexpected error toggling update."}), 500
      finally:
          if conn: conn.close()

@app.route('/api/updates/<int:update_id>', methods=['DELETE'])
def delete_project_update(update_id):
      conn = None
      try:
          conn = get_db(); cursor = conn.cursor()
          cursor.execute("SELECT id FROM project_updates WHERE id = ?", (update_id,))
          if not cursor.fetchone(): return jsonify({"error": "Update not found."}), 404
          cursor.execute("DELETE FROM project_updates WHERE id = ?", (update_id,))
          conn.commit()
          if cursor.rowcount > 0: return jsonify({"message": "Update deleted successfully.", "deleted_update_id": update_id}), 200
          else: print(f"Delete failed unexpectedly for update {update_id}."); return jsonify({"error": "Delete failed."}), 500
      except sqlite3.Error as db_err:
          if conn: conn.rollback(); print(f"DB error deleting update {update_id}: {db_err}")
          return jsonify({"error": f"Database error deleting update: {db_err}"}), 500
      except Exception as e:
          if conn: conn.rollback(); print(f"Unexpected error deleting update {update_id}: {e}")
          traceback.print_exc()
          return jsonify({"error": "Unexpected error deleting update."}), 500
      finally:
          if conn: conn.close()

# --- Updates Log Endpoint ---
@app.route('/api/updates/log', methods=['GET'])
def get_updates_log():
    log_entries = []
    conn = None
    try:
        conn = get_db(); cursor = conn.cursor()
        cursor.execute("""
            SELECT pu.id as update_id, pu.project_id, pu.update_text, pu.is_completed,
                   pu.timestamp as creation_timestamp, pu.completion_timestamp, pu.due_date,
                   p.project_no, p.project_name
            FROM project_updates pu
            JOIN projects p ON pu.project_id = p.id
            ORDER BY pu.timestamp DESC, pu.id DESC
        """)
        rows = cursor.fetchall()
        for row in rows:
            entry_dict = dict(row)
            entry_dict['is_completed'] = bool(entry_dict['is_completed'])
            log_entries.append(entry_dict)
        return jsonify(log_entries), 200
    except Exception as e:
        print(f"Error fetching updates log: {e}")
        traceback.print_exc()
        return jsonify({"error": "Error fetching updates log."}), 500
    finally:
        if conn: conn.close()

# --- Forecast Endpoints ---

# --- GET Forecast Items ---
@app.route('/api/forecast', methods=['GET'])
def get_forecast_items():
      forecast_items_list = []
      conn = None
      try:
          conn = get_db(); cursor = conn.cursor()
          # Select is_deduction along with other fields
          cursor.execute("""
              SELECT fi.id as forecast_entry_id, fi.project_id, fi.forecast_input_type,
                     fi.forecast_input_value, fi.is_forecast_completed, fi.forecast_date,
                     fi.is_deduction,
                     p.project_no, p.project_name, p.amount as project_amount,
                     p.status as project_status, p.pic as project_pic
              FROM forecast_items fi
              JOIN projects p ON fi.project_id = p.id
              ORDER BY fi.forecast_date, p.project_no, fi.id -- Order by date first
          """)
          rows = cursor.fetchall()
          for row in rows:
              item_dict = dict(row)
              item_dict['is_forecast_completed'] = bool(item_dict['is_forecast_completed'])
              item_dict['is_deduction'] = bool(item_dict['is_deduction']) # Convert flag
              forecast_items_list.append(item_dict)
          return jsonify(forecast_items_list), 200
      except Exception as e:
          print(f"Error fetching forecast items: {e}")
          traceback.print_exc()
          return jsonify({"error": "Error fetching forecast items."}), 500
      finally:
          if conn: conn.close()


# <<< MODIFIED add_forecast_item >>>
@app.route('/api/forecast', methods=['POST'])
def add_forecast_item():
    """Adds a new forecast entry for a project, including the forecast date and deduction flag."""
    conn = None; data = request.get_json()
    try:
        conn = get_db(); cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) as count FROM forecast_items")
        count_row = cursor.fetchone()
        if count_row and count_row['count'] >= FORECAST_LIMIT:
            return jsonify({"error": f"Maximum forecast limit ({FORECAST_LIMIT}) reached."}), 400

        required_fields = ['project_id', 'forecast_input_type', 'forecast_input_value', 'forecast_date'] # is_deduction is technically optional in the payload but handled
        if not data or not all(field in data for field in required_fields):
            missing = [field for field in required_fields if field not in (data or {})]
            return jsonify({"error": f"Missing required fields: {', '.join(missing)}"}), 400

        project_id = data['project_id']
        input_type = data['forecast_input_type']
        input_value = safe_float(data['forecast_input_value'], default=None)
        forecast_date_str = data.get('forecast_date')
        # --- Get is_deduction flag (default to False/0 if not provided) ---
        is_deduction = bool(data.get('is_deduction', False))
        is_deduction_int = 1 if is_deduction else 0
        # --- End get is_deduction ---

        # --- Validate Inputs ---
        if not isinstance(project_id, int): return jsonify({"error": "Invalid 'project_id'."}), 400

        # --- SIMPLIFIED: Only allow 'percent' or 'amount' as input_type ---
        # Treat 'deduction_percent' from frontend as 'percent' type for storage.
        # Ensure the *value* is handled appropriately based on the is_deduction flag below.
        if input_type not in ['percent', 'amount', 'deduction_percent']: # Allow deduction_percent from frontend
             return jsonify({"error": "Invalid 'forecast_input_type' (must be 'percent', 'amount', or 'deduction_percent')."}), 400
        if input_type == 'deduction_percent':
            input_type = 'percent' # Store it as percent type

        # --- Validate Input Value based on is_deduction ---
        if input_value is None:
            return jsonify({"error": "Invalid 'forecast_input_value' (cannot be empty or non-numeric)."}), 400
        if is_deduction and input_value < 0:
             input_value = abs(input_value) # Store deductions as positive numbers with flag
             print(f"Info: Storing deduction value as positive: {input_value}")
        elif not is_deduction and input_value < 0:
             # Decide if negative non-deductions are allowed (e.g., credit memos)
             print(f"Warning: Negative value {input_value} provided for a non-deduction forecast item.")
             # If forbidding negative non-deductions uncomment below:
             # return jsonify({"error": "Negative 'forecast_input_value' only allowed if 'is_deduction' is true."}), 400

        # --- Validate Forecast Date ---
        parsed_date = parse_flexible_date(forecast_date_str)
        if not parsed_date:
             return jsonify({"error": f"Invalid 'forecast_date' format: '{forecast_date_str}'. Expected YYYY-MM-DD or MM/DD/YYYY."}), 400
        validated_date_iso = parsed_date.isoformat() # Store as YYYY-MM-DD

        # --- Check Project Existence ---
        cursor.execute("SELECT id FROM projects WHERE id = ?", (project_id,))
        if not cursor.fetchone(): return jsonify({"error": f"Project ID {project_id} not found."}), 404

        # --- Insert into DB ---
        cursor.execute("""
            INSERT INTO forecast_items
                (project_id, forecast_input_type, forecast_input_value, forecast_date, is_deduction)
            VALUES (?, ?, ?, ?, ?)
        """, (project_id, input_type, input_value, validated_date_iso, is_deduction_int)) # Use the integer flag
        new_forecast_id = cursor.lastrowid
        conn.commit()

        # --- Retrieve and Return ---
        cursor.execute("""
            SELECT fi.id as forecast_entry_id, fi.project_id, fi.forecast_input_type,
                   fi.forecast_input_value, fi.is_forecast_completed, fi.forecast_date,
                   fi.is_deduction,
                   p.project_no, p.project_name, p.amount as project_amount,
                   p.status as project_status, p.pic as project_pic
            FROM forecast_items fi JOIN projects p ON fi.project_id = p.id
            WHERE fi.id = ?
        """, (new_forecast_id,))
        new_item_row = cursor.fetchone()

        if new_item_row:
            new_item_dict = dict(new_item_row)
            new_item_dict['is_forecast_completed'] = bool(new_item_dict['is_forecast_completed'])
            new_item_dict['is_deduction'] = bool(new_item_dict['is_deduction']) # Convert back to boolean
            return jsonify({"message": "Forecast entry added successfully.", "new_forecast_entry": new_item_dict}), 201
        else:
            print(f"Error retrieving newly added forecast entry {new_forecast_id}.")
            return jsonify({"message": "Forecast entry added, but failed to retrieve the new record."}), 207
    except sqlite3.Error as db_err:
        if conn: conn.rollback(); print(f"DB error adding forecast: {db_err}")
        return jsonify({"error": f"Database error adding forecast: {db_err}"}), 500
    except Exception as e:
        if conn: conn.rollback(); print(f"Unexpected error adding forecast: {e}")
        traceback.print_exc()
        return jsonify({"error": "Unexpected server error adding forecast."}), 500
    finally:
        if conn: conn.close()


# --- DELETE Forecast Entry ---
@app.route('/api/forecast/entry/<int:entry_id>', methods=['DELETE'])
def remove_single_forecast_entry(entry_id):
    conn = None
    try:
        conn = get_db(); cursor = conn.cursor()
        cursor.execute("SELECT id FROM forecast_items WHERE id = ?", (entry_id,))
        if not cursor.fetchone(): return jsonify({"error": "Forecast entry not found."}), 404
        cursor.execute("DELETE FROM forecast_items WHERE id = ?", (entry_id,))
        conn.commit()
        if cursor.rowcount > 0: return jsonify({"message": "Forecast entry removed successfully.", "deleted_entry_id": entry_id}), 200
        else: print(f"Delete failed unexpectedly for forecast entry {entry_id}."); return jsonify({"error": "Delete failed."}), 500
    except sqlite3.Error as db_err:
        if conn: conn.rollback(); print(f"DB error removing forecast entry {entry_id}: {db_err}")
        return jsonify({"error": f"Database error removing forecast entry: {db_err}"}), 500
    except Exception as e:
        if conn: conn.rollback(); print(f"Unexpected error removing forecast entry {entry_id}: {e}")
        traceback.print_exc()
        return jsonify({"error": "Unexpected error removing forecast entry."}), 500
    finally:
        if conn: conn.close()


# <<< MODIFIED toggle_single_forecast_entry_completion (v6 - Subtract Status on Incomplete) >>>
@app.route('/api/forecast/entry/<int:entry_id>/complete', methods=['PUT'])
def toggle_single_forecast_entry_completion(entry_id):
    """Toggles the completion status of a specific forecast entry.
        If marking complete/incomplete, NON-DEDUCTION items update project status
        based on their percentage equivalent (adds on complete, subtracts on incomplete).
    """
    print(f"\n--- Toggling Forecast Entry {entry_id} (v6 logic) ---")
    conn = None
    try:
        conn = get_db()
        cursor = conn.cursor()
        # Fetch forecast item details AND related project details
        cursor.execute("""
            SELECT fi.id, fi.project_id, fi.forecast_input_type, fi.forecast_input_value,
                   fi.is_forecast_completed, fi.is_deduction,
                   p.status as project_status, p.amount as project_amount
            FROM forecast_items fi
            JOIN projects p ON fi.project_id = p.id
            WHERE fi.id = ?
        """, (entry_id,))
        item_row = cursor.fetchone()

        if not item_row:
            print(f"[Toggle Forecast {entry_id}] Error: Forecast entry not found.")
            return jsonify({"error": "Forecast entry not found."}), 404

        item = dict(item_row)
        print(f"[Toggle Forecast {entry_id}] Fetched Item: id={item['id']}, project_id={item['project_id']}, type={item['forecast_input_type']}, value={item['forecast_input_value']}, completed={item['is_forecast_completed']}, deduction={item['is_deduction']}")
        print(f"[Toggle Forecast {entry_id}] Fetched Project: status={item['project_status']}, amount={item['project_amount']}")

        current_forecast_status_int = item['is_forecast_completed']
        new_forecast_status_int = 1 - current_forecast_status_int
        is_deduction_item = bool(item['is_deduction'])
        project_id = item['project_id']
        project_current_status = safe_float(item['project_status'], 0.0)
        project_amount = safe_float(item['project_amount']) # Can be None

        print(f"[Toggle Forecast {entry_id}] New Forecast Status (int): {new_forecast_status_int}")

        # --- Calculate Percentage Equivalent (needed for both complete/incomplete logic) ---
        forecast_percentage_equivalent = 0.0
        if project_amount is None or isnan(project_amount):
             print(f"[Toggle Forecast {entry_id}] Cannot calculate percentage equivalent because project amount is invalid or missing: {project_amount}")
        else:
            forecast_percentage_equivalent = calculate_individual_forecast_percent(item, project_amount)
        print(f"  - Calculated Percentage Equivalent: {forecast_percentage_equivalent:.2f}%")
        # --- End Percentage Calculation ---


        # --- Start Transaction ---
        conn.execute("BEGIN TRANSACTION")
        print(f"[Toggle Forecast {entry_id}] BEGIN TRANSACTION")

        # 1. Update forecast item status FIRST
        cursor.execute("UPDATE forecast_items SET is_forecast_completed = ? WHERE id = ?", (new_forecast_status_int, entry_id))
        print(f"[Toggle Forecast {entry_id}] Updated forecast_items.is_forecast_completed to {new_forecast_status_int}")

        project_status_updated = False # Flag to check if we updated project status
        clamped_new_project_status = project_current_status # Default to current status

        # --- Check conditions for project status update ---
        cond_not_deduction = not is_deduction_item
        cond_positive_percent = forecast_percentage_equivalent > 0
        print(f"[Toggle Forecast {entry_id}] Checking conditions for project status update:")
        print(f"  - Not Deduction? (not {is_deduction_item}): {cond_not_deduction}")
        print(f"  - Percentage Equivalent Positive? ({forecast_percentage_equivalent} > 0): {cond_positive_percent}")

        # --- Logic for ADDING status on COMPLETE ---
        if new_forecast_status_int == 1 and cond_not_deduction and cond_positive_percent:
            print(f"[Toggle Forecast {entry_id}] Conditions MET for ADDING project status.")
            new_project_status = project_current_status + forecast_percentage_equivalent
            clamped_new_project_status = max(0.0, min(100.0, new_project_status))
            print(f"  - Calculated New Status (Add): {project_current_status:.2f}% + {forecast_percentage_equivalent:.2f}% = {new_project_status:.2f}% -> Clamped: {clamped_new_project_status:.2f}%")

            # Only update if the status actually increased
            if clamped_new_project_status > project_current_status:
                print(f"  - Status Increased? ({clamped_new_project_status:.2f} > {project_current_status:.2f}): True")
                project_status_updated = True
            else:
                print(f"  - Status Increased? ({clamped_new_project_status:.2f} > {project_current_status:.2f}): False. No project update needed.")
                clamped_new_project_status = project_current_status # Ensure no update if status didn't increase

        # --- Logic for SUBTRACTING status on INCOMPLETE ---
        elif new_forecast_status_int == 0 and cond_not_deduction and cond_positive_percent:
            print(f"[Toggle Forecast {entry_id}] Conditions MET for SUBTRACTING project status.")
            new_project_status = project_current_status - forecast_percentage_equivalent
            clamped_new_project_status = max(0.0, min(100.0, new_project_status)) # Clamp at 0 minimum
            print(f"  - Calculated New Status (Subtract): {project_current_status:.2f}% - {forecast_percentage_equivalent:.2f}% = {new_project_status:.2f}% -> Clamped: {clamped_new_project_status:.2f}%")

             # Only update if the status actually decreased
            if clamped_new_project_status < project_current_status:
                 print(f"  - Status Decreased? ({clamped_new_project_status:.2f} < {project_current_status:.2f}): True")
                 project_status_updated = True
            else:
                 print(f"  - Status Decreased? ({clamped_new_project_status:.2f} < {project_current_status:.2f}): False. No project update needed.")
                 clamped_new_project_status = project_current_status # Ensure no update if status didn't decrease

        else:
             print(f"[Toggle Forecast {entry_id}] Conditions NOT MET for project status update (or percentage was zero).")


        # --- Perform Project Update if Status Changed ---
        if project_status_updated:
             # Recalculate remaining amount using the *new* status
             new_remaining_amount = calculate_remaining(project_amount, clamped_new_project_status)
             print(f"  - Calculated New Remaining: {new_remaining_amount}")
             # 2. Update project status and remaining amount
             print(f"  - EXECUTING: UPDATE projects SET status = {clamped_new_project_status:.2f}, remaining_amount = {new_remaining_amount} WHERE id = {project_id}")
             cursor.execute(
                 "UPDATE projects SET status = ?, remaining_amount = ? WHERE id = ?",
                 (clamped_new_project_status, new_remaining_amount, project_id)
             )
        # --- End Project Update ---

        # --- Commit Transaction ---
        conn.commit()
        print(f"[Toggle Forecast {entry_id}] COMMIT TRANSACTION")

        # Fetch the potentially updated forecast item details again for the response
        cursor.execute("""
            SELECT fi.id as forecast_entry_id, fi.project_id, fi.forecast_input_type,
                   fi.forecast_input_value, fi.is_forecast_completed, fi.forecast_date,
                   fi.is_deduction,
                   p.project_no, p.project_name, p.amount as project_amount,
                   p.status as project_status, p.pic as project_pic
            FROM forecast_items fi JOIN projects p ON fi.project_id = p.id
            WHERE fi.id = ?
        """, (entry_id,))
        updated_item_row = cursor.fetchone()
        updated_entry_data = dict(updated_item_row) if updated_item_row else {}
        if updated_entry_data:
            updated_entry_data['is_forecast_completed'] = bool(updated_entry_data['is_forecast_completed'])
            updated_entry_data['is_deduction'] = bool(updated_entry_data['is_deduction'])

        message = f"Forecast entry marked {'Complete' if new_forecast_status_int == 1 else 'Incomplete'}."
        if project_status_updated: # Check flag
            message += f" Project {project_id} status and remaining amount updated."

        print(f"[Toggle Forecast {entry_id}] Response Message: {message}")
        print(f"--- End Toggle Forecast Entry {entry_id} ---") # Add end separator
        return jsonify({"message": message, "updated_entry": updated_entry_data}), 200

    except sqlite3.Error as db_err:
        if conn: conn.rollback()
        print(f"[Toggle Forecast {entry_id}] DB Error: {db_err}")
        traceback.print_exc()
        return jsonify({"error": f"Database error toggling completion: {db_err}"}), 500
    except Exception as e:
        if conn: conn.rollback()
        print(f"[Toggle Forecast {entry_id}] Unexpected Error: {e}")
        traceback.print_exc()
        return jsonify({"error": "Unexpected error toggling completion."}), 500
    finally:
        if conn: conn.close()


# <<< MODIFIED api_dashboard (Added Logging) >>>
@app.route('/api/dashboard', methods=['GET'])
def api_dashboard():
    """Provides calculated dashboard metrics."""
    print("\n--- Calculating Dashboard Metrics ---") # Add separator
    # Initialize metrics
    metrics = {
        "total_remaining": 0.0,
        "total_actual_invoiced": 0.0,
        "total_forecast": 0.0,
        "completed_2025_count": 0, # Key kept for frontend compatibility
        "total_active_projects_count": 0,
        "new_projects_count": 0
    }
    conn = None
    try:
        conn = get_db()
        cursor = conn.cursor()

        # --- Calculate counts and remaining sum in Python using flexible date parsing ---
        active_count = 0
        completed_this_year_count = 0
        new_projects_count = 0
        total_remaining_active = 0.0
        today = datetime.date.today()
        current_year = today.year
        date_15_days_ago = today - datetime.timedelta(days=15)

        cursor.execute("SELECT id, status, po_date, date_completed, remaining_amount FROM projects")
        all_projects = cursor.fetchall()
        print(f"[Dashboard] Processing {len(all_projects)} total projects...")

        for project in all_projects:
            status_val = safe_float(project['status'], default=0.0)
            completed_date = parse_flexible_date(project['date_completed'])
            po_date = parse_flexible_date(project['po_date'])

            # Check if active
            is_active = status_val < 100.0 and completed_date is None
            if is_active:
                active_count += 1
                remaining = safe_float(project['remaining_amount'])
                if remaining is not None:
                    total_remaining_active += remaining

            # Check if completed this year
            if completed_date and completed_date.year == current_year:
                completed_this_year_count += 1

            # Check if new (using PO Date within last 15 days)
            if po_date and po_date >= date_15_days_ago:
                new_projects_count += 1

        metrics["total_active_projects_count"] = active_count
        metrics["completed_2025_count"] = completed_this_year_count
        metrics["new_projects_count"] = new_projects_count
        metrics["total_remaining"] = total_remaining_active
        print(f"[Dashboard] Counts: Active={active_count}, CompletedThisYear={completed_this_year_count}, New={new_projects_count}")
        print(f"[Dashboard] Total Remaining (Active): {total_remaining_active:.2f}")

        # --- Calculate Total Actual Invoiced ---
        cursor.execute("""
            SELECT SUM(
                CASE
                    WHEN fi.forecast_input_type = 'percent' THEN (COALESCE(p.amount, 0) * fi.forecast_input_value / 100.0)
                    WHEN fi.forecast_input_type = 'amount' THEN fi.forecast_input_value
                    ELSE 0
                END * CASE WHEN fi.is_deduction = 1 THEN -1.0 ELSE 1.0 END
            ) as total_invoiced
            FROM forecast_items fi
            JOIN projects p ON fi.project_id = p.id
            WHERE fi.is_forecast_completed = 1;
        """)
        total_inv_row = cursor.fetchone()
        total_inv = total_inv_row['total_invoiced'] if total_inv_row else None
        metrics["total_actual_invoiced"] = total_inv if total_inv is not None else 0.0
        print(f"[Dashboard] Total Actual Invoiced: {metrics['total_actual_invoiced']:.2f}")


        # --- Calculate Total Forecast ---
        cursor.execute("""
             SELECT SUM(
                 CASE
                     WHEN fi.forecast_input_type = 'percent' THEN (COALESCE(p.amount, 0) * fi.forecast_input_value / 100.0)
                     WHEN fi.forecast_input_type = 'amount' THEN fi.forecast_input_value
                     ELSE 0
                 END * CASE WHEN fi.is_deduction = 1 THEN -1.0 ELSE 1.0 END
             ) as total_fc
             FROM forecast_items fi
             JOIN projects p ON fi.project_id = p.id
             WHERE p.status < 100.0 AND (p.date_completed IS NULL OR p.date_completed = '');
        """)
        total_fc_row = cursor.fetchone()
        total_fc = total_fc_row['total_fc'] if total_fc_row else None
        metrics["total_forecast"] = total_fc if total_fc is not None else 0.0
        print(f"[Dashboard] Total Forecast (Active): {metrics['total_forecast']:.2f}")


    except sqlite3.Error as db_err:
        print(f"[Dashboard] Database error calculating metrics: {db_err}")
        traceback.print_exc()
        return jsonify({"error": "Database error calculating metrics", "metrics": metrics}), 500
    except Exception as e:
        print(f"[Dashboard] Error calculating metrics: {e}")
        traceback.print_exc()
        return jsonify({"error": "Error calculating metrics", "metrics": metrics}), 500
    finally:
        if conn: conn.close()

    print(f"[Dashboard] Returning Metrics: {metrics}")
    print("--- End Dashboard Calculation ---")
    return jsonify(metrics)


# --- Project Task API Endpoints (for Gantt) ---
# ... (These endpoints remain unchanged) ...
@app.route('/api/projects/<int:project_id>/tasks', methods=['GET'])
def get_project_tasks(project_id):
    # ... existing code ...
    conn = None
    try:
        conn = get_db(); cursor = conn.cursor()
        cursor.execute("SELECT id FROM projects WHERE id = ?", (project_id,))
        if not cursor.fetchone(): return jsonify({"error": "Project not found"}), 404
        cursor.execute("""
            SELECT task_id, project_id, task_name, start_date, end_date,
                   planned_weight, actual_start, actual_end, assigned_to, parent_task_id
            FROM project_tasks WHERE project_id = ?
            ORDER BY parent_task_id NULLS FIRST, start_date, task_id
        """, (project_id,))
        tasks = [dict(row) for row in cursor.fetchall()]
        return jsonify(tasks), 200
    except Exception as e:
        print(f"Error fetching tasks for project {project_id}: {e}")
        traceback.print_exc()
        return jsonify({"error": "Error fetching project tasks."}), 500
    finally:
        if conn: conn.close()

@app.route('/api/projects/<int:project_id>/tasks', methods=['POST'])
def add_project_task(project_id):
    # ... existing code ...
    data = request.get_json()
    if not data or not data.get('task_name') or str(data['task_name']).strip() == '':
        return jsonify({"error": "Missing or empty 'task_name'"}), 400

    conn = None
    try:
        conn = get_db(); cursor = conn.cursor()
        cursor.execute("SELECT id FROM projects WHERE id = ?", (project_id,))
        if not cursor.fetchone(): return jsonify({"error": "Project not found"}), 404

        task_name = str(data['task_name']).strip()
        start_date = data.get('start_date'); end_date = data.get('end_date')
        planned_weight = safe_float(data.get('planned_weight'), default=0.0)
        actual_start = data.get('actual_start'); actual_end = data.get('actual_end')
        assigned_to = data.get('assigned_to'); parent_task_id = data.get('parent_task_id')
        validated_parent_id = None

        if start_date and not is_valid_date_format(start_date): return jsonify({"error": f"Invalid start_date format: '{start_date}'. Use YYYY-MM-DD."}), 400
        if end_date and not is_valid_date_format(end_date): return jsonify({"error": f"Invalid end_date format: '{end_date}'. Use YYYY-MM-DD."}), 400
        if actual_start and not is_valid_date_format(actual_start): return jsonify({"error": f"Invalid actual_start format: '{actual_start}'. Use YYYY-MM-DD."}), 400
        if actual_end and not is_valid_date_format(actual_end): return jsonify({"error": f"Invalid actual_end format: '{actual_end}'. Use YYYY-MM-DD."}), 400

        if parent_task_id is not None:
            parent_id_int = safe_int(parent_task_id)
            if parent_id_int is None: return jsonify({"error": f"Invalid 'parent_task_id': '{parent_task_id}'."}), 400
            cursor.execute("SELECT task_id FROM project_tasks WHERE task_id = ? AND project_id = ?", (parent_id_int, project_id))
            if not cursor.fetchone(): return jsonify({"error": f"Parent task ID {parent_id_int} not found within project {project_id}."}), 400
            validated_parent_id = parent_id_int

        cursor.execute("""
            INSERT INTO project_tasks (project_id, task_name, start_date, end_date, planned_weight, actual_start, actual_end, assigned_to, parent_task_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (project_id, task_name, start_date, end_date, planned_weight, actual_start, actual_end, assigned_to, validated_parent_id))
        new_task_id = cursor.lastrowid
        conn.commit()

        cursor.execute("SELECT * FROM project_tasks WHERE task_id = ?", (new_task_id,))
        new_task_row = cursor.fetchone()
        if new_task_row: return jsonify(dict(new_task_row)), 201
        else: print(f"Error retrieving newly added task {new_task_id}."); return jsonify({"message": "Task added, but failed to retrieve."}), 207
    except sqlite3.Error as db_err:
        if conn: conn.rollback(); print(f"DB error adding task: {db_err}")
        return jsonify({"error": f"Database error adding task: {db_err}"}), 500
    except Exception as e:
        if conn: conn.rollback(); print(f"Unexpected error adding task: {e}")
        traceback.print_exc()
        return jsonify({"error": "Unexpected server error adding task"}), 500
    finally:
        if conn: conn.close()

@app.route('/api/tasks/<int:task_id>', methods=['PUT'])
def update_project_task(task_id):
    # ... existing code ...
    data = request.get_json()
    if not data: return jsonify({"error": "Missing JSON data"}), 400

    conn = None
    try:
        conn = get_db(); cursor = conn.cursor()
        cursor.execute("SELECT task_id, project_id FROM project_tasks WHERE task_id = ?", (task_id,))
        task = cursor.fetchone()
        if not task: return jsonify({"error": "Task not found"}), 404
        current_project_id = task['project_id']

        allowed_fields = ['task_name', 'start_date', 'end_date', 'planned_weight', 'actual_start', 'actual_end', 'assigned_to', 'parent_task_id']
        fields_to_update = {}; validation_errors = []

        for field in allowed_fields:
            if field in data:
                value = data[field]; sanitized_value = None
                if field == 'task_name':
                    sanitized_value = str(value).strip();
                    if not sanitized_value: validation_errors.append("Task name cannot be empty.")
                elif field == 'planned_weight':
                    sanitized_value = safe_float(value, default=None)
                    if sanitized_value is None: validation_errors.append(f"Invalid planned_weight: '{value}'.")
                    else: sanitized_value = max(0.0, sanitized_value)
                elif field == 'parent_task_id':
                    if value is None: sanitized_value = None
                    else:
                        parent_id = safe_int(value)
                        if parent_id is None: validation_errors.append(f"Invalid parent_task_id: '{value}'.")
                        elif parent_id == task_id: validation_errors.append("Task cannot be its own parent.")
                        else:
                            cursor.execute("SELECT task_id FROM project_tasks WHERE task_id = ? AND project_id = ?", (parent_id, current_project_id))
                            if not cursor.fetchone(): validation_errors.append(f"Parent task ID {parent_id} not found in project {current_project_id}.")
                            else: sanitized_value = parent_id
                elif field in ['start_date', 'end_date', 'actual_start', 'actual_end']:
                    str_val = str(value).strip() if value is not None else None
                    if str_val == '': sanitized_value = None
                    elif str_val and not is_valid_date_format(str_val):
                        validation_errors.append(f"Invalid date format for '{field}': '{value}'. Expected YYYY-MM-DD or empty.")
                    else: sanitized_value = str_val
                else: sanitized_value = str(value).strip() if value is not None else None

                is_field_in_error = any(field in error_msg for error_msg in validation_errors if field in error_msg)
                if not is_field_in_error: fields_to_update[field] = sanitized_value

        if validation_errors: return jsonify({"error": "Validation failed.", "details": validation_errors}), 400
        if not fields_to_update: return jsonify({"message": "No valid fields provided for update."}), 200

        set_clause = ", ".join([f"`{field}` = ?" for field in fields_to_update])
        update_values = list(fields_to_update.values()) + [task_id]
        sql = f"UPDATE project_tasks SET {set_clause} WHERE task_id = ?"
        cursor.execute(sql, tuple(update_values))
        conn.commit()

        cursor.execute("SELECT * FROM project_tasks WHERE task_id = ?", (task_id,))
        updated_task_row = cursor.fetchone()
        if updated_task_row: return jsonify(dict(updated_task_row)), 200
        else: print(f"Error retrieving updated task {task_id}."); return jsonify({"message": "Task updated, but failed to retrieve."}), 207
    except sqlite3.Error as db_err:
        if conn: conn.rollback(); print(f"DB error updating task {task_id}: {db_err}")
        return jsonify({"error": f"Database error updating task: {db_err}"}), 500
    except Exception as e:
        if conn: conn.rollback(); print(f"Unexpected error updating task {task_id}: {e}")
        traceback.print_exc()
        return jsonify({"error": "Unexpected server error updating task"}), 500
    finally:
        if conn: conn.close()

@app.route('/api/tasks/<int:task_id>', methods=['DELETE'])
def delete_project_task(task_id):
    # ... existing code ...
    conn = None
    try:
        conn = get_db(); cursor = conn.cursor()
        cursor.execute("SELECT task_id FROM project_tasks WHERE task_id = ?", (task_id,))
        if not cursor.fetchone(): return jsonify({"error": "Task not found"}), 404
        cursor.execute("DELETE FROM project_tasks WHERE task_id = ?", (task_id,))
        conn.commit()
        if cursor.rowcount > 0: print(f"Task {task_id} deleted."); return jsonify({"message": "Task deleted successfully."}), 200
        else: print(f"Delete failed unexpectedly for task {task_id}."); return jsonify({"error": "Delete failed."}), 500
    except sqlite3.Error as db_err:
        if conn: conn.rollback(); print(f"DB error deleting task {task_id}: {db_err}")
        return jsonify({"error": f"Database error deleting task: {db_err}"}), 500
    except Exception as e:
        if conn: conn.rollback(); print(f"Unexpected error deleting task {task_id}: {e}")
        traceback.print_exc()
        return jsonify({"error": "Unexpected error deleting task."}), 500
    finally:
        if conn: conn.close()


# --- Static File Serving & Main Execution ---
@app.route('/')
def index():
    """Serves the main index.html file."""
    index_path = os.path.join(app.static_folder, 'index.html')
    if not os.path.exists(index_path):
        print(f"Error: index.html not found in static folder '{app.static_folder}'.")
        return "Error: Main application file not found.", 404
    try:
        return send_from_directory(app.static_folder, 'index.html')
    except Exception as e:
        print(f"Error serving index.html: {e}")
        traceback.print_exc()
        return "Error serving application file.", 500

@app.route('/forecast')
def forecast_page():
    """Serves the forecast.html file."""
    forecast_path = os.path.join(app.static_folder, 'forecast.html')
    if not os.path.exists(forecast_path):
        print(f"Error: forecast.html not found in '{app.static_folder}'.")
        return "Error: Forecast page not found.", 404
    try:
        return send_from_directory(app.static_folder, 'forecast.html')
    except Exception as e:
        print(f"Error serving forecast.html: {e}")
        traceback.print_exc()
        return "Error serving forecast page.", 500

@app.route('/updates_log')
def updates_log_page():
    """Serves the updates_log.html file."""
    log_path = os.path.join(app.static_folder, 'updates_log.html')
    if not os.path.exists(log_path):
        print(f"Error: updates_log.html not found.")
        return "Error: Updates log page not found.", 404
    try:
        return send_from_directory(app.static_folder, 'updates_log.html')
    except Exception as e:
        print(f"Error serving updates_log.html: {e}")
        traceback.print_exc()
        return "Error serving updates log page.", 500

@app.route('/project_gantt')
def project_gantt_page():
    """Serves the project_gantt.html file."""
    gantt_path = os.path.join(app.static_folder, 'project_gantt.html')
    if not os.path.exists(gantt_path):
        print(f"Error: project_gantt.html not found.")
        return "Error: Project Gantt page not found.", 404
    try:
        return send_from_directory(app.static_folder, 'project_gantt.html')
    except Exception as e:
        print(f"Error serving project_gantt.html: {e}")
        traceback.print_exc()
        return "Error serving project Gantt page.", 500


# --- Main Execution Block ---
if __name__ == '__main__':
    print("Running database initialization...")
    init_db() # Ensure DB schema is up-to-date
    print("-" * 30)
    print("Starting Flask Server for LAN Access...")

    # --- Configuration for LAN Deployment ---

    # WARNING: Hardcoding a specific IP is generally NOT recommended.
    # '0.0.0.0' is usually preferred as it listens on all interfaces
    # and handles IP address changes automatically.
    # Use this specific IP only if you have a static IP configured
    # or understand the risks if the IP changes.
    lan_host = '192.168.68.149' # <-- MODIFIED: Specific IP Address

    port = 5000 # You can change this port if needed
    # IMPORTANT: Disable debug mode for deployment access by others
    debug_mode = False
    # Disable the reloader when not actively developing
    use_reloader = False

    print(f" * Environment: Production/LAN") # Changed from development
    print(f" * Debug Mode: {'ON' if debug_mode else 'OFF'}")
    print(f" * Binding specifically to: {lan_host}:{port}") # Updated message
    print(f" * Accessible via http://{lan_host}:{port}/") # Use the specific IP here too
    print(f" * Main application: http://{lan_host}:{port}/")
    print(f" * Forecast page: http://{lan_host}:{port}/forecast")
    print(f" * Updates log page: http://{lan_host}:{port}/updates_log")
    print(f" * Project Gantt page (example): http://{lan_host}:{port}/project_gantt?project_id=1")
    print(" * Press CTRL+C to quit")
    print("-" * 30)

    # Run the Flask app using the new configuration
    # Use a production-ready WSGI server like Waitress instead of app.run for better performance/stability
    # Option 1: Using Waitress (Recommended)
    try:
         from waitress import serve
         print(f" * Starting Waitress server on {lan_host}:{port}...")
         # Pass the specific IP to serve
         serve(app, host=lan_host, port=port, threads=8) # Adjust threads as needed
    except ImportError:
         print("\n--- WARNING: 'waitress' not installed ---")
         print("For better performance and stability on LAN, install it:")
         print("   pip install waitress")
         print("Then uncomment the 'serve(app,...)' line and comment out 'app.run(...)'")
         print("Falling back to Flask's development server (less efficient)...\n")
         # Option 2: Using Flask's development server (NOT recommended for multi-user/production)
         print(f" * Starting Flask development server on {lan_host}:{port}...")
         # Pass specific IP
         app.run(host=lan_host, port=port, debug=debug_mode, use_reloader=use_reloader)
