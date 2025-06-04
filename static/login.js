// Wait for the DOM to be fully loaded before running script
document.addEventListener('DOMContentLoaded', () => {
    // --- Get DOM Elements ---
    // Ensure all element IDs match the ones in your login.html
    const loginForm = document.getElementById('login-form');
    const loginUsernameInput = document.getElementById('username');
    const loginPasswordInput = document.getElementById('password');
    const loginMessageArea = document.getElementById('login-message'); // Message area specifically for login form

    const createAccountModal = document.getElementById('create-account-modal');
    const openModalBtn = document.getElementById('open-create-account-modal-btn');
    const closeModalBtn = document.getElementById('close-create-account-modal-btn');
    const cancelModalBtn = document.getElementById('cancel-create-account-btn');
    const createAccountForm = document.getElementById('create-account-form');
    const createUsernameInput = document.getElementById('create-username');
    const createPasswordInput = document.getElementById('create-password');
    const confirmPasswordInput = document.getElementById('confirm-password');
    const createRoleSelect = document.getElementById('create-role');
    const createAccountMessageArea = document.getElementById('create-account-message'); // Message area specifically for registration modal

    // --- Helper Function to Show Messages ---
    // areaElement: The div element where the message should be displayed
    // message: The text content of the message
    // type: 'error' or 'success' to apply appropriate styling
    function showMessageInArea(areaElement, message, type) {
        if (!areaElement) {
            console.error("Attempted to show message in a non-existent area. ID:", areaElement ? areaElement.id : 'Not Found');
            return;
        }
        areaElement.textContent = message;

        // Define base classes + type-specific classes using Tailwind
        const baseClasses = 'mt-4 p-3 rounded-md text-center text-sm font-medium'; // Base for login area
        const modalBaseClasses = 'mt-2 p-3 rounded-md text-center text-sm font-medium'; // Base for modal area
        const errorClasses = 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300';
        const successClasses = 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300';

        // Determine base class based on the element id
        const currentBase = areaElement.id === 'login-message' ? baseClasses : modalBaseClasses;

        // Reset classes first, applying the correct base and removing color/hidden
        areaElement.className = currentBase; // Apply base, remove hidden and color classes

        // Add type-specific color classes
        if (type === 'error') {
            areaElement.classList.add(...errorClasses.split(' '));
        } else if (type === 'success') {
            areaElement.classList.add(...successClasses.split(' '));
        }
        // Make the message area visible (already done by setting className which removed 'hidden')
    }

    // --- Helper Function to Clear Messages ---
    function clearMessageArea(areaElement) {
        if (areaElement) {
            areaElement.textContent = '';
            // Reset classes and add 'hidden'
            // Determine base class based on the element id to apply correct margin
            const baseClasses = 'mt-4 p-3 rounded-md text-center text-sm font-medium hidden';
            const modalBaseClasses = 'mt-2 p-3 rounded-md text-center text-sm font-medium hidden';
            areaElement.className = areaElement.id === 'login-message' ? baseClasses : modalBaseClasses;
        }
    }

    // --- Login Form Handler ---
    if (loginForm) {
        loginForm.addEventListener('submit', async (event) => {
            event.preventDefault(); // Prevent default form submission

            const username = loginUsernameInput.value.trim();
            const password = loginPasswordInput.value; // Don't trim password

            // Clear previous messages
            clearMessageArea(loginMessageArea);

            // Basic validation
            if (!username || !password) {
                showMessageInArea(loginMessageArea, 'Username and password are required.', 'error');
                return;
            }

            // Disable button and show loading state
            const submitButton = loginForm.querySelector('button[type="submit"]');
            submitButton.disabled = true;
            submitButton.textContent = 'Logging in...';

            try {
                // Send login request to the backend API
                const response = await fetch('/api/login', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ username, password }),
                });

                const result = await response.json();

                if (response.ok) {
                    // Login successful
                    showMessageInArea(loginMessageArea, result.message || 'Login successful!', 'success');
                    const redirectUrl = result.redirect_url || '/'; // Get redirect URL or default to dashboard
                    // Redirect after a short delay
                    setTimeout(() => {
                        window.location.href = redirectUrl;
                    }, 1500);
                } else {
                    // Login failed
                    showMessageInArea(loginMessageArea, result.error || 'Login failed. Please check credentials.', 'error');
                    loginPasswordInput.value = ''; // Clear password field
                    loginPasswordInput.focus(); // Set focus back to password
                    // Re-enable button
                    submitButton.disabled = false;
                    submitButton.textContent = 'Login';
                }
            } catch (error) {
                // Network or other fetch errors
                console.error('Login Fetch Error:', error);
                showMessageInArea(loginMessageArea, 'A network error occurred during login. Please try again later.', 'error');
                // Re-enable button
                submitButton.disabled = false;
                submitButton.textContent = 'Login';
            }
        });
    } else {
        console.error("Login form (#login-form) not found.");
    }

    // --- Modal Handling ---
    function openModal() {
        if (createAccountModal && createAccountForm) {
            console.log("Opening create account modal."); // Debug log
            createAccountModal.classList.remove('hidden');
            createAccountModal.classList.add('flex');
            createAccountForm.reset();
            clearMessageArea(createAccountMessageArea); // Clear modal messages
            clearMessageArea(loginMessageArea); // Also clear login messages
            if (createUsernameInput) {
                createUsernameInput.focus(); // Attempt to focus on the first input
                console.log("Focus set to create-username input."); // Debug log
            } else {
                console.error("Create username input not found for focus.");
            }
        } else {
            console.error("Create account modal (#create-account-modal) or form (#create-account-form) not found.");
        }
    }

    function closeModal() {
        if (createAccountModal) {
            console.log("Closing create account modal."); // Debug log
            createAccountModal.classList.add('hidden');
            createAccountModal.classList.remove('flex');
        }
    }

    // Event listeners for opening/closing the modal
    if (openModalBtn) {
        openModalBtn.addEventListener('click', openModal);
    } else {
        console.warn("Open modal button (#open-create-account-modal-btn) not found.");
    }
    if (closeModalBtn) {
        closeModalBtn.addEventListener('click', closeModal);
    } else {
        console.warn("Close modal button (#close-create-account-modal-btn) not found.");
    }
    if (cancelModalBtn) {
        cancelModalBtn.addEventListener('click', closeModal);
    } else {
        console.warn("Cancel modal button (#cancel-create-account-btn) not found.");
    }
    // Close modal if clicking on the backdrop (the modal container itself)
    if (createAccountModal) {
        createAccountModal.addEventListener('click', (event) => {
            // Ensure the click is directly on the modal container (the backdrop area)
            // and not on its children (like the modal content div).
            if (event.target === createAccountModal) {
                console.log("Backdrop clicked."); // Debug log
                closeModal();
            }
        });
    }


    // --- Create Account Form Handler ---
    if (createAccountForm) {
        createAccountForm.addEventListener('submit', async (event) => {
            event.preventDefault(); // Prevent default form submission
            console.log("Create account form submitted."); // Debug log

            // Get form data
            const username = createUsernameInput.value.trim();
            const password = createPasswordInput.value;
            const confirmPassword = confirmPasswordInput.value;
            const role = createRoleSelect.value;

            // Clear previous messages
            clearMessageArea(createAccountMessageArea);

            // --- Frontend Validations ---
            if (!username || !password || !confirmPassword || !role) {
                showMessageInArea(createAccountMessageArea, 'All fields are required.', 'error');
                return;
            }
            // Check password length (sync with MIN_PASSWORD_LENGTH in app.py if possible)
            if (password.length < 8) {
                showMessageInArea(createAccountMessageArea, 'Password must be at least 8 characters long.', 'error');
                createPasswordInput.focus();
                return;
            }
            if (password !== confirmPassword) {
                showMessageInArea(createAccountMessageArea, 'Passwords do not match.', 'error');
                confirmPasswordInput.focus();
                return;
            }

            // Disable button and show loading state
            const submitButton = createAccountForm.querySelector('button[type="submit"]');
            submitButton.disabled = true;
            submitButton.textContent = 'Creating...';

            let registrationSuccessful = false; // Flag to control button re-enabling
            let response; // Define response outside try block to use in finally

            try {
                console.log("Sending registration request:", { username, role }); // Debug log (don't log password)
                response = await fetch('/api/register', { // Target the registration endpoint
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password, role }), // Send username, password, role
                });
                const result = await response.json();
                console.log("Registration response:", response.status, result); // Debug log

                if (response.ok) {
                    // Account creation successful
                    registrationSuccessful = true;
                    showMessageInArea(createAccountMessageArea, result.message || 'Account created successfully!', 'success');
                    // Close modal and pre-fill login form after a delay
                    setTimeout(() => {
                        closeModal();
                        loginUsernameInput.value = username; // Pre-fill username
                        loginPasswordInput.value = '';      // Clear password
                        loginUsernameInput.focus();         // Focus on username for login
                        // No need to re-enable button here as modal closes
                    }, 2000);
                } else {
                    // Account creation failed (e.g., username taken)
                    showMessageInArea(createAccountMessageArea, result.error || 'Failed to create account. Please try again.', 'error');
                }

            } catch (error) {
                // Network or other fetch errors
                console.error('Registration Fetch Error:', error);
                showMessageInArea(createAccountMessageArea, 'A network error occurred during registration. Please try again later.', 'error');
            } finally {
                // Re-enable button ONLY if registration failed (or network error)
                if (!registrationSuccessful) {
                    submitButton.disabled = false;
                    submitButton.textContent = 'Create Account';
                }
            }
        });
    } else {
        console.error("Create account form (#create-account-form) not found.");
    }

}); // End DOMContentLoaded
