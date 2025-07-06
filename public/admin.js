// Admin Panel JavaScript
let adminToken = localStorage.getItem('adminToken');
let adminUser = JSON.parse(localStorage.getItem('adminUser') || 'null');

// API Base URL
const API_BASE = '';

// Utility functions
function showMessage(message, type = 'success') {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}`;
    messageDiv.innerHTML = `
        <i class="fas fa-${type === 'success' ? 'check-circle' : 'exclamation-circle'}"></i>
        ${message}
    `;
    
    document.body.appendChild(messageDiv);
    
    setTimeout(() => {
        messageDiv.remove();
    }, 5000);
}

async function apiCall(endpoint, options = {}) {
    try {
        const url = `${API_BASE}${endpoint}`;
        const config = {
            headers: {
                'Content-Type': 'application/json',
                ...(adminToken && { 'Authorization': `Bearer ${adminToken}` })
            },
            ...options
        };

        const response = await fetch(url, config);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'API request failed');
        }
        
        return data;
    } catch (error) {
        console.error('API Error:', error);
        showMessage(error.message, 'error');
        throw error;
    }
}

// Admin login handler
document.getElementById('adminLoginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const username = document.getElementById('adminUsername').value;
    const password = document.getElementById('adminPassword').value;
    
    try {
        const data = await apiCall('/api/admin/login', {
            method: 'POST',
            body: JSON.stringify({ username, password })
        });
        
        adminToken = data.token;
        adminUser = data.user;
        localStorage.setItem('adminToken', adminToken);
        localStorage.setItem('adminUser', JSON.stringify(adminUser));
        
        document.getElementById('adminLoginModal').style.display = 'none';
        document.getElementById('adminApp').style.display = 'block';
        document.getElementById('adminUserInfo').textContent = `${adminUser.username} (Admin)`;
        
        loadAdminDashboard();
        showMessage('Admin login successful!');
    } catch (error) {
        showMessage('Admin login failed. Please check your credentials.', 'error');
        document.getElementById('adminPassword').value = '';
    }
});

function adminLogout() {
    adminToken = null;
    adminUser = null;
    localStorage.removeItem('adminToken');
    localStorage.removeItem('adminUser');
    
    document.getElementById('adminApp').style.display = 'none';
    document.getElementById('adminLoginModal').style.display = 'block';
    document.getElementById('adminLoginForm').reset();
}

// Navigation functions
function showAdminSection(sectionId) {
    // Hide all sections
    document.querySelectorAll('.section').forEach(section => {
        section.classList.remove('active');
    });
    
    // Remove active class from all nav buttons
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    
    // Show selected section
    document.getElementById(sectionId === 'dashboard' ? 'adminDashboard' : 
                         sectionId === 'users' ? 'userManagement' :
                         sectionId === 'data' ? 'dataManagement' : 'systemSection').classList.add('active');
    
    // Add active class to clicked nav button
    event.target.classList.add('active');
    
    // Load section data
    loadSectionData(sectionId);
}

function loadSectionData(sectionId) {
    switch(sectionId) {
        case 'dashboard':
            loadAdminDashboard();
            break;
        case 'users':
            loadUsers();
            break;
        case 'data':
            loadDataManagement();
            break;
        case 'system':
            loadSystemInfo();
            break;
    }
}

// Dashboard functions
async function loadAdminDashboard() {
    try {
        const stats = await apiCall('/api/admin/dashboard');
        
        document.getElementById('totalUsers').textContent = stats.totalUsers;
        document.getElementById('totalProperties').textContent = stats.totalProperties;
        document.getElementById('totalTenants').textContent = stats.totalTenants;
        document.getElementById('totalMaintenance').textContent = stats.totalMaintenance;
        document.getElementById('totalFinancial').textContent = stats.totalFinancial;
        document.getElementById('totalRentTracking').textContent = stats.totalRentTracking;
    } catch (error) {
        console.error('Error loading admin dashboard:', error);
    }
}

// User management functions
async function loadUsers() {
    try {
        const users = await apiCall('/api/admin/users');
        displayUsers(users);
    } catch (error) {
        console.error('Error loading users:', error);
    }
}

function displayUsers(users) {
    const tbody = document.getElementById('usersTableBody');
    tbody.innerHTML = '';
    
    console.log('Users data received:', users);
    
    users.forEach(user => {
        const row = document.createElement('tr');
        const isAdmin = user.role === 'admin';
        const isCurrentAdmin = user.username === 'Admin';
        
        console.log('User expiry date:', user.username, user.expiry_date);
        const expiryStatus = user.expiry_date ? 
            (() => {
                try {
                    const expiryDate = new Date(user.expiry_date);
                    const now = new Date();
                    console.log('Comparing dates:', { expiryDate, now, isExpired: expiryDate < now });
                    return expiryDate < now ? 
                        '<span class="badge badge-danger">Expired</span>' : 
                        '<span class="badge badge-success">Active</span>';
                } catch (error) {
                    console.error('Error parsing expiry date:', error);
                    return '<span class="text-muted">Invalid date</span>';
                }
            })() : 
            '<span class="text-muted">No expiry</span>';
        
        row.innerHTML = `
            <td>${user.id}</td>
            <td>
                ${isCurrentAdmin ? 
                    `<span class="username-readonly">${user.username}</span>` :
                    `<span class="editable-username" data-id="${user.id}" onclick="editUsername(${user.id}, '${user.username}')">
                        ${user.username}
                    </span>`
                }
            </td>
            <td>${user.email}</td>
            <td><span class="badge badge-${isAdmin ? 'danger' : 'primary'}">${user.role}</span></td>
            <td>${new Date(user.created_at).toLocaleDateString()}</td>
            <td>${user.last_login ? new Date(user.last_login).toLocaleDateString() : 'Never'}</td>
            <td>${expiryStatus}</td>
            <td>
                ${isCurrentAdmin ? 
                    `<span class="text-muted">Protected</span>` :
                    `<button onclick="editUser(${user.id})" class="btn-edit" title="Edit User">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button onclick="deleteUser(${user.id}, '${user.username}')" class="btn-delete" title="Delete User">
                        <i class="fas fa-trash"></i>
                    </button>`
                }
            </td>
        `;
        tbody.appendChild(row);
    });
}

async function editUsername(userId, currentUsername) {
    // Prevent editing Admin username
    if (currentUsername === 'Admin') {
        showMessage('Admin username cannot be edited', 'error');
        return;
    }
    
    const newUsername = prompt('Enter new username:', currentUsername);
    if (newUsername && newUsername !== currentUsername) {
        try {
            await apiCall(`/api/admin/users/${userId}/username`, {
                method: 'PUT',
                body: JSON.stringify({ username: newUsername })
            });
            showMessage('Username updated successfully!');
            loadUsers();
        } catch (error) {
            showMessage('Failed to update username', 'error');
        }
    }
}

async function editUser(userId) {
    try {
        const users = await apiCall('/api/admin/users');
        const user = users.find(u => u.id === userId);
        
        if (!user) {
            showMessage('User not found', 'error');
            return;
        }
        
        // Prevent editing Admin user
        if (user.username === 'Admin') {
            showMessage('Admin user cannot be edited', 'error');
            return;
        }
        
        // Create edit modal
        const modalHTML = `
            <div id="editUserModal" class="modal" style="display: block;">
                <div class="modal-content">
                    <div class="modal-header">
                        <h2>Edit User</h2>
                        <span class="close-btn" onclick="closeModal('editUserModal')">&times;</span>
                    </div>
                    <form id="editUserForm" class="modal-form">
                        <div class="form-group">
                            <label for="editUsername">Username</label>
                            <input type="text" id="editUsername" value="${user.username}" required>
                        </div>
                        <div class="form-group">
                            <label for="editEmail">Email</label>
                            <input type="email" id="editEmail" value="${user.email}" required>
                        </div>
                        <div class="form-group">
                            <label for="editRole">Role</label>
                            <select id="editRole" required onchange="checkAdminRole()">
                                <option value="manager" ${user.role === 'manager' ? 'selected' : ''}>Manager</option>
                                <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Admin</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label for="editPassword">New Password (leave blank to keep current)</label>
                            <input type="password" id="editPassword" placeholder="Enter new password">
                        </div>
                        <div class="form-group">
                            <label for="editConfirmPassword">Confirm New Password</label>
                            <input type="password" id="editConfirmPassword" placeholder="Confirm new password">
                        </div>
                        <div class="form-group">
                            <label for="editExpiryDate">Account Expiry Date</label>
                            <div style="display: flex; gap: 10px; align-items: center;">
                                <input type="datetime-local" id="editExpiryDate" value="${user.expiry_date ? (() => {
                                    try {
                                        return new Date(user.expiry_date).toISOString().slice(0, 16);
                                    } catch (error) {
                                        console.error('Error formatting date for input:', error);
                                        return '';
                                    }
                                })() : ''}" style="flex: 1;">
                                <button type="button" onclick="clearExpiryDate()" class="btn-secondary" style="white-space: nowrap;">
                                    <i class="fas fa-times"></i> No Expiry
                                </button>
                            </div>
                        </div>
                        <div class="form-actions">
                            <button type="button" onclick="closeModal('editUserModal')" class="btn-secondary">Cancel</button>
                            <button type="submit" class="btn-primary">Update User</button>
                        </div>
                    </form>
                </div>
            </div>
        `;
        
        document.body.insertAdjacentHTML('beforeend', modalHTML);
        
        // Handle form submission
        document.getElementById('editUserForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const username = document.getElementById('editUsername').value;
            const email = document.getElementById('editEmail').value;
            const role = document.getElementById('editRole').value;
            const password = document.getElementById('editPassword').value;
            const confirmPassword = document.getElementById('editConfirmPassword').value;
            const expiryDate = document.getElementById('editExpiryDate').value;
            
            console.log('Form data:', { username, email, role, password: password ? '***' : 'not provided', expiryDate });
            
            // Validate password if provided
            if (password) {
                if (password.length < 8) {
                    showMessage('Password must be at least 8 characters long', 'error');
                    return;
                }
                
                if (password !== confirmPassword) {
                    showMessage('Passwords do not match', 'error');
                    return;
                }
                
                // Additional password strength validation
                const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
                if (!passwordRegex.test(password)) {
                    showMessage('Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character.', 'error');
                    return;
                }
            }
            
            try {
                const updateData = { username, email, role };
                if (password) {
                    updateData.password = password;
                }
                if (expiryDate) {
                    updateData.expiry_date = expiryDate;
                }
                
                await apiCall(`/api/admin/users/${userId}`, {
                    method: 'PUT',
                    body: JSON.stringify(updateData)
                });
                
                closeModal('editUserModal');
                showMessage('User updated successfully!');
                loadUsers();
            } catch (error) {
                showMessage('Failed to update user', 'error');
            }
        });
        
    } catch (error) {
        showMessage('Failed to load user data', 'error');
    }
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.remove();
    }
}

async function checkAdminRole() {
    // Allow multiple admin users now
    console.log('Admin role selected - multiple admins allowed');
}

function clearExpiryDate() {
    const expiryDateInput = document.getElementById('editExpiryDate');
    if (expiryDateInput) {
        expiryDateInput.value = '';
        showMessage('Expiry date cleared - account will have no expiry', 'success');
    }
}

async function deleteUser(userId, username) {
    if (confirm(`Are you sure you want to delete user "${username}"? This action cannot be undone.`)) {
        try {
            await apiCall(`/api/admin/users/${userId}`, {
                method: 'DELETE'
            });
            showMessage('User deleted successfully!');
            loadUsers();
            loadAdminDashboard();
        } catch (error) {
            showMessage('Failed to delete user', 'error');
        }
    }
}

// Data management functions
async function loadDataManagement() {
    try {
        const users = await apiCall('/api/admin/users');
        populateUserSelects(users);
    } catch (error) {
        console.error('Error loading users for data management:', error);
    }
}

function populateUserSelects(users) {
    const userSelect = document.getElementById('userSelect');
    const deleteUserSelect = document.getElementById('deleteUserSelect');
    
    // Clear existing options
    userSelect.innerHTML = '<option value="">Choose a user...</option>';
    deleteUserSelect.innerHTML = '<option value="">Choose a user...</option>';
    
    // Add user options (excluding Admin user specifically)
    users.filter(user => user.username !== 'Admin').forEach(user => {
        const option1 = document.createElement('option');
        option1.value = user.id;
        option1.textContent = `${user.username} (${user.email})`;
        userSelect.appendChild(option1);
        
        const option2 = document.createElement('option');
        option2.value = user.id;
        option2.textContent = `${user.username} (${user.email})`;
        deleteUserSelect.appendChild(option2);
    });
}

function showResetAllDataModal() {
    const confirmText = prompt('Type "RESET_ALL_DATA" to confirm resetting all data:');
    if (confirmText === 'RESET_ALL_DATA') {
        resetAllData();
    } else if (confirmText !== null) {
        showMessage('Confirmation text does not match', 'error');
    }
}

async function resetAllData() {
    try {
        await apiCall('/api/admin/reset-database', {
            method: 'POST',
            body: JSON.stringify({ confirm: 'RESET_ALL_DATA' })
        });
        showMessage('All data reset successfully!');
        loadAdminDashboard();
    } catch (error) {
        showMessage('Failed to reset data', 'error');
    }
}

function showResetUserDataModal() {
    const userId = document.getElementById('userSelect').value;
    if (!userId) {
        showMessage('Please select a user first', 'error');
        return;
    }
    
    const confirmText = prompt('Type "RESET_USER_DATA" to confirm resetting this user\'s data:');
    if (confirmText === 'RESET_USER_DATA') {
        resetUserData(userId);
    } else if (confirmText !== null) {
        showMessage('Confirmation text does not match', 'error');
    }
}

async function resetUserData(userId) {
    try {
        await apiCall(`/api/admin/users/${userId}/reset-data`, {
            method: 'POST',
            body: JSON.stringify({ confirm: 'RESET_USER_DATA' })
        });
        showMessage('User data reset successfully!');
        loadAdminDashboard();
    } catch (error) {
        showMessage('Failed to reset user data', 'error');
    }
}

function showDeleteUserModal() {
    const userId = document.getElementById('deleteUserSelect').value;
    if (!userId) {
        showMessage('Please select a user first', 'error');
        return;
    }
    
    const confirmText = prompt('Type "DELETE_USER" to confirm deleting this user account:');
    if (confirmText === 'DELETE_USER') {
        deleteUserAccount(userId);
    } else if (confirmText !== null) {
        showMessage('Confirmation text does not match', 'error');
    }
}

async function deleteUserAccount(userId) {
    try {
        await apiCall(`/api/admin/users/${userId}`, {
            method: 'DELETE'
        });
        showMessage('User account deleted successfully!');
        loadDataManagement();
        loadAdminDashboard();
    } catch (error) {
        showMessage('Failed to delete user account', 'error');
    }
}

// System functions
async function loadSystemInfo() {
    try {
        const info = await apiCall('/api/admin/system-info');
        const stats = await apiCall('/api/admin/dashboard');
        
        document.getElementById('systemInfo').innerHTML = `
            <div class="info-item">
                <strong>Server Time:</strong> ${new Date(info.serverTime).toLocaleString()}
            </div>
            <div class="info-item">
                <strong>Database Path:</strong> ${info.databasePath}
            </div>
            <div class="info-item">
                <strong>Total Tables:</strong> ${info.totalTables}
            </div>
            <div class="info-item">
                <strong>Admin User:</strong> ${info.adminUser}
            </div>
            <div class="info-item">
                <strong>Version:</strong> ${info.version}
            </div>
        `;
        
        document.getElementById('databaseStats').innerHTML = `
            <div class="info-item">
                <strong>Total Users:</strong> ${stats.totalUsers}
            </div>
            <div class="info-item">
                <strong>Total Properties:</strong> ${stats.totalProperties}
            </div>
            <div class="info-item">
                <strong>Total Tenants:</strong> ${stats.totalTenants}
            </div>
            <div class="info-item">
                <strong>Total Maintenance:</strong> ${stats.totalMaintenance}
            </div>
            <div class="info-item">
                <strong>Total Financial:</strong> ${stats.totalFinancial}
            </div>
            <div class="info-item">
                <strong>Total Rent Tracking:</strong> ${stats.totalRentTracking}
            </div>
        `;
    } catch (error) {
        console.error('Error loading system info:', error);
    }
}

// Search and filter functions
document.getElementById('userSearch').addEventListener('input', (e) => {
    const searchTerm = e.target.value.toLowerCase();
    const rows = document.querySelectorAll('#usersTableBody tr');
    
    rows.forEach(row => {
        const username = row.cells[1].textContent.toLowerCase();
        const email = row.cells[2].textContent.toLowerCase();
        
        if (username.includes(searchTerm) || email.includes(searchTerm)) {
            row.style.display = '';
        } else {
            row.style.display = 'none';
        }
    });
});

// Initialize admin app
function initAdminApp() {
    if (adminToken && adminUser) {
        document.getElementById('adminLoginModal').style.display = 'none';
        document.getElementById('adminApp').style.display = 'block';
        document.getElementById('adminUserInfo').textContent = `${adminUser.username} (Admin)`;
        loadAdminDashboard();
    } else {
        document.getElementById('adminLoginModal').style.display = 'block';
        document.getElementById('adminApp').style.display = 'none';
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    initAdminApp();
}); 