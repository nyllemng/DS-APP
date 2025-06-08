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
            
            // Editable cells
            const partNoCell = row.insertCell();
            partNoCell.textContent = item.part_no || 'N/A';
            setupEditableCell(partNoCell, item, 'part_no');

            const brandNameCell = row.insertCell();
            brandNameCell.textContent = item.brand_name || 'N/A';
            setupEditableCell(brandNameCell, item, 'brand_name');

            const descriptionCell = row.insertCell();
            descriptionCell.textContent = item.description || 'N/A';
            setupEditableCell(descriptionCell, item, 'description', 'textarea');

            const qtyCell = row.insertCell();
            qtyCell.textContent = item.qty !== null && item.qty !== undefined ? item.qty : 'N/A';
            setupEditableCell(qtyCell, item, 'qty', 'number');

            const uomCell = row.insertCell();
            uomCell.textContent = item.uom || 'N/A';
            setupEditableCell(uomCell, item, 'uom');

            const installDateCell = row.insertCell();
            installDateCell.textContent = item.install_date ? new Date(item.install_date).toLocaleDateString() : 'N/A';
            setupEditableCell(installDateCell, item, 'install_date', 'date');

            const statusCell = row.insertCell();
            statusCell.textContent = item.item_status || 'N/A';
            setupEditableCell(statusCell, item, 'item_status', 'select', ['Processing', 'Pending Approval', 'For Purchase Order', 'Awaiting Delivery', 'Delivered to CMR', 'Delivered to Site', 'Cancelled', 'On Hold']);

            const actualDeliveryCell = row.insertCell();
            actualDeliveryCell.textContent = item.actual_delivery ? new Date(item.actual_delivery).toLocaleDateString() : 'N/A';
            setupEditableCell(actualDeliveryCell, item, 'actual_delivery', 'date');

            const remarksCell = row.insertCell();
            remarksCell.textContent = item.item_remarks || 'N/A';
            setupEditableCell(remarksCell, item, 'item_remarks', 'textarea');
            
            const actionsCell = row.insertCell();
            actionsCell.style.textAlign = 'center';
            const viewButton = document.createElement('button');
            viewButton.textContent = 'View MRF';
            viewButton.className = 'button button-small button-info py-0.5 px-1 text-xs'; // Adjusted styling for smaller button
            viewButton.title = `View details for MRF ${item.form_no}`;
            viewButton.onclick = () => {
                openMrfDetailsModal(item);
            };
            actionsCell.appendChild(viewButton);

            // Add Delete button
            const deleteButton = document.createElement('button');
            deleteButton.textContent = 'Delete';
            deleteButton.className = 'button button-small button-danger py-0.5 px-1 text-xs ml-1'; // Adjusted styling
            deleteButton.title = `Delete MRF ${item.form_no}`;
            deleteButton.onclick = () => {
                if (confirm(`Are you sure you want to delete MRF ${item.form_no}? This action cannot be undone.`)) {
                    deleteMrfItem(item.id, item.form_no);
                }
            };
            actionsCell.appendChild(deleteButton);

            mrfLogTableBody.appendChild(row);
        });

        mrfLogLoading.textContent = ''; // Hide loading text
    }

    // Function to handle deleting an MRF item
    async function deleteMrfItem(itemId, formNo) {
        try {
            const response = await fetch(`/api/mrf_items/${itemId}`, {
                method: 'DELETE'
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to delete item');
            }

            alert(`MRF item ${formNo} deleted successfully!`);
            fetchMrfLog(); // Refresh the table
        } catch (error) {
            console.error('Error deleting MRF item:', error);
            alert('Failed to delete item: ' + error.message);
        }
    }

    // Function to set up an editable cell
    function setupEditableCell(cellElement, mrfItem, fieldName, type = 'text', options = []) {
        cellElement.setAttribute('data-field', fieldName);
        cellElement.setAttribute('data-id', mrfItem.item_id);
        cellElement.classList.add('editable-cell');

        cellElement.addEventListener('click', function() {
            if (this.querySelector('input') || this.querySelector('select') || this.querySelector('textarea')) return; // Already editing or textarea

            const originalValue = mrfItem[fieldName];
            let inputElement;

            if (type === 'select') {
                inputElement = document.createElement('select');
                inputElement.className = 'status-select w-full';
                options.forEach(optionText => {
                    const option = document.createElement('option');
                    option.value = optionText;
                    option.textContent = optionText;
                    if (optionText === originalValue) {
                        option.selected = true;
                    }
                    inputElement.appendChild(option);
                });
            } else if (type === 'date') {
                inputElement = document.createElement('input');
                inputElement.type = 'date';
                inputElement.className = 'date-input w-full';
                inputElement.value = originalValue ? new Date(originalValue).toISOString().split('T')[0] : '';
            } else if (type === 'number') {
                inputElement = document.createElement('input');
                inputElement.type = 'number';
                inputElement.step = 'any';
                inputElement.min = '0';
                inputElement.className = 'form-input w-full';
                inputElement.value = originalValue;
            } else if (type === 'textarea') {
                inputElement = document.createElement('textarea');
                inputElement.rows = '3';
                inputElement.className = 'form-input w-full';
                inputElement.value = originalValue;
            } else {
                inputElement = document.createElement('input');
                inputElement.type = 'text';
                inputElement.className = 'form-input w-full';
                inputElement.value = originalValue;
            }
            
            this.innerHTML = '';
            this.appendChild(inputElement);
            inputElement.focus();

            inputElement.addEventListener('blur', function() {
                saveEditedMrfItem(cellElement, this.value);
            });
            inputElement.addEventListener('keypress', function(e) {
                if (e.key === 'Enter') {
                    this.blur();
                }
            });
        });
    }

    // Function to save edited MRF item
    async function saveEditedMrfItem(cellElement, newValue) {
        const mrfId = cellElement.getAttribute('data-id');
        const fieldName = cellElement.getAttribute('data-field');
        const originalValue = cellElement.textContent;

        let displayValue = newValue;
        if (cellElement.querySelector('input[type="date"]')) {
            if (newValue) {
                const date = new Date(newValue);
                displayValue = `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
            } else {
                displayValue = 'N/A';
            }
        }

        if (newValue === originalValue || (newValue === '' && originalValue === 'N/A') || (newValue === null && originalValue === 'N/A')) {
            cellElement.textContent = originalValue;
            return; 
        }

        try {
            const response = await fetch('/api/mrf_items', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    id: mrfId,
                    [fieldName]: newValue
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to update item');
            }

            cellElement.textContent = displayValue;
            
            console.log(`MRF item ${mrfId} updated successfully: ${fieldName} to ${newValue}`);
        } catch (error) {
            console.error('Error saving MRF item:', error);
            alert('Failed to save changes: ' + error.message);
            cellElement.textContent = originalValue;
        }
    }

    // Function to open the MRF details modal
    async function openMrfDetailsModal(mrfItem) {
        const modal = document.getElementById('mrfDetailsModal');
        const loadingIndicator = document.getElementById('modalLoading');
        const errorDisplay = document.getElementById('modalError');
        const contentDiv = document.getElementById('mrfDetailsContent');

        modal.classList.remove('hidden');
        loadingIndicator.classList.remove('hidden');
        errorDisplay.classList.add('hidden');
        contentDiv.classList.add('hidden');

        try {
            document.getElementById('detail-form-no').textContent = mrfItem.form_no;
            document.getElementById('detail-project-name').textContent = mrfItem.project_name;
            document.getElementById('detail-mrf-date').textContent = mrfItem.mrf_date;
            document.getElementById('detail-item-no').textContent = mrfItem.item_no;
            document.getElementById('detail-part-no').textContent = mrfItem.part_no;
            document.getElementById('detail-brand-name').textContent = mrfItem.brand_name;
            document.getElementById('detail-description').textContent = mrfItem.description;
            document.getElementById('detail-qty').textContent = mrfItem.qty + (mrfItem.uom ? ' ' + mrfItem.uom : ''); 
            document.getElementById('detail-uom').textContent = mrfItem.uom;
            document.getElementById('detail-install-date').textContent = mrfItem.install_date;
            document.getElementById('detail-item-status').textContent = mrfItem.item_status;
            document.getElementById('detail-actual-delivery').textContent = mrfItem.actual_delivery || 'N/A';
            document.getElementById('detail-item-remarks').textContent = mrfItem.item_remarks || 'N/A';

            loadingIndicator.classList.add('hidden');
            contentDiv.classList.remove('hidden');

        } catch (error) {
            console.error('Error fetching MRF details:', error);
            loadingIndicator.classList.add('hidden');
            errorDisplay.textContent = 'Failed to load MRF details.';
            errorDisplay.classList.remove('hidden');
        }
    }

    // Function to close the MRF details modal
    function closeMrfDetailsModal() {
        document.getElementById('mrfDetailsModal').classList.add('hidden');
    }

    // Event listeners for modals
    document.getElementById('closeModalBtn').addEventListener('click', closeMrfDetailsModal);
    document.getElementById('mrfDetailsModal').addEventListener('click', function(event) {
        if (event.target === this) {
            closeMrfDetailsModal();
        }
    });

    // Initial fetch
    fetchMrfLog();
}); 