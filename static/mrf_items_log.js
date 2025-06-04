document.addEventListener('DOMContentLoaded', function() {
    const mrfLogTableBody = document.getElementById('mrfItemsLogTableBody');
    const loadingIndicator = document.getElementById('mrfLogLoading');
    const errorDisplay = document.getElementById('mrfLogError');

    async function fetchMrfLog() {
        if (loadingIndicator) loadingIndicator.style.display = 'block';
        if (errorDisplay) errorDisplay.textContent = '';
        if (mrfLogTableBody) mrfLogTableBody.innerHTML = ''; // Clear existing rows

        try {
            const response = await fetch('/api/mrfs');
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: 'Failed to fetch MRF log. Server returned ' + response.status }));
                throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
            }
            const mrfLogData = await response.json();
            displayMrfLog(mrfLogData);
        } catch (error) {
            console.error('Error fetching MRF log:', error);
            if (errorDisplay) errorDisplay.textContent = `Error loading MRF log: ${error.message}`;
            if (mrfLogTableBody) {
                const row = mrfLogTableBody.insertRow();
                const cell = row.insertCell();
                cell.colSpan = 14; // Updated colspan
                cell.textContent = `Error loading data: ${error.message}`;
                cell.style.textAlign = 'center';
                cell.style.color = 'red';
            }
        } finally {
            if (loadingIndicator) loadingIndicator.style.display = 'none';
        }
    }

    function displayMrfLog(mrfItems) { // Renamed parameter to mrfItems for clarity
        if (!mrfLogTableBody) {
            console.error('MRF log table body not found');
            if (errorDisplay) errorDisplay.textContent = 'Error: Table body element not found in HTML.';
            return;
        }
        mrfLogTableBody.innerHTML = ''; // Clear previous content or loading rows

        if (!mrfItems || mrfItems.length === 0) {
            const row = mrfLogTableBody.insertRow();
            const cell = row.insertCell();
            cell.colSpan = 14; // Updated colspan
            cell.textContent = 'No MRF item records found.';
            cell.style.textAlign = 'center';
            return;
        }

        mrfItems.forEach(item => { // Each 'item' is now an individual MRF item with parent MRF info
            const row = mrfLogTableBody.insertRow();
            
            row.insertCell().textContent = item.form_no || 'N/A';
            row.insertCell().textContent = item.project_name || 'N/A';
            row.insertCell().textContent = item.mrf_date ? new Date(item.mrf_date).toLocaleDateString() : 'N/A';
            row.insertCell().textContent = item.item_no !== null && item.item_no !== undefined ? item.item_no : 'N/A';
            row.insertCell().textContent = item.part_no || 'N/A';
            row.insertCell().textContent = item.brand_name || 'N/A';
            row.insertCell().textContent = item.description || 'N/A';
            row.insertCell().textContent = item.qty !== null && item.qty !== undefined ? item.qty : 'N/A';
            row.insertCell().textContent = item.uom || 'N/A';
            row.insertCell().textContent = item.install_date ? new Date(item.install_date).toLocaleDateString() : 'N/A';
            row.insertCell().textContent = item.item_status || 'N/A'; // Status of the item itself
            row.insertCell().textContent = 'N/A'; // Actual Delivery - Placeholder as it's not in DB yet
            row.insertCell().textContent = item.item_remarks || 'N/A';
            
            const actionsCell = row.insertCell();
            actionsCell.style.textAlign = 'center';
            const viewButton = document.createElement('button');
            viewButton.textContent = 'View MRF';
            viewButton.className = 'button button-small button-info py-0.5 px-1 text-xs'; // Adjusted styling for smaller button
            viewButton.title = `View details for MRF ${item.form_no}`;
            viewButton.onclick = () => {
                // Redirect to the mrf_form.html page, pre-filled with the specific MRF's data
                // The mrf_form.js would need to handle a form_no URL parameter to fetch and load data.
                window.location.href = `/mrf_form?form_no=${encodeURIComponent(item.form_no)}`;
            };
            actionsCell.appendChild(viewButton);
        });
    }

    // Initial fetch
    fetchMrfLog();
}); 