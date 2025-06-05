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
                // Instead of redirecting, open a modal with details for this MRF item
                openMrfDetailsModal(item.form_no, item.item_no); // Pass both form_no and item_no
            };
            actionsCell.appendChild(viewButton);

            // Add Edit button
            const editButton = document.createElement('button');
            editButton.textContent = 'Edit';
            editButton.className = 'button button-small button-secondary py-0.5 px-1 text-xs ml-1'; // Adjusted styling
            editButton.title = `Edit MRF ${item.form_no}`;
            editButton.onclick = () => {
                // Open an edit modal instead of redirecting
                openMrfEditModal(item); // Pass the item data to the modal function
            };
            actionsCell.appendChild(editButton);

            // Add Delete button
            const deleteButton = document.createElement('button');
            deleteButton.textContent = 'Delete';
            deleteButton.className = 'button button-small button-danger py-0.5 px-1 text-xs ml-1'; // Adjusted styling
            deleteButton.title = `Delete MRF ${item.form_no}`;
            deleteButton.onclick = () => {
                if (confirm(`Are you sure you want to delete MRF ${item.form_no}? This action cannot be undone.`)) {
                    // TODO: Implement actual delete logic (call backend API)
                    console.log(`Delete confirmed for MRF: ${item.form_no}`);
                    // Example: call a function like deleteMrf(item.form_no);
                }
            };
            actionsCell.appendChild(deleteButton);
        });
    }

    // Placeholder for the modal functionality
    // This function will fetch the specific MRF item details and display them in a modal.
    async function openMrfDetailsModal(formNo, itemNo) {
        console.log(`Attempting to open modal for MRF: ${formNo}, Item: ${itemNo}`);
        
        const modal = document.getElementById('mrfDetailsModal');
        const loadingIndicator = document.getElementById('modalLoading');
        const errorDisplay = document.getElementById('modalError');
        const detailsContent = document.getElementById('mrfDetailsContent');

        // Show modal and loading indicator, hide previous content/errors
        if (modal) modal.classList.remove('hidden');
        if (loadingIndicator) loadingIndicator.classList.remove('hidden');
        if (errorDisplay) errorDisplay.classList.add('hidden');
        if (detailsContent) detailsContent.classList.add('hidden');
        if (errorDisplay) errorDisplay.textContent = ''; // Clear previous error message

        try {
            // Assuming an API endpoint exists at /api/mrf_details that accepts form_no and item_no
            const response = await fetch(`/api/mrf_details?form_no=${encodeURIComponent(formNo)}&item_no=${encodeURIComponent(itemNo)}`);
            
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: 'Failed to fetch MRF details. Server returned ' + response.status }));
                throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
            }

            const mrfDetails = await response.json();
            
            if (mrfDetails) {
                displayMrfDetailsInModal(mrfDetails);
            } else {
                 throw new Error('MRF details not found.');
            }

        } catch (error) {
            console.error('Error fetching MRF details:', error);
            if (errorDisplay) {
                errorDisplay.textContent = `Error loading details: ${error.message}`;
                errorDisplay.classList.remove('hidden');
            }
            if (loadingIndicator) loadingIndicator.classList.add('hidden');
             if (detailsContent) detailsContent.classList.add('hidden');
        }
    }

    // Function to populate the modal with data and show it.
    function displayMrfDetailsInModal(details) {
        const loadingIndicator = document.getElementById('modalLoading');
        const errorDisplay = document.getElementById('modalError');
        const detailsContent = document.getElementById('mrfDetailsContent');

        if (loadingIndicator) loadingIndicator.classList.add('hidden');
        if (errorDisplay) errorDisplay.classList.add('hidden');
        if (detailsContent) detailsContent.classList.remove('hidden');

        // Populate the detail spans
        document.getElementById('detail-form-no').textContent = details.form_no || 'N/A';
        document.getElementById('detail-project-name').textContent = details.project_name || 'N/A';
        document.getElementById('detail-mrf-date').textContent = details.mrf_date ? new Date(details.mrf_date).toLocaleDateString() : 'N/A';
        document.getElementById('detail-item-no').textContent = details.item_no !== null && details.item_no !== undefined ? details.item_no : 'N/A';
        document.getElementById('detail-part-no').textContent = details.part_no || 'N/A';
        document.getElementById('detail-brand-name').textContent = details.brand_name || 'N/A';
        document.getElementById('detail-description').textContent = details.description || 'N/A';
        document.getElementById('detail-qty').textContent = details.qty !== null && details.qty !== undefined ? details.qty : 'N/A';
        document.getElementById('detail-uom').textContent = details.uom || 'N/A';
        document.getElementById('detail-install-date').textContent = details.install_date ? new Date(details.install_date).toLocaleDateString() : 'N/A';
        document.getElementById('detail-item-status').textContent = details.item_status || 'N/A';
        document.getElementById('detail-actual-delivery').textContent = details.actual_delivery || 'N/A'; // Assuming this field exists now
        document.getElementById('detail-item-remarks').textContent = details.item_remarks || 'N/A';
    }

    // Function to close the modal.
    function closeModal() {
        const modal = document.getElementById('mrfDetailsModal');
        if (modal) modal.classList.add('hidden');
    }

    // Add event listener for closing the modal.
    const closeModalButton = document.getElementById('closeModalBtn');
    if (closeModalButton) {
        closeModalButton.addEventListener('click', closeModal);
    }

    // Placeholder for the MRF Edit Modal functionality
    function openMrfEditModal(itemData) {
        console.log('Attempting to open edit modal for item:', itemData);

        const modal = document.getElementById('mrfEditModal');
        if (!modal) {
            console.error('MRF Edit Modal element not found!');
            return;
        }

        // Get references to the form fields
        const itemIdInput = document.getElementById('edit-item-id');
        const formNoInput = document.getElementById('edit-form-no');
        const itemNoInput = document.getElementById('edit-item-no-identifier');
        const partNoInput = document.getElementById('edit-part-no');
        const brandNameInput = document.getElementById('edit-brand-name');
        const descriptionInput = document.getElementById('edit-description');
        const qtyInput = document.getElementById('edit-qty');
        const uomInput = document.getElementById('edit-uom');
        const installDateInput = document.getElementById('edit-install-date');
        const itemStatusSelect = document.getElementById('edit-item-status');
        const actualDeliveryInput = document.getElementById('edit-actual-delivery');
        const itemRemarksInput = document.getElementById('edit-item-remarks');

        // Populate the form fields with item data
        if (itemIdInput) itemIdInput.value = itemData.id || ''; // Assuming 'id' is the primary key
        if (formNoInput) formNoInput.value = itemData.form_no || '';
        if (itemNoInput) itemNoInput.value = itemData.item_no || ''; // Use a different ID to avoid conflict with details modal
        if (partNoInput) partNoInput.value = itemData.part_no || '';
        if (brandNameInput) brandNameInput.value = itemData.brand_name || '';
        if (descriptionInput) descriptionInput.value = itemData.description || '';
        if (qtyInput) qtyInput.value = itemData.qty !== null && itemData.qty !== undefined ? itemData.qty : '';
        if (uomInput) uomInput.value = itemData.uom || '';

        // Format date strings for input fields
        if (installDateInput) {
            installDateInput.value = itemData.install_date ? new Date(itemData.install_date).toISOString().split('T')[0] : '';
        }
         if (actualDeliveryInput) {
            actualDeliveryInput.value = itemData.actual_delivery ? new Date(itemData.actual_delivery).toISOString().split('T')[0] : '';
        }

        if (itemStatusSelect) itemStatusSelect.value = itemData.item_status || '';
        if (itemRemarksInput) itemRemarksInput.value = itemData.item_remarks || '';

        // Show the modal
        modal.classList.remove('hidden');

        // Handle form submission for saving edits
        const mrfEditForm = document.getElementById('mrfEditForm');
        if (mrfEditForm) {
            mrfEditForm.addEventListener('submit', async function(event) {
                event.preventDefault(); // Prevent default form submission

                console.log('Attempting to save MRF item edits...');

                // Collect data from the form fields
                const itemId = document.getElementById('edit-item-id').value; // Database ID
                const formNo = document.getElementById('edit-form-no').value;
                const itemNo = document.getElementById('edit-item-no-identifier').value; // Item number within the form

                const updatedData = {
                    // Include identifiers
                    id: itemId, // Send the database ID for the update query
                    form_no: formNo,
                    item_no: itemNo,

                    // Include editable fields
                    part_no: document.getElementById('edit-part-no').value,
                    brand_name: document.getElementById('edit-brand-name').value,
                    description: document.getElementById('edit-description').value,
                    qty: parseFloat(document.getElementById('edit-qty').value), // Convert to number
                    uom: document.getElementById('edit-uom').value,
                    install_date: document.getElementById('edit-install-date').value,
                    item_status: document.getElementById('edit-item-status').value,
                    actual_delivery: document.getElementById('edit-actual-delivery').value,
                    item_remarks: document.getElementById('edit-item-remarks').value,
                };

                console.log('Collected data for update:', updatedData);

                // TODO: Implement sending this data to a backend API endpoint
                // TODO: Handle the backend response (success/error)
                // TODO: Close the modal on success and refresh the table
                // Example fetch call (assuming a PUT or POST endpoint like /api/mrf_items/<item_id>):
                // try {
                //     const response = await fetch(`/api/mrf_items/${itemId}`, { // Use item ID in URL? Or pass in body? Consistent with backend design.
                //         method: 'PUT', // Or POST
                //         headers: {
                //             'Content-Type': 'application/json',
                //         },
                //         body: JSON.stringify(updatedData),
                //     });
                //
                //     if (!response.ok) {
                //         const errorData = await response.json().catch(() => ({ error: 'Failed to save MRF item. Server returned ' + response.status }));
                //         throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
                //     }
                //
                //     console.log('MRF item updated successfully');
                //     closeEditModal(); // Close the modal
                //     fetchMrfLog(); // Refresh the table data
                //
                // } catch (error) {
                //     console.error('Error saving MRF item:', error);
                //     // TODO: Display error message to the user in the modal or elsewhere
                //     alert('Failed to save changes: ' + error.message);
                // }
            });
        }
    }

    // Function to close the edit modal.
    function closeEditModal() {
        const modal = document.getElementById('mrfEditModal');
        if (modal) modal.classList.add('hidden');
    }

    // Add event listener for closing the edit modal.
    const closeEditModalButton = document.getElementById('closeEditModalBtn');
    if (closeEditModalButton) {
        closeEditModalButton.addEventListener('click', closeEditModal);
    }

    // Optional: Close modal when clicking outside (basic implementation)
    const editModal = document.getElementById('mrfEditModal');
    if (editModal) {
        editModal.addEventListener('click', function(event) {
            // Check if the click is directly on the modal background, not the modal content
            if (event.target === editModal) {
                closeEditModal();
            }
        });
    }

    // Initial fetch
    fetchMrfLog();
}); 