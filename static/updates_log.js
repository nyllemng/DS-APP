// updates_log.js - Frontend Logic for the Updates Log Page (updates_log.html)

// --- Constants ---
const API_LOG_URL = '/api/updates/log'; // API endpoint to fetch all update logs

// --- DOM Element References ---
const pendingLogTableBody = document.getElementById('pending-updates-table-body');
const completedLogTableBody = document.getElementById('completed-updates-table-body');
const exportLogButton = document.getElementById('export-log-btn');
const projectFilterSelect = document.getElementById('project-filter-select'); // Get reference to filter dropdown

// --- Global State ---
let currentLogEntries = []; // Store ALL fetched log entries globally

// --- Utility Functions ---
// (Keep formatCsvCell, parseIsoDate, calculateDaysBetweenDates, formatLogDate, apiFetchLog as before)

/** Formats a value for safe inclusion in a CSV cell (handles commas, quotes, newlines). */
function formatCsvCell(value) {
    const stringValue = value === null || value === undefined ? '' : String(value);
    if (/[",\n]/.test(stringValue)) {
        const escapedValue = stringValue.replace(/"/g, '""');
        return `"${escapedValue}"`;
    }
    return stringValue;
}

/**
 * Parses an ISO 8601 date string (potentially returned by backend) into a JS Date object.
 * @param {string|null} dateStr - The ISO date string.
 * @returns {Date|null} - The corresponding Date object, or null if parsing fails.
 */
function parseIsoDate(dateStr) {
    if (!dateStr) return null;
    try {
        // Standard Date constructor usually handles ISO 8601 formats
        const date = new Date(dateStr);
        // Check if the parsed date is valid
        return !isNaN(date.getTime()) ? date : null;
    } catch (e) {
        console.warn(`Error parsing ISO date string: ${dateStr}`, e);
        return null;
    }
}

/**
 * Calculates the approximate number of full days between two Date objects.
 * @param {Date|null} startDate - The starting Date object.
 * @param {Date|null} endDate - The ending Date object.
 * @returns {number|null} - The number of full days, or null if inputs are invalid.
 */
function calculateDaysBetweenDates(startDate, endDate) { // Renamed function
    // Ensure both inputs are valid Date objects
    if (!startDate || !endDate || !(startDate instanceof Date) || !(endDate instanceof Date)) {
        return null;
    }
    // Handle cases where start date might be after end date (e.g., data issue)
    if (startDate > endDate) {
        console.warn("calculateDaysBetweenDates: Start date is after end date.", startDate, endDate);
        return 0; // Or return null/NaN depending on desired handling
    }
    // Calculate difference in milliseconds
    const diffTime = Math.abs(endDate.getTime() - startDate.getTime());
    // *** UPDATED: Convert milliseconds to days (integer division) ***
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
}


/**
 * Formats a Date object into a user-friendly string (e.g., YYYY-MM-DD HH:MM).
 * Returns 'N/A' if the date is invalid.
 * @param {Date|null} date - The Date object to format.
 * @returns {string} - The formatted date string or 'N/A'.
 */
function formatLogDate(date) {
    if (!date || !(date instanceof Date) || isNaN(date.getTime())) return 'N/A';

    // Example format: YYYY-MM-DD HH:MM (adjust format as needed)
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0'); // Months are 0-indexed
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');

    return `${year}-${month}-${day} ${hours}:${minutes}`;
}

/**
 * Fetches data from the specified API URL.
 * @param {string} url - The API endpoint URL.
 * @returns {Promise<any>} - A promise that resolves with the JSON data or rejects with an error.
 */
async function apiFetchLog(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            // Try to get error message from response body, otherwise use status text
            const errorText = await response.text();
            throw new Error(`HTTP error ${response.status}: ${errorText || response.statusText}`);
        }
        // Assume response is JSON
        return await response.json();
    } catch (error) {
        console.error(`API Fetch Log Error (GET ${url}):`, error);
        throw error; // Re-throw the error to be caught by the caller
    }
}

// --- Core Logic ---

/** Fetches update log data, populates filter, and renders tables based on default filter. */
async function fetchLogData() {
    // Ensure all required DOM elements are present
    if (!pendingLogTableBody || !completedLogTableBody || !projectFilterSelect) {
        console.error("Required table body or filter select elements not found!");
        return;
    }

    // Display loading messages and clear previous state
    const loadingHtml = (cols, text) => `<tr class="loading"><td colspan="${cols}">${text}</td></tr>`;
    pendingLogTableBody.innerHTML = loadingHtml(7, "Loading pending updates...");
    completedLogTableBody.innerHTML = loadingHtml(7, "Loading completed updates...");
    currentLogEntries = []; // Clear previous data
    projectFilterSelect.innerHTML = '<option value="">-- Loading Projects --</option>'; // Placeholder

    try {
        // Fetch the combined log data
        const logData = await apiFetchLog(API_LOG_URL);
        currentLogEntries = logData || []; // Store fetched data globally

        // Populate the project filter dropdown using the fetched data
        populateProjectFilter(currentLogEntries);

        // Render tables based on the default filter ("All Projects")
        filterAndRenderTables(); // Initial render

    } catch (error) {
        // Display error messages if fetch fails
        const errorHtml = (cols, msg) => `<tr class="error"><td colspan="${cols}">${msg}</td></tr>`;
        const errorMsg = `Could not load update log: ${error.message}`;
        pendingLogTableBody.innerHTML = errorHtml(7, errorMsg);
        completedLogTableBody.innerHTML = errorHtml(7, errorMsg);
        projectFilterSelect.innerHTML = '<option value="">-- Error Loading --</option>'; // Update dropdown on error
    }
}

/** Populates the project filter dropdown with unique project numbers/names from log entries. */
function populateProjectFilter(logEntries) {
    if (!projectFilterSelect) return;

    // Use a Map to efficiently find unique projects (Project No -> Project Name)
    const projectsMap = new Map();
    logEntries.forEach(entry => {
        if (entry.project_no && !projectsMap.has(entry.project_no)) {
            // Store project number as key and project name as value
            projectsMap.set(entry.project_no, entry.project_name || 'N/A');
        }
    });

    // Convert map entries to an array and sort by project number (alphanumerically)
    const sortedProjects = Array.from(projectsMap.entries()).sort((a, b) => {
        return String(a[0]).localeCompare(String(b[0]), undefined, { numeric: true, sensitivity: 'base' });
    });

    // Clear existing options and add the default "All Projects" option
    projectFilterSelect.innerHTML = '<option value="">-- All Projects --</option>';

    // Add an option for each unique project
    sortedProjects.forEach(([projectNo, projectName]) => {
        const option = document.createElement('option');
        option.value = projectNo; // Set the value to the project number for filtering
        option.textContent = `${projectNo} - ${projectName}`; // Display number and name
        projectFilterSelect.appendChild(option);
    });
}

/** Handles changes in the project filter dropdown selection. */
function handleProjectFilterChange() {
    console.log("Project filter changed.");
    // When the filter changes, re-filter the stored data and re-render the tables
    filterAndRenderTables();
}

/** Filters the master log entries based on the dropdown selection, splits into pending/completed, and renders both tables. */
function filterAndRenderTables() {
    if (!projectFilterSelect) return;

    const selectedProjectNo = projectFilterSelect.value; // Get the value of the selected option ("" for All)
    console.log(`Filtering for Project #: '${selectedProjectNo}'`);

    // Filter the global `currentLogEntries` array
    // If selectedProjectNo is empty (""), keep all entries; otherwise, filter by project_no
    const filteredEntries = selectedProjectNo
        ? currentLogEntries.filter(entry => entry.project_no === selectedProjectNo)
        : currentLogEntries;

    // Split the FILTERED entries into pending and completed arrays
    const pendingEntries = [];
    const completedEntries = [];
    filteredEntries.forEach(entry => {
        if (entry.is_completed) {
            completedEntries.push(entry);
        } else {
            pendingEntries.push(entry);
        }
    });

    // Render each table using the filtered & split data
    renderLogTable(pendingEntries, pendingLogTableBody, false); // Render pending table
    renderLogTable(completedEntries, completedLogTableBody, true); // Render completed table
}


/**
 * Renders log entries into the specified table body, sorted by Project # then Project Name.
 * @param {Array<object>} logEntries - Array of update log entry objects (already filtered).
 * @param {HTMLElement} tableBodyElement - The tbody element to render into.
 * @param {boolean} isCompletedTable - Flag indicating if this is the completed table.
 */
function renderLogTable(logEntries, tableBodyElement, isCompletedTable) {
    if (!tableBodyElement) return;
    tableBodyElement.innerHTML = ''; // Clear loading/previous content

    // Set appropriate message if no entries match the filter
    const emptyMessage = isCompletedTable
        ? "No completed updates found for this selection."
        : "No pending updates found for this selection.";

    if (!logEntries || logEntries.length === 0) {
        tableBodyElement.innerHTML = `<tr><td colspan="7" style="text-align: center; font-style: italic;">${emptyMessage}</td></tr>`;
        return;
    }

    // --- Sort the filtered entries ---
    // Sort by Project Number (asc), then Project Name (asc)
    logEntries.sort((a, b) => {
        const projNoA = String(a.project_no || '').toLowerCase();
        const projNoB = String(b.project_no || '').toLowerCase();
        const projNoCompare = projNoA.localeCompare(projNoB, undefined, { sensitivity: 'base' });
        if (projNoCompare !== 0) return projNoCompare;

        const projNameA = String(a.project_name || '').toLowerCase();
        const projNameB = String(b.project_name || '').toLowerCase();
        return projNameA.localeCompare(projNameB, undefined, { sensitivity: 'base' });
    });

    const fragment = document.createDocumentFragment();
    logEntries.forEach(entry => {
        const tr = document.createElement('tr');
        tr.setAttribute('data-update-id', entry.update_id);
        tr.setAttribute('data-project-id', entry.project_id);

        const creationDate = parseIsoDate(entry.creation_timestamp);
        const completionDate = parseIsoDate(entry.completion_timestamp);

        // Calculate duration in DAYS only for the completed table
        let durationDays = 'N/A';
        if (isCompletedTable && entry.is_completed && creationDate && completionDate) {
            const days = calculateDaysBetweenDates(creationDate, completionDate);
            durationDays = days !== null ? days : 'N/A';
        }

        const statusText = entry.is_completed ? 'Completed' : 'Pending';
        const statusClass = entry.is_completed ? 'status-completed' : 'status-pending';

        // Populate table cells in the correct order (Project # first)
        tr.innerHTML = `
            <td>${entry.project_no || 'N/A'}</td>
            <td>${entry.project_name || 'N/A'}</td>
            <td style="white-space: pre-wrap; word-break: break-word;">${entry.update_text || ''}</td>
            <td style="text-align: center;" class="${statusClass}">${statusText}</td>
            <td>${formatLogDate(creationDate)}</td>
            <td>${formatLogDate(completionDate)}</td>
            <td style="text-align: center;">${durationDays}</td>
        `;
        fragment.appendChild(tr);
    });
    tableBodyElement.appendChild(fragment);
}

// --- CSV Export Function ---

/** Exports the currently stored log entries to a CSV file, sorted by Project # then Project Name. */
function exportUpdatesLogToCSV() {
    // Note: This exports ALL entries, not just the filtered ones.
    // To export only filtered, get selectedProjectNo and filter currentLogEntries here.
    const entriesToExport = currentLogEntries;

    if (entriesToExport.length === 0) {
        alert('No update log data available to export.');
        return;
    }

    // Define CSV Headers (Project # first, Duration in Days)
    const headers = ['Project #', 'Project Name', 'Update Text', 'Status', 'Logged On', 'Completed On', 'Duration (Days)'];
    const csvRows = [headers.join(',')];

    console.log(`Exporting ${entriesToExport.length} log entries to CSV...`);

    // Sort data consistently for export (Project # asc, Project Name asc)
    const sortedEntries = [...entriesToExport].sort((a, b) => {
        const projNoA = String(a.project_no || '').toLowerCase();
        const projNoB = String(b.project_no || '').toLowerCase();
        const projNoCompare = projNoA.localeCompare(projNoB, undefined, { sensitivity: 'base' });
        if (projNoCompare !== 0) return projNoCompare;
        const projNameA = String(a.project_name || '').toLowerCase();
        const projNameB = String(b.project_name || '').toLowerCase();
        return projNameA.localeCompare(projNameB, undefined, { sensitivity: 'base' });
    });

    // Format each entry into a CSV row
    sortedEntries.forEach(entry => {
        const creationDate = parseIsoDate(entry.creation_timestamp);
        const completionDate = parseIsoDate(entry.completion_timestamp);
        const statusText = entry.is_completed ? 'Completed' : 'Pending';
        let durationDays = '';
        if (entry.is_completed && creationDate && completionDate) {
            const days = calculateDaysBetweenDates(creationDate, completionDate);
            durationDays = days !== null ? days : '';
        }
        // Create row data array in the correct order
        const row = [
            formatCsvCell(entry.project_no),
            formatCsvCell(entry.project_name),
            formatCsvCell(entry.update_text),
            formatCsvCell(statusText),
            formatCsvCell(formatLogDate(creationDate)),
            formatCsvCell(formatLogDate(completionDate)),
            formatCsvCell(durationDays)
        ];
        csvRows.push(row.join(','));
    });

    // Create Blob and Trigger Download
    const csvString = csvRows.join('\n');
    const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
    const now = new Date();
    const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
    const filename = `Project_Updates_Log_${timestamp}.csv`;
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
    console.log(`Updates Log CSV export triggered: ${filename}`);
}


// --- Event Listeners ---

/** Initializes event listeners for the log page. */
function initializeLogEventListeners() {
    // Listener for the export button
    if (exportLogButton) {
        exportLogButton.addEventListener('click', exportUpdatesLogToCSV);
        console.log("Export log button listener attached.");
    } else {
        console.warn("Export log button not found.");
    }

    // Listener for the project filter dropdown
    if (projectFilterSelect) {
        projectFilterSelect.addEventListener('change', handleProjectFilterChange);
        console.log("Project filter listener attached.");
    } else {
        console.warn("Project filter select element not found.");
    }
}

// --- Initial Load Trigger ---
// Add event listener to fetch data once the DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    console.log("Updates Log page DOM fully loaded. Initializing log fetch...");
    initializeLogEventListeners(); // Setup button/filter listeners
    fetchLogData(); // Fetch data, populate filter, and render initial view
    // Dark mode initialization is handled by the inline script in updates_log.html
});
