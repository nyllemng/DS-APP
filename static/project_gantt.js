// project_gantt.js - Logic for the individual project Gantt chart page

document.addEventListener('DOMContentLoaded', () => {
    console.log("[DEBUG STEP 1] DOMContentLoaded event fired."); // <-- Check for this

    // --- Global Variables & State ---
    let allTasks = [];
    let displayedTasks = [];
    let projectId = null;
    let projectName = '';
    let projectNumber = '';
    let projectPoNumber = '';
    let taskSortColumn = null;
    let taskSortDirection = 'asc';
    let taskFilterText = '';
    let filterDebounceTimeout = null;
    let draggedElement = null;

    // Date parsing/formatting utilities & constants...
    const parseDate = d3.timeParse("%Y-%m-%d");
    const formatDate = d3.timeFormat("%Y-%m-%d");
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const warningDays = 3; const warningDate = d3.timeDay.offset(today, warningDays);
    const COLOR_COMPLETED = "#2dd4bf"; const COLOR_OVERDUE = "#f87171";
    const COLOR_WARNING = "#facc15"; const COLOR_ONTRACK = "#6b7280";
    const COLOR_ACTUAL = "#5eead4";
    const FILTER_DEBOUNCE_DELAY = 300;

    // D3 selections & UI elements
    console.log("[DEBUG STEP 2] Selecting DOM elements..."); // <-- Check for this
    const ganttSvg = d3.select("#gantt-chart");
    const sCurveSvg = d3.select("#s-curve-chart");
    const tooltip = d3.select("#tooltip");
    const taskInputBody = d3.select("#task-input-body");
    const addTaskButton = d3.select("#add-task-btn");
    const pageTitleElement = document.getElementById('page-title');
    const exportSvgButton = d3.select("#export-gantt-svg-btn");
    const taskFilterInput = d3.select("#task-filter-input");
    const sortButtons = d3.selectAll(".sort-buttons button");
    const projectInfoDisplay = d3.select("#project-info-display");
    const chartPane = d3.select(".chart-pane"); // Ensure this class exists in HTML
    console.log("[DEBUG STEP 3] DOM elements selected."); // <-- Check for this

    // Chart dimensions and margins...
    let ganttWidth, ganttHeight, sCurveWidth, sCurveHeight;
    const margin = { top: 30, right: 20, bottom: 30, left: 150 };

    // D3 Scales, Axes, Gridlines, Line/Area Generators...
    const ganttX = d3.scaleTime(); const ganttY = d3.scaleBand().padding(0.35);
    const sCurveX = d3.scaleTime(); const sCurveY = d3.scaleLinear().domain([0, 100]);
    const ganttXAxis = d3.axisTop(ganttX).ticks(d3.timeWeek.every(1)).tickFormat(d3.timeFormat("%b %d")).tickSizeOuter(0);
    const ganttYAxis = d3.axisLeft(ganttY).tickSize(0).tickPadding(10);
    const sCurveXAxis = d3.axisBottom(sCurveX).ticks(d3.timeWeek.every(1)).tickFormat(d3.timeFormat("%b %d")).tickSizeOuter(0);
    const sCurveYAxis = d3.axisLeft(sCurveY).tickFormat(d => `${d}%`).tickSizeOuter(0);
    const ganttXGrid = d3.axisBottom(ganttX).tickFormat("").ticks(d3.timeDay.every(1));
    const sCurveYGrid = d3.axisLeft(sCurveY).tickFormat(""); const sCurveXGrid = d3.axisBottom(sCurveX).tickFormat("").ticks(d3.timeDay.every(1));
    const line = d3.line().curve(d3.curveMonotoneX); const area = d3.area().curve(d3.curveMonotoneX);

    // SVG Group Selections...
    const ganttGroup = ganttSvg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
    const sCurveGroup = sCurveSvg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
    const ganttXAxisGroup = ganttGroup.append("g").attr("class", "axis x-axis");
    const ganttYAxisGroup = ganttGroup.append("g").attr("class", "axis y-axis task-label");
    const ganttXGridGroup = ganttGroup.append("g").attr("class", "grid x-grid");
    const sCurveXAxisGroup = sCurveGroup.append("g").attr("class", "axis x-axis");
    const sCurveYAxisGroup = sCurveGroup.append("g").attr("class", "axis y-axis");
    const sCurveXGridGroup = sCurveGroup.append("g").attr("class", "grid x-grid");
    const sCurveYGridGroup = sCurveGroup.append("g").attr("class", "grid y-grid");
    const sCurveAreaPath = sCurveGroup.append("path").attr("class", "area");
    const sCurveLinePath = sCurveGroup.append("path").attr("class", "line");
    const actualBarsGroup = ganttGroup.append("g").attr("class", "actual-bars-group");

    // --- API Fetch Helper ---
    async function apiFetchGantt(url, options = {}) {
        const defaultHeaders = { 'Content-Type': 'application/json', 'Accept': 'application/json', };
        const config = { ...options, headers: { ...defaultHeaders, ...(options.headers || {}) }, };
        if (config.body && typeof config.body === 'object') { config.body = JSON.stringify(config.body); }
        try {
            const response = await fetch(url, config); let responseData = null;
            const contentType = response.headers.get("content-type"); const contentLength = response.headers.get("content-length");
            if (response.ok && (!contentLength || contentLength === '0')) { responseData = { message: "Operation successful." }; }
            else if (contentType && contentType.includes("application/json")) { responseData = await response.json(); }
            else if (!response.ok) { const textContent = await response.text().catch(() => `HTTP error ${response.status}`); throw new Error(textContent || `HTTP error ${response.status}`); }
            else { console.warn(`Response format unexpected: ${url}`); responseData = { message: "Operation successful but response format unexpected." }; }
            if (response.ok) { console.log(`API Fetch Success (${response.status}): ${options.method || 'GET'} ${url}`); return responseData; }
            else { const errorMessage = responseData?.error || responseData?.message || `HTTP error ${response.status}`; throw new Error(errorMessage); }
        } catch (error) { console.error(`API Error (${options.method || 'GET'} ${url}):`, error); throw error; }
    }

    // --- Data Mapping Functions ---
    function mapTaskDataFromApi(apiTask) { return { id: apiTask.task_id, name: apiTask.task_name, start: apiTask.start_date, end: apiTask.end_date, plannedValue: apiTask.planned_weight, actualStart: apiTask.actual_start, actualEnd: apiTask.actual_end, assigned_to: apiTask.assigned_to, parent_task_id: apiTask.parent_task_id }; }
    function mapTaskDataToApi(jsTask) { return { task_name: jsTask.name, start_date: jsTask.start || null, end_date: jsTask.end || null, planned_weight: jsTask.plannedValue === '' ? 0 : (jsTask.plannedValue || 0), actual_start: jsTask.actualStart || null, actual_end: jsTask.actualEnd || null, assigned_to: jsTask.assigned_to || null, parent_task_id: jsTask.parent_task_id || null }; }

    // --- Fetch Initial Data (Project Details & Tasks) ---
    async function fetchInitialData(pId) {
        console.log("[DEBUG STEP 6] Entered fetchInitialData function for pId:", pId);
        if (!pId) { /* ... error handling ... */ return; }
        const detailsUrl = `/api/projects/${pId}/details`;
        const tasksUrl = `/api/projects/${pId}/tasks`;
        console.log("[DEBUG STEP 7] Fetching details and tasks...");
        try {
            const [detailsData, apiTasks] = await Promise.all([apiFetchGantt(detailsUrl), apiFetchGantt(tasksUrl)]);
            console.log("[DEBUG STEP 8] API calls finished.");
            projectName = detailsData?.project_name || `Project ID: ${pId}`;
            projectNumber = detailsData?.project_no || 'N/A';
            projectPoNumber = detailsData?.po_no || 'N/A';
            if (pageTitleElement) pageTitleElement.textContent = `Gantt Chart for ${projectName}`;
            if (projectInfoDisplay) { projectInfoDisplay.html(`<span><strong>Project Name:</strong> ${projectName}</span> <span><strong>Project #:</strong> ${projectNumber}</span> <span><strong>PO #:</strong> ${projectPoNumber}</span>`); }
            else { console.warn("Project info display element not found."); }
            console.log("Fetched Project Details:", detailsData);
            allTasks = (apiTasks || []).map(mapTaskDataFromApi);
            console.log("Fetched and mapped tasks:", allTasks);
            taskSortColumn = null;
            filterAndSortAndRender(); // Initial render
        } catch (error) { console.error("Failed to fetch initial data:", error); alert(`Error loading project data: ${error.message}`); /* ... error display ... */ }
    }

    // --- Hierarchy Processing ---
    function buildTaskTree(tasksList) { /* ... */ }
    function flattenTaskTree(nodes, level = 0, flatList = []) { /* ... */ }

    // --- Data Processing, Filtering & Sorting ---
    function processTaskData(tasksToProcess) { /* ... */ }
    function calculateSCurveData() { /* ... */ }
    function filterAndSortAndRender() { /* ... */ }

    // --- Input Table Functions ---
    function createInputTable(tasksToDisplay) {
        if (!taskInputBody) { console.error("Task input table body not found."); return; }
        console.log('Tasks passed to createInputTable:', tasksToDisplay); // DEBUG
        if (typeof tasksToDisplay === 'undefined') { console.error("CRITICAL: tasksToDisplay is undefined right before .data() call!"); taskInputBody.html('<tr><td colspan="10" class="error">Error: Task data is undefined.</td></tr>'); return; }
        const rows = taskInputBody.selectAll("tr").data(tasksToDisplay, d => d.id);
        const rowsEnter = rows.enter().append("tr").attr("draggable", taskSortColumn === null).attr("data-task-row-id", d => d.id);
        rowsEnter.append("td").attr("class", "task-id-cell").text(d => d.id);
        rowsEnter.append("td").attr("class", d => `task-name-cell task-indent-${d.level || 0} ${!d.parent_task_id ? 'task-parent' : ''}`).append("input").attr("type", "text").attr("data-task-id", d => d.id).attr("data-field", "name").property("value", d => d.name || "").on("change", handleInputChange);
        rowsEnter.append("td").append("input").attr("type", "date").attr("data-task-id", d => d.id).attr("data-field", "start").property("value", d => d.start || "").on("change", handleInputChange);
        rowsEnter.append("td").append("input").attr("type", "date").attr("data-task-id", d => d.id).attr("data-field", "end").property("value", d => d.end || "").on("change", handleInputChange);
        rowsEnter.append("td").append("input").attr("type", "number").attr("min", 0).attr("step", 1).attr("data-task-id", d => d.id).attr("data-field", "plannedValue").property("value", d => d.plannedValue || 0).on("change", handleInputChange);
        rowsEnter.append("td").append("input").attr("type", "date").attr("data-task-id", d => d.id).attr("data-field", "actualStart").property("value", d => d.actualStart || "").on("change", handleInputChange);
        rowsEnter.append("td").append("input").attr("type", "date").attr("data-task-id", d => d.id).attr("data-field", "actualEnd").property("value", d => d.actualEnd || "").on("change", handleInputChange);
        rowsEnter.append("td").append("input").attr("type", "text").attr("data-task-id", d => d.id).attr("data-field", "assigned_to").property("value", d => d.assigned_to || "").on("change", handleInputChange);
        rowsEnter.append("td").attr("class", "subtask-action-cell").append("button").attr("class", "add-subtask-button").attr("data-parent-task-id", d => d.id).text("+ Subtask").on("click", handleAddSubtask);
        rowsEnter.append("td").attr("class", "action-cell").append("button").attr("class", "remove-task-button").attr("data-task-id", d => d.id).text("Remove").on("click", handleRemoveTask);
        if (taskSortColumn === null) { rowsEnter.on("dragstart", handleDragStart).on("dragend", handleDragEnd); } else { rowsEnter.on("dragstart", null).on("dragend", null); }
        const rowsUpdate = rows;
        rowsUpdate.select('td:nth-child(1)').text(d => d.id);
        rowsUpdate.select('td:nth-child(2)').attr("class", d => `task-name-cell task-indent-${d.level || 0} ${!d.parent_task_id ? 'task-parent' : ''}`);
        rowsUpdate.select('input[data-field="name"]').property("value", d => d.name || "");
        rowsUpdate.select('input[data-field="start"]').property("value", d => d.start || "");
        rowsUpdate.select('input[data-field="end"]').property("value", d => d.end || "");
        rowsUpdate.select('input[data-field="plannedValue"]').property("value", d => d.plannedValue || 0);
        rowsUpdate.select('input[data-field="actualStart"]').property("value", d => d.actualStart || "");
        rowsUpdate.select('input[data-field="actualEnd"]').property("value", d => d.actualEnd || "");
        rowsUpdate.select('input[data-field="assigned_to"]').property("value", d => d.assigned_to || "");
        rowsUpdate.attr("draggable", taskSortColumn === null).attr("data-task-row-id", d => d.id);
        if (taskSortColumn === null) { rowsUpdate.on("dragstart", handleDragStart).on("dragend", handleDragEnd); } else { rowsUpdate.on("dragstart", null).on("dragend", null); }
        rows.exit().remove();
        if (taskSortColumn === null) { taskInputBody.on("dragover", handleDragOver).on("drop", handleDrop); } else { taskInputBody.on("dragover", null).on("drop", null); }
    }

    // --- Input/Button Handlers (API Interaction) ---
    async function handleInputChange(event) { /* ... */ }
    async function handleAddTask() { await addTaskApiCall(null); }
    async function handleAddSubtask(event) { /* ... */ }
    async function addTaskApiCall(parentTaskId = null) { /* ... */ }
    async function handleRemoveTask(event) { /* ... */ }
    function handleSortClick(event) { /* ... */ }
    const handleFilterInput = debounce(() => { /* ... */ }, FILTER_DEBOUNCE_DELAY);

    // --- Drag and Drop Handlers ---
    function handleDragStart(event) { /* ... */ }
    function handleDragEnd(event) { /* ... */ }
    function handleDragOver(event) { /* ... */ }
    function handleDrop(event) { /* ... */ }

    // --- Tooltip Logic ---
    const handleMouseOver = function (event, d) { /* ... */ };
    const handleMouseOut = function (event, d) { /* ... */ };

    // --- Determine Bar Color Function ---
    function getBarColor(d) { /* ... */ }

    // --- Draw/Update Chart Elements Function ---
    function drawCharts(tasksToDraw, sCurveData) { /* ... */ }

    // --- Update Scales, Axes, Grids Function ---
    function updateLayout(tasksForLayout) { /* ... (includes Y-axis label styling) ... */ }

    // --- Main Update/Redraw Trigger ---
    function updateVisualization(tasksToDisplay = displayedTasks) { processTaskData(tasksToDisplay); const sCurveData = calculateSCurveData(); updateLayout(tasksToDisplay); drawCharts(tasksToDisplay, sCurveData); }
    // --- Responsive Resizing ---
    function handleResize() { filterAndSortAndRender(); }
    let resizeTimer; window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(handleResize, 150); });
    // --- SVG Export ---
    function exportGanttAsSVG() { /* ... */ }

    // --- Initial Setup ---
    /** Initializes the page, fetches data, and sets up listeners */
    function initializePage() {
        console.log("[DEBUG STEP 4] Entered initializePage function."); // <-- Check for this
        const urlParamsInit = new URLSearchParams(window.location.search);
        projectId = urlParamsInit.get('project_id');
        console.log("[DEBUG STEP 5] Extracted Project ID:", projectId); // <-- Check for this

        if (projectId) {
            console.log("Initializing for Project ID:", projectId);
            if (addTaskButton) { addTaskButton.on("click", handleAddTask); } else { console.warn("Add Task button not found."); }
            if (exportSvgButton) { exportSvgButton.on("click", exportGanttAsSVG); } else { console.warn("Export SVG button not found."); }
            if (taskFilterInput) { taskFilterInput.on("input", handleFilterInput); } else { console.warn("Task filter input not found."); }
            if (sortButtons) { sortButtons.on("click", handleSortClick); } else { console.warn("Sort buttons not found."); }
            fetchInitialData(projectId); // Fetch data
        } else { /* ... error handling ... */ }
        console.log("[DEBUG STEP 9] Exiting initializePage function."); // <-- Check for this
    }

    // Ensure utility functions are defined before use
    function debounce(func, delay) { let debounceTimer; return function (...args) { const context = this; clearTimeout(debounceTimer); debounceTimer = setTimeout(() => func.apply(context, args), delay); }; }
    function safeFloat(value, defaultVal = NaN) { try { return parseFloat(String(value).replace(/[,%$]/g, '').trim()) || defaultVal; } catch (e) { return defaultVal; } }
    // Ensure full function bodies are present for /* ... */ placeholders if copying pieces
    function mapTaskDataFromApi(apiTask) { return { id: apiTask.task_id, name: apiTask.task_name, start: apiTask.start_date, end: apiTask.end_date, plannedValue: apiTask.planned_weight, actualStart: apiTask.actual_start, actualEnd: apiTask.actual_end, assigned_to: apiTask.assigned_to, parent_task_id: apiTask.parent_task_id }; }
    function mapTaskDataToApi(jsTask) { return { task_name: jsTask.name, start_date: jsTask.start || null, end_date: jsTask.end || null, planned_weight: jsTask.plannedValue === '' ? 0 : (jsTask.plannedValue || 0), actual_start: jsTask.actualStart || null, actual_end: jsTask.actualEnd || null, assigned_to: jsTask.assigned_to || null, parent_task_id: jsTask.parent_task_id || null }; }
    function buildTaskTree(tasksList) { const taskMap = new Map(); const roots = []; const tasksCopy = tasksList.map(task => ({ ...task, children: [] })); tasksCopy.forEach(task => { taskMap.set(task.id, task); if (task.parent_task_id === null || task.parent_task_id === undefined || !taskMap.has(task.parent_task_id)) { roots.push(task); } }); tasksCopy.forEach(task => { if (task.parent_task_id !== null && task.parent_task_id !== undefined) { const parentNode = taskMap.get(task.parent_task_id); if (parentNode) { if (!parentNode.children.some(child => child.id === task.id)) { parentNode.children.push(task); } const rootIndex = roots.findIndex(r => r.id === task.id); if (rootIndex > -1) { roots.splice(rootIndex, 1); } } } }); roots.sort((a, b) => { const dateA = a.startDate; const dateB = b.startDate; if (dateA && dateB) return dateA.getTime() - dateB.getTime(); else if (dateA) return -1; else if (dateB) return 1; else return 0; }); return roots; }
    function flattenTaskTree(nodes, level = 0, flatList = []) { nodes.sort((a, b) => { const dateA = a.startDate; const dateB = b.startDate; if (dateA && dateB) return dateA.getTime() - dateB.getTime(); else if (dateA) return -1; else if (dateB) return 1; else return 0; }); nodes.forEach(node => { node.level = level; flatList.push(node); if (node.children && node.children.length > 0) { flattenTaskTree(node.children, level + 1, flatList); } }); return flatList; }
    // Add other utility function definitions if they were shortened previously

    console.log("[DEBUG STEP 3a] About to call initializePage..."); // <-- Check for this
    initializePage(); // Start the initialization
    console.log("[DEBUG STEP 10] initializePage function called."); // <-- Check for this


}); // End DOMContentLoaded
