// forecast.js - Frontend Logic for Forecast Page (forecast.html)
// v6: Removed duplicate declaration of sortedItems in exportForecastToCSV.
// v5: Added console.groupCollapsed for better log organization.
// v4: Removed redundant call to fetchDashboardData() on initial load (handled by script.js).
// v3: Removed call to setupCollapsibleSections (handled by script.js)
// v2: Moved dependency checks and dependent const declarations inside DOMContentLoaded

// --- CRITICAL DEPENDENCIES ---
// This script REQUIRES 'script.js' to be loaded FIRST.
// It relies on functions/variables assumed to be defined globally by script.js.

console.log("Starting forecast.js execution (parsing).");

// --- Constants specific to this page (Safe to define globally) ---
const SVG_TRASH = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" /></svg>`;
const SVG_CHECK = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>`;
const SVG_UNDO = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 0 12h-3" /></svg>`;
const MONTH_ABBR = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// --- Global State (Safe to define globally) ---
let currentForecastItems = []; // Holds raw fetched forecast data

// --- API URL generation functions (Will be assigned inside DOMContentLoaded) ---
let FORECAST_TOGGLE_API;
let FORECAST_ENTRY_API_BASE;

// --- DOM Element References (Will be assigned inside DOMContentLoaded) ---
let exportForecastBtn, forecastYearSpan, monthlyContainer;

// --- API Calls ---

/**
 * Fetches all forecast data from the API for the currently selected year,
 * processes it, and triggers the rendering of the monthly tables.
 */
async function fetchForecastData() {
    console.groupCollapsed("API: Fetch Forecast Data");
    const startTime = performance.now();

    // --- Pre-fetch Dependency Check ---
    const dependenciesMet = typeof getElement === 'function' &&
        typeof formatCurrency === 'function' &&
        typeof FORECAST_API !== 'undefined' && // Check existence of the API endpoint URL from script.js
        typeof apiFetch === 'function' &&
        typeof parseDate === 'function';

    if (!dependenciesMet) {
        console.error("   - Critical dependencies missing (getElement, formatCurrency, FORECAST_API, apiFetch, parseDate). Aborting fetch.");
        MONTH_ABBR.forEach(monthAbbr => {
            const tableBody = (typeof getElement === 'function' ? getElement(`forecast-table-body-${monthAbbr}`) : document.getElementById(`forecast-table-body-${monthAbbr}`));
            if (tableBody) {
                const colSpan = tableBody.closest('table')?.querySelector('thead tr')?.cells.length || 8;
                tableBody.innerHTML = `<tr class="error"><td colspan="${colSpan}" class="text-center p-4 text-red-600 dark:text-red-400">Error: Core script components missing. Cannot load forecast data.</td></tr>`;
            }
        });
        console.groupEnd();
        return;
    }
    console.log("   - Dependencies check passed.");

    // --- UI Update: Show Loading State ---
    console.log("   - Setting loading state in tables...");
    MONTH_ABBR.forEach(monthAbbr => {
        const tableBody = getElement(`forecast-table-body-${monthAbbr}`);
        if (tableBody) {
            const colSpan = tableBody.closest('table')?.querySelector('thead tr')?.cells.length || 8;
            tableBody.innerHTML = `<tr class="loading"><td colspan="${colSpan}" class="text-center p-4 text-gray-500 dark:text-slate-400 italic">Loading ${monthAbbr.charAt(0).toUpperCase() + monthAbbr.slice(1)} forecast...</td></tr>`;
        }
        // Reset footer totals
        const totalForecastEl = getElement(`total-forecast-${monthAbbr}`);
        const totalInvoicedEl = getElement(`total-invoiced-${monthAbbr}`);
        if (totalForecastEl) {
            totalForecastEl.textContent = formatCurrency(0);
            totalForecastEl.classList.remove('text-red-600', 'dark:text-red-400', 'text-green-600', 'dark:text-green-400');
        }
        if (totalInvoicedEl) {
            totalInvoicedEl.textContent = `(Inv: ${formatCurrency(0)})`;
            totalInvoicedEl.classList.remove('text-red-500', 'dark:text-red-400', 'text-green-600', 'dark:text-green-500', 'text-gray-500', 'dark:text-gray-400');
        }
    });

    // --- API Call ---
    try {
        console.log(`   - Calling apiFetch for URL: ${FORECAST_API}`);
        const data = await apiFetch(FORECAST_API); // apiFetch has its own group
        currentForecastItems = data || [];
        const fetchDuration = performance.now() - startTime;
        console.log(`   - Successfully fetched ${currentForecastItems.length} total forecast items in ${fetchDuration.toFixed(0)}ms.`);

        // --- Data Processing: Group by Month ---
        console.groupCollapsed("   - Processing & Grouping Data");
        const monthlyData = {};
        let currentDisplayYear = new Date().getFullYear();

        if (forecastYearSpan) {
            const yearText = forecastYearSpan.textContent?.trim();
            const parsedYear = yearText ? parseInt(yearText, 10) : NaN;
            if (!isNaN(parsedYear)) {
                currentDisplayYear = parsedYear;
            } else {
                forecastYearSpan.textContent = currentDisplayYear;
                console.log(`   - forecastYearSpan was empty/invalid, set to default: ${currentDisplayYear}`);
            }
        }
        console.log(`   - Filtering for display year: ${currentDisplayYear}`);

        currentForecastItems.forEach(item => {
            if (!item.forecast_date) return;
            const forecastDate = parseDate(item.forecast_date);
            if (forecastDate) {
                const year = forecastDate.getUTCFullYear();
                if (year !== currentDisplayYear) return;
                const monthIndex = forecastDate.getUTCMonth();
                if (!monthlyData[monthIndex]) {
                    monthlyData[monthIndex] = [];
                }
                monthlyData[monthIndex].push(item);
            } else {
                console.warn(`   - Could not parse forecast_date '${item.forecast_date}' for item ID ${item.forecast_entry_id}. Skipping.`);
            }
        });
        console.log(`   - Data grouped into months for year ${currentDisplayYear}.`);
        console.groupEnd(); // End Processing group

        // --- Trigger Rendering ---
        renderMonthlyForecastTables(monthlyData); // This function has its own group

    } catch (error) {
        console.error("   - Error during API fetch or data processing:", error);
        MONTH_ABBR.forEach(monthAbbr => {
            const tableBody = getElement(`forecast-table-body-${monthAbbr}`);
            if (tableBody) {
                const colSpan = tableBody.closest('table')?.querySelector('thead tr')?.cells.length || 8;
                tableBody.innerHTML = `<tr class="error"><td colspan="${colSpan}" class="text-center p-4 text-red-600 dark:text-red-400">Error loading forecast: ${error.message || 'Unknown error'}</td></tr>`;
            }
        });
    } finally {
        console.groupEnd(); // End Fetch Forecast Data group
    }
}

/**
 * Calculates the forecast amount for a single entry.
 */
function calculateIndividualForecastAmount(item, projectAmount) {
    if (typeof safeFloat !== 'function') { return 0; } // Dependency check
    const value = safeFloat(item.forecast_input_value);
    let amount = 0;
    if (item.forecast_input_type === 'percent') {
        if (!isNaN(projectAmount)) { amount = projectAmount * (value / 100); }
        else { amount = 0; }
    } else { amount = value; }
    return item.is_deduction ? -Math.abs(amount) : Math.abs(amount);
}

/**
 * Calculates the forecast percentage for a single entry.
 */
function calculateIndividualForecastPercent(item, projectAmount) {
    if (typeof safeFloat !== 'function') { return NaN; } // Dependency check
    if (projectAmount === 0 || isNaN(projectAmount)) { return NaN; }
    const value = safeFloat(item.forecast_input_value);
    let percentage = 0;
    if (item.forecast_input_type === 'percent') { percentage = value; }
    else { percentage = (value / projectAmount) * 100; }
    return Math.abs(percentage);
}


/**
 * Handles the removal of a single forecast entry.
 */
async function removeSingleForecastEntry(forecastEntryId) {
    console.groupCollapsed(`ACTION: Remove Forecast Entry (ID: ${forecastEntryId})`);
    const startTime = performance.now();

    // --- Dependency Check ---
    const dependenciesMet = typeof apiFetch === 'function' &&
        typeof safeFloat === 'function' &&
        typeof formatCurrency === 'function' &&
        typeof formatPercent === 'function' &&
        typeof displayFeedback !== 'undefined';

    if (!dependenciesMet) {
        console.error("   - Missing critical dependencies. Aborting removal.");
        if (typeof displayFeedback === 'undefined') { alert("Error: Cannot remove entry due to missing script components."); }
        else { displayFeedback("Error: Cannot remove entry due to missing script components.", "error"); }
        console.groupEnd();
        return;
    }

    // --- Find Item and Confirm ---
    const itemToRemove = currentForecastItems.find(item => item.forecast_entry_id === forecastEntryId);
    const projName = itemToRemove?.project_name || `Entry ID ${forecastEntryId}`;
    const projAmount = safeFloat(itemToRemove?.project_amount);
    const detailText = itemToRemove
        ? `${itemToRemove.forecast_input_type === 'percent' ? formatPercent(itemToRemove.forecast_input_value) : formatCurrency(itemToRemove.forecast_input_value)} (${formatCurrency(calculateIndividualForecastAmount(itemToRemove, projAmount))}) ${itemToRemove.is_deduction ? '(Deduction)' : ''}`
        : 'this entry';

    if (!confirm(`Are you sure you want to remove the forecast entry "${detailText}" for project "${projName}"? This action cannot be undone.`)) {
        console.log("   - Removal cancelled by user.");
        console.groupEnd();
        return;
    }

    // --- API Call ---
    console.log("   - User confirmed. Proceeding with DELETE request...");
    try {
        const apiUrl = `${FORECAST_ENTRY_API_BASE()}/${forecastEntryId}`; // Use the base URL function
        console.log(`   - Calling API: DELETE ${apiUrl}`);
        const result = await apiFetch(apiUrl, { method: 'DELETE' }); // apiFetch has its own group
        const apiDuration = performance.now() - startTime;
        console.log(`   - API DELETE successful in ${apiDuration.toFixed(0)}ms:`, result.message || `Forecast entry ${forecastEntryId} removed.`);
        displayFeedback(result.message || `Forecast entry for "${projName}" removed successfully.`, 'success');

        // --- Data Refresh ---
        console.log("   - Refreshing data after delete...");
        await fetchForecastData(); // Refresh forecast UI (has own group)

        console.log("   - Triggering background refresh of dashboard and project data...");
        let dashboardFetchPromise = Promise.resolve();
        let projectsFetchPromise = Promise.resolve();
        if (typeof fetchDashboardData === 'function') { dashboardFetchPromise = fetchDashboardData(); }
        else { console.warn("   - Function fetchDashboardData not found."); }
        if (typeof fetchActiveProjects === 'function' && typeof fetchCompletedProjects === 'function') { projectsFetchPromise = Promise.all([fetchActiveProjects(), fetchCompletedProjects()]); }
        else { console.warn("   - Functions fetchActiveProjects/fetchCompletedProjects not found."); }
        // Don't necessarily await background refreshes here

    } catch (error) {
        console.error(`   - Error removing forecast entry ${forecastEntryId}:`, error);
        displayFeedback(`Failed to remove forecast entry: ${error.message || 'Unknown server error'}`, 'error');
    } finally {
        console.groupEnd(); // End Remove Forecast Entry group
    }
}

/**
 * Toggles the completion status of a forecast entry.
 */
async function toggleForecastComplete(forecastEntryId) {
    console.groupCollapsed(`ACTION: Toggle Forecast Complete (ID: ${forecastEntryId})`);
    const startTime = performance.now();

    // --- Dependency Check ---
    const dependenciesMet = typeof apiFetch === 'function' && typeof displayFeedback !== 'undefined';
    if (!dependenciesMet) {
        console.error("   - Missing critical dependencies. Aborting toggle.");
        if (typeof displayFeedback === 'undefined') { alert("Error: Cannot toggle status due to missing script components."); }
        else { displayFeedback("Error: Cannot toggle status due to missing script components.", "error"); }
        console.groupEnd();
        return;
    }

    // --- UI Update: Disable Button ---
    const button = document.querySelector(`button[data-action="toggle-forecast-complete"][data-entry-id="${forecastEntryId}"]`);
    if (button) {
        button.disabled = true;
        button.classList.add('opacity-50', 'cursor-not-allowed');
        console.log("   - Disabled toggle button.");
    } else { console.warn("   - Could not find toggle button to disable."); }

    // --- API Call ---
    try {
        const toggleUrl = FORECAST_TOGGLE_API(forecastEntryId); // Use the URL generation function
        console.log(`   - Calling API: PUT ${toggleUrl}`);
        const toggleResult = await apiFetch(toggleUrl, { method: 'PUT' }); // apiFetch has its own group
        const apiDuration = performance.now() - startTime;
        console.log(`   - API PUT successful in ${apiDuration.toFixed(0)}ms:`, toggleResult.message || `Status toggled for entry ${forecastEntryId}.`);
        // displayFeedback(toggleResult.message || `Forecast entry status updated.`, 'success'); // Optional feedback

        // --- Data Refresh ---
        console.log("   - Refreshing data after toggle...");
        await fetchForecastData(); // Refresh forecast UI (has own group)

        console.log("   - Triggering background refresh of dashboard and project data...");
        let dashboardFetchPromise = Promise.resolve();
        let projectsFetchPromise = Promise.resolve();
        if (typeof fetchDashboardData === 'function') { dashboardFetchPromise = fetchDashboardData(); }
        else { console.warn("   - Function fetchDashboardData not found."); }
        if (typeof fetchActiveProjects === 'function' && typeof fetchCompletedProjects === 'function') { projectsFetchPromise = Promise.all([fetchActiveProjects(), fetchCompletedProjects()]); }
        else { console.warn("   - Functions fetchActiveProjects/fetchCompletedProjects not found."); }
        // Don't necessarily await background refreshes here

    } catch (error) {
        console.error(`   - Error toggling forecast completion for entry ${forecastEntryId}:`, error);
        displayFeedback(`Operation failed: ${error.message || 'Unknown server error'}`, 'error');
    } finally {
        // --- UI Update: Re-enable Button ---
        if (button) {
            button.disabled = false;
            button.classList.remove('opacity-50', 'cursor-not-allowed');
            console.log("   - Re-enabled toggle button.");
        }
        console.groupEnd(); // End Toggle Forecast Complete group
    }
}


// --- Rendering ---

/**
 * Renders the grouped and sorted forecast items into monthly HTML tables.
 */
function renderMonthlyForecastTables(monthlyData) {
    console.groupCollapsed("UI: Render Monthly Forecast Tables");
    const startTime = performance.now();

    // --- Pre-render Dependency Check ---
    const dependenciesMet = typeof getElement === 'function' && typeof formatCurrency === 'function' && typeof formatPercent === 'function' && typeof safeFloat === 'function';
    if (!dependenciesMet) {
        console.error("   - Missing critical rendering dependencies. Aborting render.");
        if (monthlyContainer) { monthlyContainer.innerHTML = '<p class="error p-4 text-center text-red-600 dark:text-red-400">Error: Cannot render forecast tables due to missing script components.</p>'; }
        console.groupEnd();
        return;
    }
    console.log("   - Rendering dependencies check passed.");

    // --- Rendering Loop ---
    MONTH_ABBR.forEach((monthAbbr, monthIndex) => {
        console.groupCollapsed(`   - Rendering Month: ${monthAbbr.toUpperCase()}`);
        const tableBodyId = `forecast-table-body-${monthAbbr}`;
        const tableBody = getElement(tableBodyId);
        const totalForecastEl = getElement(`total-forecast-${monthAbbr}`);
        const totalInvoicedEl = getElement(`total-invoiced-${monthAbbr}`);

        if (!tableBody) {
            console.warn(`   - Table body '${tableBodyId}' not found. Skipping render.`);
            console.groupEnd();
            return;
        }

        tableBody.innerHTML = ''; // Clear previous content
        const itemsForMonth = monthlyData[monthIndex] || [];
        const theadRow = tableBody.closest('table')?.querySelector('thead tr');
        const colSpan = theadRow ? theadRow.cells.length : 8;

        let monthForecastTotal = 0;
        let monthInvoicedTotal = 0;

        if (itemsForMonth.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="${colSpan}" class="text-center italic p-4 text-gray-500 dark:text-slate-400">No forecast entries for ${monthAbbr.charAt(0).toUpperCase() + monthAbbr.slice(1)}.</td></tr>`;
            console.log("   - No entries for this month.");
        } else {
            console.log(`   - Processing ${itemsForMonth.length} entries.`);
            // --- Sort Items ---
            const sortedItems = itemsForMonth.sort((a, b) => {
                const projectAmountA = safeFloat(a.project_amount);
                const projectAmountB = safeFloat(b.project_amount);
                const forecastAmountA = calculateIndividualForecastAmount(a, projectAmountA);
                const forecastAmountB = calculateIndividualForecastAmount(b, projectAmountB);
                const valA = isNaN(forecastAmountA) ? -Infinity : forecastAmountA;
                const valB = isNaN(forecastAmountB) ? -Infinity : forecastAmountB;
                if (valB !== valA) return valB - valA; // Desc Amount
                const nameA = (a.project_name || '').toLowerCase();
                const nameB = (b.project_name || '').toLowerCase();
                if (nameA < nameB) return -1; // Asc Name
                if (nameA > nameB) return 1;
                return a.forecast_entry_id - b.forecast_entry_id; // Asc ID
            });

            const fragment = document.createDocumentFragment();

            // --- Helper Cell Creators (Ensure these are defined or accessible) ---
            const createCell = (content, align = 'left', extraClasses = []) => {
                const cell = document.createElement('td');
                cell.className = `px-2 py-1 border-b border-gray-200 dark:border-slate-700 text-${align} text-sm align-middle`;
                cell.classList.add(...extraClasses);
                cell.innerHTML = content ?? '';
                return cell;
            };
            const createCurrencyCell = (value, extraClasses = []) => {
                const formattedValue = formatCurrency(value);
                const cell = createCell(formattedValue, 'right', extraClasses);
                if (safeFloat(value, 0) < 0) { cell.classList.add('text-red-600', 'dark:text-red-400'); }
                return cell;
            };
            const createPercentCell = (value, extraClasses = []) => {
                const formattedValue = formatPercent(value, 'N/A');
                return createCell(formattedValue, 'right', extraClasses);
            };

            // --- Loop & Build Rows ---
            sortedItems.forEach(item => {
                const tr = document.createElement('tr');
                tr.className = 'hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors duration-150';
                tr.setAttribute('data-entry-id', item.forecast_entry_id);
                tr.setAttribute('data-project-id', item.project_id);

                const projectAmount = safeFloat(item.project_amount);
                const individualForecastAmount = calculateIndividualForecastAmount(item, projectAmount);
                const individualForecastPercent = calculateIndividualForecastPercent(item, projectAmount);
                const currentStatusFormatted = formatPercent(item.project_status, 'N/A');
                const isDeductionText = item.is_deduction ? '<span class="text-red-500 dark:text-red-400 ml-1 font-semibold" title="Deduction">(-)</span>' : '';

                monthForecastTotal += individualForecastAmount;
                if (item.is_forecast_completed) { monthInvoicedTotal += individualForecastAmount; }

                tr.appendChild(createCell(item.project_no ?? ''));
                tr.appendChild(createCell(item.project_name ?? ''));
                tr.appendChild(createCurrencyCell(projectAmount));
                tr.appendChild(createCell(item.project_pic ?? '', 'center'));
                tr.appendChild(createCell(currentStatusFormatted, 'right'));

                const cellFcstPercent = createPercentCell(individualForecastPercent);
                const cellFcstAmount = createCurrencyCell(individualForecastAmount);
                cellFcstAmount.innerHTML += isDeductionText;
                tr.appendChild(cellFcstPercent);
                tr.appendChild(cellFcstAmount);

                // Actions Cell
                const actionsTd = createCell('', 'center', ['forecast-action-cell', 'whitespace-nowrap']);
                const removeButton = document.createElement('button');
                removeButton.innerHTML = SVG_TRASH;
                removeButton.className = 'button button-danger button-small p-1 inline-flex items-center justify-center';
                removeButton.title = `Remove this forecast entry`;
                removeButton.dataset.action = 'remove-forecast';
                removeButton.dataset.entryId = item.forecast_entry_id;
                actionsTd.appendChild(removeButton);

                const completeButton = document.createElement('button');
                completeButton.className = 'button button-small p-1 ml-1 inline-flex items-center justify-center';
                completeButton.dataset.action = 'toggle-forecast-complete';
                completeButton.dataset.entryId = item.forecast_entry_id;
                if (item.is_forecast_completed) {
                    completeButton.innerHTML = SVG_UNDO;
                    completeButton.classList.add('button-warning');
                    completeButton.title = 'Mark this entry as Incomplete (Undo)';
                    tr.classList.add('forecast-completed-row', 'opacity-75', 'bg-green-50', 'dark:bg-green-900/30');
                } else {
                    completeButton.innerHTML = SVG_CHECK;
                    completeButton.classList.add('button-success');
                    completeButton.title = 'Mark this entry as Complete (Invoiced)';
                }
                actionsTd.appendChild(completeButton);
                tr.appendChild(actionsTd);
                fragment.appendChild(tr);
            });
            tableBody.appendChild(fragment);
            console.log(`   - Rendered ${sortedItems.length} rows.`);
        }

        // --- Update Footer ---
        if (totalForecastEl) {
            totalForecastEl.textContent = formatCurrency(monthForecastTotal);
            totalForecastEl.className = 'px-2 py-1 text-right text-sm border-t-2 border-gray-300 dark:border-slate-600 font-semibold';
            totalForecastEl.classList.toggle('text-red-600', monthForecastTotal < 0);
            totalForecastEl.classList.toggle('dark:text-red-400', monthForecastTotal < 0);
            totalForecastEl.classList.toggle('text-green-600', monthForecastTotal >= 0);
            totalForecastEl.classList.toggle('dark:text-green-400', monthForecastTotal >= 0);
        } else { console.warn(`   - Total forecast element not found for ${monthAbbr}`); }

        if (totalInvoicedEl) {
            totalInvoicedEl.textContent = `(Inv: ${formatCurrency(monthInvoicedTotal)})`;
            totalInvoicedEl.className = 'text-xs block font-normal';
            totalInvoicedEl.classList.toggle('text-red-500', monthInvoicedTotal < 0);
            totalInvoicedEl.classList.toggle('dark:text-red-400', monthInvoicedTotal < 0);
            totalInvoicedEl.classList.toggle('text-green-600', monthInvoicedTotal > 0);
            totalInvoicedEl.classList.toggle('dark:text-green-500', monthInvoicedTotal > 0);
            totalInvoicedEl.classList.toggle('text-gray-500', monthInvoicedTotal === 0);
            totalInvoicedEl.classList.toggle('dark:text-gray-400', monthInvoicedTotal === 0);
        } else { console.warn(`   - Total invoiced element not found for ${monthAbbr}`); }
        console.log(`   - Footer updated. Forecast: ${formatCurrency(monthForecastTotal)}, Invoiced: ${formatCurrency(monthInvoicedTotal)}`);
        console.groupEnd(); // End group for this month
    }); // End loop through MONTH_ABBR

    const duration = performance.now() - startTime;
    console.log(`Finished rendering all monthly tables in ${duration.toFixed(1)}ms.`);
    console.groupEnd(); // End Render Monthly Tables group
}


// --- CSV Export ---

/**
 * Generates and triggers download for a CSV file of forecast data.
 */
function exportForecastToCSV() {
    console.groupCollapsed("UTIL: Export Forecast to CSV");
    const startTime = performance.now();

    // --- Dependency Check ---
    const dependenciesMet = typeof formatCsvCell === 'function' && typeof parseDate === 'function' && typeof safeFloat === 'function';
    if (!dependenciesMet) {
        console.error("   - Missing utility functions needed for export. Aborting.");
        alert("Cannot export CSV: Required formatting functions are missing.");
        console.groupEnd();
        return;
    }

    if (!currentForecastItems || currentForecastItems.length === 0) {
        console.log("   - No forecast data available to export.");
        alert('No forecast data to export.');
        console.groupEnd();
        return;
    }
    console.log(`   - Exporting ${currentForecastItems.length} forecast entries...`);

    // --- Prepare CSV Data ---
    const headers = ['Forecast Date', 'Project #', 'Project Name', 'Project Amount', 'PIC', 'Project Status (%)', 'Fcst Type', 'Fcst Value', 'Is Deduction', 'Calc Fcst %', 'Calc Fcst Amount', 'Completed (Yes/No)'];
    const csvRows = [headers.map(formatCsvCell).join(',')];

    // --- Sort Data ---
    // FIX v6: Removed duplicate sort block that was here.
    const sortedItems = [...currentForecastItems].sort((a, b) => {
        const dateA = parseDate(a.forecast_date);
        const dateB = parseDate(b.forecast_date);
        const timeA = dateA ? dateA.getTime() : -Infinity;
        const timeB = dateB ? dateB.getTime() : -Infinity;
        if (timeA !== timeB) return timeA - timeB;
        const nameA = (a.project_name || '').toLowerCase();
        const nameB = (b.project_name || '').toLowerCase();
        if (nameA < nameB) return -1;
        if (nameA > nameB) return 1;
        return a.forecast_entry_id - b.forecast_entry_id;
    });
    console.log("   - Data sorted for export.");

    // --- Generate Rows ---
    sortedItems.forEach(item => {
        const projectAmount = safeFloat(item.project_amount);
        const individualForecastAmount = calculateIndividualForecastAmount(item, projectAmount);
        const individualForecastPercent = calculateIndividualForecastPercent(item, projectAmount);
        const isCompletedText = item.is_forecast_completed ? 'Yes' : 'No';
        const isDeductionText = item.is_deduction ? 'Yes' : 'No';
        const statusNum = safeFloat(item.project_status);
        const displayStatus = (!isNaN(statusNum)) ? statusNum.toFixed(1) : '';
        const displayFcstPercent = (!isNaN(individualForecastPercent)) ? individualForecastPercent.toFixed(1) : '';
        const displayFcstAmount = (!isNaN(individualForecastAmount)) ? individualForecastAmount.toFixed(2) : '';
        const displayProjectAmount = (!isNaN(projectAmount)) ? projectAmount.toFixed(2) : '';
        const displayDate = item.forecast_date || '';

        const row = [displayDate, item.project_no ?? '', item.project_name ?? '', displayProjectAmount, item.project_pic ?? '', displayStatus, item.forecast_input_type ?? '', item.forecast_input_value ?? '', isDeductionText, displayFcstPercent, displayFcstAmount, isCompletedText];
        csvRows.push(row.map(formatCsvCell).join(','));
    });
    console.log("   - CSV rows generated.");

    // --- Trigger Download ---
    const csvString = csvRows.join('\n');
    const blob = new Blob([`\uFEFF${csvString}`], { type: 'text/csv;charset=utf-8;' });
    const now = new Date();
    const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
    const filename = `Forecast_Entries_Export_${timestamp}.csv`;

    const link = document.createElement('a');
    if (link.download !== undefined) {
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);
        console.log(`   - Download triggered via link: ${filename}`);
    } else if (navigator.msSaveBlob) {
        navigator.msSaveBlob(blob, filename);
        console.log(`   - Download triggered via msSaveBlob: ${filename}`);
    } else {
        alert("CSV export is not fully supported by your browser.");
        console.error("   - Browser does not support CSV download methods.");
    }
    const duration = performance.now() - startTime;
    console.log(`CSV export finished in ${duration.toFixed(1)}ms.`);
    console.groupEnd(); // End Export Forecast group
}


// --- Event Listeners Setup ---

/**
 * Initializes event listeners for the forecast page.
 */
function initializeForecastEventListeners() {
    console.groupCollapsed("EVENT: Initialize Forecast Listeners");
    const startTime = performance.now();
    try {
        // --- Export Button ---
        if (exportForecastBtn) {
            exportForecastBtn.addEventListener('click', exportForecastToCSV);
            console.log("   - Export button listener added.");
        } else { console.warn("   - Export button not found."); }

        // --- Global UI Listeners (Rely on script.js) ---
        const globalNavToggleBtn = getElement('nav-main-toggle-btn');
        const globalSettingsToggleBtn = getElement('settings-toggle-btn');
        const globalThemeBtn = getElement('theme-toggle-btn-header') || getElement('theme-toggle-btn');

        if (typeof toggleNavigation === 'function' && globalNavToggleBtn) { globalNavToggleBtn.addEventListener('click', toggleNavigation); console.log("   - Global nav toggle listener added."); }
        else if (!globalNavToggleBtn) { console.warn("   - Global nav toggle button not found."); }
        else { console.warn("   - Function toggleNavigation not found."); }

        if (typeof toggleSettingsSubmenu === 'function' && globalSettingsToggleBtn) { globalSettingsToggleBtn.addEventListener('click', toggleSettingsSubmenu); console.log("   - Global settings toggle listener added."); }
        else if (!globalSettingsToggleBtn) { console.warn("   - Global settings toggle button not found."); }
        else { console.warn("   - Function toggleSettingsSubmenu not found."); }

        if (typeof toggleTheme === 'function' && globalThemeBtn) { globalThemeBtn.addEventListener('click', toggleTheme); console.log("   - Global theme toggle listener added."); }
        else if (!globalThemeBtn) { console.warn("   - Global theme toggle button not found."); }
        else { console.warn("   - Function toggleTheme not found."); }

        // --- Delegated Listener for Table Actions ---
        if (monthlyContainer) {
            monthlyContainer.addEventListener('click', (event) => {
                const button = event.target.closest('button[data-action]');
                if (!button) return;

                const action = button.dataset.action;
                const entryIdStr = button.dataset.entryId;
                const forecastEntryId = entryIdStr ? parseInt(entryIdStr, 10) : null;

                if (action && !isNaN(forecastEntryId) && forecastEntryId !== null) {
                    // Groups added within the action handlers themselves
                    switch (action) {
                        case 'remove-forecast':
                            removeSingleForecastEntry(forecastEntryId); // Has own group
                            break;
                        case 'toggle-forecast-complete':
                            toggleForecastComplete(forecastEntryId); // Has own group
                            break;
                        default:
                            console.warn(`[Delegated Listener] Unhandled action: '${action}'`);
                    }
                } else {
                    console.warn("[Delegated Listener] Action button clicked, but 'data-action' or 'data-entry-id' is missing/invalid.", { action, entryIdStr });
                }
            });
            console.log("   - Delegated listener for table actions added.");
        } else { console.error("   - Monthly container not found. Cannot add delegated listener."); }

    } catch (error) {
        console.error("   - Critical error during listener setup:", error);
        if (typeof displayFeedback === 'function') { displayFeedback("Error setting up page interactions.", "error"); }
        else { alert("Error setting up page interactions."); }
    } finally {
        const duration = performance.now() - startTime;
        console.log(`Forecast event listeners initialized in ${duration.toFixed(1)}ms.`);
        console.groupEnd(); // End Initialize Forecast Listeners group
    }
}

// --- Initial Load ---
document.addEventListener('DOMContentLoaded', () => {
    console.groupCollapsed("🚀 Forecast Page Initialization Sequence");
    const initStartTime = performance.now();
    console.log(`DOM loaded at ${new Date().toLocaleTimeString()}. Initializing forecast page...`);

    // --- Define Globals Dependent on script.js ---
    console.groupCollapsed("Dependency Checks & Definitions");
    let dependenciesOK = true;
    if (typeof API_BASE_URL === 'undefined') {
        console.error("CRITICAL ERROR: API_BASE_URL not defined by script.js.");
        dependenciesOK = false;
    } else {
        console.log("   - API_BASE_URL found:", API_BASE_URL);
        FORECAST_TOGGLE_API = (entryId) => `${API_BASE_URL}/forecast/entry/${entryId}/complete`;
        FORECAST_ENTRY_API_BASE = () => `${API_BASE_URL}/forecast/entry`;
        console.log("   - Forecast API URL functions defined.");
    }

    // Check critical functions more robustly
    const criticalFuncs = ['getElement', 'safeFloat', 'formatCurrency', 'formatPercent', 'parseDate', 'formatCsvCell', 'apiFetch', 'displayFeedback', 'fetchDashboardData', 'fetchActiveProjects', 'fetchCompletedProjects', 'toggleNavigation', 'toggleSettingsSubmenu', 'toggleTheme', 'applyInitialNavState', 'applyInitialTheme'];
    criticalFuncs.forEach(funcName => {
        if (typeof window[funcName] !== 'function') {
            console.error(`CRITICAL ERROR: Global function '${funcName}' is missing.`);
            dependenciesOK = false;
        }
    });

    if (!dependenciesOK) {
        const errorArea = document.getElementById('monthly-forecast-container') || document.body;
        const errDiv = document.createElement('div');
        errDiv.className = 'error p-4 text-center text-red-600 dark:text-red-400 font-bold bg-red-100 dark:bg-red-900/50 border border-red-500 rounded-md m-4';
        errDiv.textContent = `Initialization Error: Core script components missing or failed to load. Please refresh or contact support.`;
        if (errorArea.firstChild) errorArea.insertBefore(errDiv, errorArea.firstChild);
        else errorArea.appendChild(errDiv);
        console.groupEnd(); // End Dependency Checks group
        console.groupEnd(); // End Initialization Sequence group
        return; // Halt initialization
    }
    console.log("   - All critical function dependencies found.");
    console.groupEnd(); // End Dependency Checks group

    // --- Get DOM References ---
    console.groupCollapsed("DOM Element References");
    try {
        exportForecastBtn = getElement('export-forecast-btn');
        forecastYearSpan = getElement('forecast-year');
        monthlyContainer = getElement('monthly-forecast-container');
        if (!monthlyContainer) console.warn("   - Element 'monthly-forecast-container' not found.");
        if (!exportForecastBtn) console.warn("   - Element 'export-forecast-btn' not found.");
        if (!forecastYearSpan) console.warn("   - Element 'forecast-year' not found.");
        console.log("   - DOM references obtained.");
    } catch (error) {
        console.error("   - Error getting essential DOM elements:", error);
    }
    console.groupEnd(); // End DOM Element References group

    // --- Start Initialization Steps ---
    try {
        console.groupCollapsed("Applying Initial States");
        applyInitialTheme(); // Has own group
        applyInitialNavState(); // Has own group
        console.groupEnd(); // End Applying Initial States group

        initializeForecastEventListeners(); // Has own group

        // Set Initial Forecast Year if needed
        if (forecastYearSpan && !forecastYearSpan.textContent?.trim()) {
            const currentYear = new Date().getFullYear();
            forecastYearSpan.textContent = currentYear;
            console.log(`Initial forecast year set to ${currentYear}.`);
        }

        // Initial Data Fetch
        fetchForecastData(); // Has own group

        // Dashboard data fetch is handled by script.js

    } catch (error) {
        console.error("CRITICAL ERROR during forecast page initial setup:", error);
        const errorArea = getElement('monthly-forecast-container') || document.body;
        const errDiv = document.createElement('div');
        errDiv.className = 'error p-4 text-center text-red-600 dark:text-red-400 font-bold bg-red-100 dark:bg-red-900/50 border border-red-500 rounded-md m-4';
        errDiv.textContent = `Fatal Error loading forecast page: ${error.message || 'Unknown initialization error'}. Please refresh or contact support.`;
        if (errorArea.firstChild) errorArea.insertBefore(errDiv, errorArea.firstChild);
        else errorArea.appendChild(errDiv);
    } finally {
        const initDuration = performance.now() - initStartTime;
        console.log(`🚀 Forecast Page Initialization Sequence finished in ${initDuration.toFixed(1)}ms.`);
        console.groupEnd(); // End main Initialization Sequence group
    }
});

console.log("forecast.js execution finished (script parsed).");
