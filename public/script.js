// Global variables
let currentUser = null;
let authToken = localStorage.getItem('authToken');
let currentTenantView = 'card'; // Track current tenant view mode
let currentPropertyView = 'card'; // Track current property view mode

// API Base URL
const API_BASE = 'http://localhost:3000';

// Export dashboard data to Excel (for dashboardExportExcelBtn)
async function exportDashboardExcel() {
    try {
        showMessage('Preparing dashboard export...', 'info');
        
        // Fetch complete data from APIs to get all required fields
        const [properties, tenants] = await Promise.all([
            apiCall('/api/properties'),
            apiCall('/api/tenants')
        ]);
        
        // Get dashboard stats to know which properties are pending/paid
        const dashboardStats = await apiCall('/api/dashboard');
        const pendingPropertyIds = (dashboardStats.pendingRentProperties || []).map(p => p.id);
        const paidPropertyIds = (dashboardStats.rentPaidProperties || []).map(p => p.id);
        
        // Combine all property IDs that have rent activity
        const activePropertyIds = [...new Set([...pendingPropertyIds, ...paidPropertyIds])];
        
        // Build complete data rows with all required fields
        const dataRows = activePropertyIds.map(propertyId => {
            const property = properties.find(p => p.id === propertyId);
            const tenant = tenants.find(t => t.property_id === propertyId);
            
            // Get the last cheque date from tenant's cheques (if available)
            let lastChequeDate = '';
            if (tenant && tenant.cheques && tenant.cheques.length > 0) {
                const datedCheques = tenant.cheques.filter(c => c.date && !c.is_security);
                if (datedCheques.length > 0) {
                    const sortedCheques = datedCheques.sort((a, b) => new Date(b.date) - new Date(a.date));
                    lastChequeDate = sortedCheques[0].date;
                }
            }
            
            return {
                'Property Name': property?.name || '',
                'Tenant Name': tenant ? `${tenant.first_name || ''} ${tenant.last_name || ''}`.trim() : '',
                'Rent Amount': property?.rent_amount || tenant?.rent_amount || '',
                'Electricity Number': property?.electricity_number || '',
                'Water Number': property?.water_number || '',
                'Nationality': tenant?.nationality || '',
                'Cheque Expiry Date': lastChequeDate
            };
        });
        
        // Sort the data rows by property name in natural order (Villa 1, Villa 2, Villa 3, etc.)
        dataRows.sort((a, b) => {
            const nameA = a['Property Name'] || '';
            const nameB = b['Property Name'] || '';
            
            // Extract numbers from property names for natural sorting
            const extractNumber = (str) => {
                const match = str.match(/(\d+)/);
                return match ? parseInt(match[1]) : 0;
            };
            
            const numA = extractNumber(nameA);
            const numB = extractNumber(nameB);
            
            // If both have numbers, sort by number
            if (numA > 0 && numB > 0) {
                return numA - numB;
            }
            
            // If only one has a number, put the one with number first
            if (numA > 0 && numB === 0) return -1;
            if (numA === 0 && numB > 0) return 1;
            
            // If neither has numbers, sort alphabetically
            return nameA.localeCompare(nameB);
        });
        
        if (!dataRows.length) {
            showMessage('No dashboard data to export', 'error');
            return;
        }
        
        // Create worksheet and workbook
        const worksheet = XLSX.utils.json_to_sheet(dataRows);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Dashboard');
        
        // Filename with timestamp
        const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
        const filename = `dashboard_export_${timestamp}.xlsx`;
        
        // Download the file
        XLSX.writeFile(workbook, filename);
        showMessage('Dashboard data exported successfully!', 'success');
        
    } catch (error) {
        console.error('Error exporting dashboard data:', error);
        showMessage('Failed to export dashboard data', 'error');
    }
}

// Make the function globally available
window.exportDashboardExcel = exportDashboardExcel;

// Helper function to determine cheque status
function getChequeStatus(tenant) {
    if (!tenant.cheques) {
        return 'None';
    }
    
    if (Array.isArray(tenant.cheques)) {
        return tenant.cheques.length > 0 ? 'Yes' : 'No';
    }
    
    return 'None';
}

// Function to manage tenant contract
async function manageTenantContract(tenantId) {
    try {
        const tenant = await apiCall(`/api/tenants/${tenantId}`);
        
        // Ensure property name is properly set
        let propertyDisplayName = 'N/A';
        if (tenant.property_name) {
            propertyDisplayName = tenant.property_name;
        } else if (tenant.property_id) {
            // If we have property_id but no property_name, try to get it
            try {
                const property = await apiCall(`/api/properties/${tenant.property_id}`);
                if (property && property.name) {
                    propertyDisplayName = property.name;
                }
            } catch (error) {
                console.error('Error fetching property name:', error);
            }
        }
        
        // Populate tenant information
        document.getElementById('contractTenantName').textContent = `${tenant.first_name} ${tenant.last_name}`;
        document.getElementById('contractPropertyName').textContent = propertyDisplayName;
        document.getElementById('contractCurrentStatus').textContent = tenant.status || 'Active';
        document.getElementById('contractLeaseEnd').textContent = tenant.lease_end ? new Date(tenant.lease_end).toLocaleDateString() : 'N/A';
        
        // Set effective date to today
        document.getElementById('contractEffectiveDate').value = new Date().toISOString().split('T')[0];
        
        // Load cheques for settlement
        await loadContractCheques(tenant.cheques || [], tenant.currency || 'USD');
        
        // Store tenant ID for form submission
        document.getElementById('contractManagementForm').dataset.tenantId = tenantId;
        
        showModal('contractManagementModal');
        
    } catch (error) {
        console.error('Error loading tenant contract data:', error);
        showMessage('Failed to load tenant contract data', 'error');
    }
}

// Function to load cheques for contract settlement
async function loadContractCheques(cheques, currency = 'USD') {
    const chequeList = document.getElementById('contractChequeList');
    
    if (!cheques || cheques.length === 0) {
        chequeList.innerHTML = '<p>No cheques found for this tenant.</p>';
        return;
    }
    
    let content = '<div class="cheque-settlement-items">';
    
    cheques.forEach((cheque, index) => {
        const isSecurity = cheque.is_security;
        content += `
            <div class="cheque-settlement-item ${isSecurity ? 'security' : 'dated'}">
                <div class="cheque-info">
                    <div class="cheque-header">
                        <span class="cheque-type">${isSecurity ? 'Security' : 'Dated'} Cheque ${index + 1}</span>
                        <span class="cheque-amount">${cheque.amount ? `${currency} ${cheque.amount.toLocaleString()}` : 'N/A'}</span>
                    </div>
                    <div class="cheque-details">
                        <span>Number: ${cheque.cheque_number || 'N/A'}</span>
                        <span>Bank: ${cheque.bank_name || 'N/A'}</span>
                        <span>Date: ${cheque.date ? new Date(cheque.date).toLocaleDateString() : 'No Date'}</span>
                    </div>
                </div>
                <div class="cheque-action">
                    <select class="cheque-action-select" data-cheque-id="${cheque.id}">
                        <option value="return">Return</option>
                        <option value="destroy">Destroy</option>
                        <option value="hold">Hold</option>
                    </select>
                </div>
            </div>
        `;
    });
    
    content += '</div>';
    chequeList.innerHTML = content;
}

// Function to toggle contract action fields
function toggleContractActionFields() {
    const action = document.getElementById('contractAction').value;
    const penaltyField = document.getElementById('contractPenaltyAmount');
    const noticeField = document.getElementById('contractNoticePeriod');
    
    // Reset fields
    penaltyField.value = '';
    noticeField.value = '30';
    
    // Adjust fields based on action
    switch(action) {
        case 'breached':
            penaltyField.placeholder = 'Enter penalty amount for breach';
            noticeField.value = '0';
            break;
        case 'cancelled':
            penaltyField.placeholder = 'Enter cancellation fee (if any)';
            noticeField.value = '30';
            break;
        case 'terminated':
            penaltyField.placeholder = 'Enter termination fee (if any)';
            noticeField.value = '60';
            break;
        case 'renewed':
        case 'extended':
            penaltyField.value = '0';
            penaltyField.placeholder = 'No penalty for renewal/extension';
            break;
    }
}

// Function to calculate final settlement amount
function calculateSettlementAmount() {
    const rentOwed = parseFloat(document.getElementById('contractRentOwed').value) || 0;
    const depositReturn = parseFloat(document.getElementById('contractDepositReturn').value) || 0;
    const penaltyAmount = parseFloat(document.getElementById('contractPenaltyAmount').value) || 0;
    
    const finalAmount = depositReturn - rentOwed - penaltyAmount;
    document.getElementById('contractFinalAmount').value = finalAmount.toFixed(2);
}

// Function to handle contract management form submission
async function handleContractManagement(event) {
    event.preventDefault();
    
    const tenantId = event.target.dataset.tenantId;
    const formData = {
        action: document.getElementById('contractAction').value,
        effective_date: document.getElementById('contractEffectiveDate').value,
        notice_period: document.getElementById('contractNoticePeriod').value,
        reason: document.getElementById('contractReason').value,
        rent_owed: document.getElementById('contractRentOwed').value,
        deposit_return: document.getElementById('contractDepositReturn').value,
        penalty_amount: document.getElementById('contractPenaltyAmount').value,
        final_amount: document.getElementById('contractFinalAmount').value,
        cheque_action: document.getElementById('contractChequeAction').value
    };
    
    // Debug: Log the data being sent
    console.log('Contract management data:', formData);
    console.log('Tenant ID:', tenantId);
    
    try {
        const response = await apiCall(`/api/tenants/${tenantId}/contract-management`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(formData)
        });
        
        console.log('Contract management response:', response);
        showMessage('Contract status updated successfully', 'success');
        closeModal('contractManagementModal');
        
        // Refresh tenant list
        await loadTenants();
        
    } catch (error) {
        console.error('Error updating contract status:', error);
        console.error('Error details:', error.message);
        
        // Handle different types of errors
        let errorMessage = 'Failed to update contract status';
        if (error.message.includes('Unexpected token')) {
            errorMessage = 'Server error - please check if server is running';
        } else if (error.message.includes('404')) {
            errorMessage = 'API endpoint not found';
        } else if (error.message.includes('500')) {
            errorMessage = 'Server internal error';
        } else if (error.message) {
            errorMessage = error.message;
        }
        
        showMessage(errorMessage, 'error');
    }
}

// Function to show cheque details popup
async function showChequeDetails(tenantId) {
    try {
        const tenant = await apiCall(`/api/tenants/${tenantId}`);
        

        
        // Ensure property name is properly set
        let propertyDisplayName = 'N/A';
        if (tenant.property_name) {
            propertyDisplayName = tenant.property_name;
        } else if (tenant.property_id) {
            // If we have property_id but no property_name, try to get it
            try {
                const property = await apiCall(`/api/properties/${tenant.property_id}`);
                if (property && property.name) {
                    propertyDisplayName = property.name;
                }
            } catch (error) {
                console.error('Error fetching property name:', error);
            }
        }
        
        if (!tenant.cheques || tenant.cheques.length === 0) {
            showMessage('No cheque details available for this tenant', 'error');
            return;
        }
        
        const title = `Cheque Details - ${tenant.first_name} ${tenant.last_name}`;
        
        // Group cheques by type
        const datedCheques = tenant.cheques.filter(c => !c.is_security);
        const securityCheques = tenant.cheques.filter(c => c.is_security);
        
        let content = `
            <div class="cheque-details-popup">
                <div class="tenant-info">
                    <h4><i class="fas fa-user"></i> Tenant Information</h4>
                    <div class="tenant-details">
                        <div class="detail-row">
                            <strong>Name:</strong> ${tenant.first_name} ${tenant.last_name}
                        </div>
                        <div class="detail-row">
                            <strong>Email:</strong> ${tenant.email}
                        </div>
                        <div class="detail-row">
                            <strong>Property:</strong> ${propertyDisplayName}
                        </div>
                        <div class="detail-row">
                            <strong>Total Cheques:</strong> ${tenant.cheques.length} (${datedCheques.length} Dated, ${securityCheques.length} Security)
                        </div>
                    </div>
                </div>
                
                <div class="cheque-sections">
        `;
        
        // Dated Cheques Section
        if (datedCheques.length > 0) {
            content += `
                <div class="cheque-section">
                    <h4><i class="fas fa-calendar-alt"></i> Dated Cheques (${datedCheques.length})</h4>
                    <div class="cheque-list">
            `;
            
            datedCheques.forEach((cheque, index) => {
                content += `
                    <div class="cheque-item dated">
                        <div class="cheque-header">
                            <span class="cheque-number">Cheque ${index + 1}</span>
                            <span class="cheque-date">${cheque.date ? new Date(cheque.date).toLocaleDateString() : 'No Date'}</span>
                        </div>
                        <div class="cheque-details">
                            <div class="cheque-detail">
                                <strong>Number:</strong> ${cheque.cheque_number || 'N/A'}
                            </div>
                            <div class="cheque-detail">
                                <strong>Bank:</strong> ${cheque.bank_name || 'N/A'}
                            </div>
                            <div class="cheque-detail">
                                <strong>Amount:</strong> ${cheque.amount ? `${tenant.currency || 'USD'} ${cheque.amount.toLocaleString()}` : 'N/A'}
                            </div>
                        </div>
                    </div>
                `;
            });
            
            content += `
                    </div>
                </div>
            `;
        }
        
        // Security Cheques Section
        if (securityCheques.length > 0) {
            content += `
                <div class="cheque-section">
                    <h4><i class="fas fa-shield-alt"></i> Security Cheques (${securityCheques.length})</h4>
                    <div class="cheque-list">
            `;
            
            securityCheques.forEach((cheque, index) => {
                content += `
                    <div class="cheque-item security">
                        <div class="cheque-header">
                            <span class="cheque-number">Security Cheque ${index + 1}</span>
                            <span class="security-badge">Security</span>
                        </div>
                        <div class="cheque-details">
                            <div class="cheque-detail">
                                <strong>Number:</strong> ${cheque.cheque_number || 'N/A'}
                            </div>
                            <div class="cheque-detail">
                                <strong>Bank:</strong> ${cheque.bank_name || 'N/A'}
                            </div>
                            <div class="cheque-detail">
                                <strong>Amount:</strong> ${cheque.amount ? `${tenant.currency || 'USD'} ${cheque.amount.toLocaleString()}` : 'N/A'}
                            </div>
                        </div>
                    </div>
                `;
            });
            
            content += `
                    </div>
                </div>
            `;
        }
        
        content += `
                </div>
            </div>
        `;
        
        showCustomPopup(title, content);
        
    } catch (error) {
        console.error('Error fetching cheque details:', error);
        showMessage('Failed to load cheque details', 'error');
    }
}

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

function formatCurrency(amount) {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD'
    }).format(amount);
}

function formatDate(dateString) {
    return new Date(dateString).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}

function formatPropertyType(type) {
    if (!type) return 'N/A';
    
    // Handle specific property types
    const typeMap = {
        'villa': 'Villa',
        '1bhk': '1 BHK',
        '2bhk': '2 BHK', 
        '3bhk': '3 BHK',
        '4bhk': '4 BHK',
        'studio': 'Studio',
        'apartment': 'Apartment',
        'house': 'House',
        'condo': 'Condo',
        'townhouse': 'Townhouse',
        'shop': 'Shop',
        'mall': 'Mall',
        'other': 'Other'
    };
    
    return typeMap[type.toLowerCase()] || type.charAt(0).toUpperCase() + type.slice(1).replace(/([A-Z])/g, ' $1');
}

function formatPropertyStatus(status) {
    if (!status) return 'N/A';
    
    // Handle specific status values
    const statusMap = {
        'vacant': 'Vacant',
        'occupied': 'Occupied',
        'maintenance': 'Under Maintenance'
    };
    
    return statusMap[status.toLowerCase()] || status.charAt(0).toUpperCase() + status.slice(1);
}

// Utility functions to populate dropdowns
async function populatePropertyDropdowns() {
    try {
        console.log('Populating property dropdowns...');
        const properties = await apiCall('/api/properties');
        console.log('Properties received:', properties);
        
        const propertySelects = ['tenantProperty', 'maintenanceProperty', 'financialProperty', 'rentTrackingProperty'];
        
        propertySelects.forEach(selectId => {
            const select = document.getElementById(selectId);
            console.log(`Looking for select with ID: ${selectId}`, select);
            
            if (select) {
                // Clear existing options except the first one
                select.innerHTML = '<option value="">Select Property</option>';
                
                if (properties && properties.length > 0) {
                    properties.forEach(property => {
                        // For tenant property selection, only show non-vacant properties
                        // BUT include vacant properties if we're editing a tenant (to show their current property)
                        if (selectId === 'tenantProperty' && property.status === 'vacant') {
                            // Check if we're editing a tenant and this is their current property
                            const tenantForm = document.getElementById('tenantForm');
                            const editId = tenantForm ? tenantForm.dataset.editId : null;
                            
                            if (!editId) {
                                return; // Skip vacant properties for new tenant assignment
                            }
                            // If editing, we'll include all properties including vacant ones
                        }
                        
                        const option = document.createElement('option');
                        option.value = property.id;
                        option.textContent = `${property.name} (${property.type ? property.type.charAt(0).toUpperCase() + property.type.slice(1).replace(/([A-Z])/g, ' $1') : 'N/A'}) - ${property.address}`;
                        // Store property data as data attributes for easy access
                        option.dataset.rentAmount = property.rent_amount || '';
                        option.dataset.currency = property.currency || 'USD';
                        option.dataset.status = property.status || 'vacant';
                        select.appendChild(option);
                    });
                    console.log(`Added ${properties.length} properties to ${selectId}`);
                } else {
                    console.log('No properties available to populate dropdown');
                    // Add a disabled option to show no properties available
                    const option = document.createElement('option');
                    option.value = "";
                    option.textContent = "No properties available";
                    option.disabled = true;
                    select.appendChild(option);
                }
            } else {
                console.error(`Select element with ID '${selectId}' not found`);
            }
        });
        
        // Add event listeners for auto-populating rent amounts
        setupPropertySelectionListeners();
    } catch (error) {
        console.error('Error populating property dropdowns:', error);
        showMessage('Failed to load properties for dropdown', 'error');
    }
}

// Cheque Management Functions
function updateChequeFields() {
    const chequeCountSelect = document.getElementById('tenantChequeCount');
    const customChequeCountGroup = document.getElementById('customChequeCountGroup');
    const chequeDetailsContainer = document.getElementById('chequeDetailsContainer');
    const customChequeCount = document.getElementById('customChequeCount');
    
    let totalCheques = 0;
    
    if (chequeCountSelect.value === 'custom') {
        customChequeCountGroup.style.display = 'block';
        totalCheques = parseInt(customChequeCount.value) || 0;
    } else {
        customChequeCountGroup.style.display = 'none';
        totalCheques = parseInt(chequeCountSelect.value) || 0;
    }
    
    if (totalCheques > 0) {
        chequeDetailsContainer.style.display = 'block';
        generateChequeFields(totalCheques);
        updateChequeSummary(totalCheques);
    } else {
        chequeDetailsContainer.style.display = 'none';
    }
}

function generateChequeFields(totalCheques) {
    const container = document.getElementById('chequeFieldsContainer');
    container.innerHTML = '';
    
    // Determine security cheques (last cheque is security if total is 13, or if custom and > 1)
    const securityCheques = totalCheques === 13 ? 1 : (totalCheques > 1 ? 1 : 0);
    const datedCheques = totalCheques - securityCheques;
    
    for (let i = 1; i <= totalCheques; i++) {
        const isSecurity = i === totalCheques && securityCheques > 0;
        const isFirstCheque = i === 1;
        const chequeHtml = `
            <div class="cheque-field" data-cheque-index="${i}">
                <div class="cheque-header">
                    <h4>Cheque ${i}${isSecurity ? ' (Security)' : ''}</h4>
                    ${isSecurity ? '<span class="security-badge">Security</span>' : ''}
                    ${isFirstCheque ? '<span class="first-cheque-badge">First Cheque</span>' : ''}
                </div>
                <div class="cheque-inputs">
                    <div class="form-row">
                        <div class="form-group">
                            <label for="chequeNumber${i}">Cheque Number</label>
                            <input type="text" id="chequeNumber${i}" placeholder="Enter cheque number" value="${String(i).padStart(4, '0')}">
                        </div>
                        <div class="form-group">
                            <label for="chequeBank${i}">Bank Name</label>
                            <input type="text" id="chequeBank${i}" placeholder="Enter bank name" value="Bank ${i}">
                        </div>
                    </div>
                    <div class="form-row">
                        <div class="form-group">
                            <label for="chequeDate${i}">Date</label>
                            <input type="date" id="chequeDate${i}" ${isSecurity ? 'disabled' : ''}>
                        </div>
                        <div class="form-group">
                            <label for="chequeAmount${i}">Amount</label>
                            <input type="number" id="chequeAmount${i}" min="0" step="0.01" placeholder="Enter amount">
                        </div>
                    </div>
                    ${isSecurity ? '<div class="security-note"><i class="fas fa-info-circle"></i> Security cheque - no date required</div>' : ''}
                    ${isFirstCheque ? '<div class="first-cheque-note"><i class="fas fa-star"></i> Set this date first, then use Auto-Generate for others</div>' : ''}
                </div>
            </div>
        `;
        container.innerHTML += chequeHtml;
    }
}

function updateChequeSummary(totalCheques) {
    const securityCheques = totalCheques === 13 ? 1 : (totalCheques > 1 ? 1 : 0);
    const datedCheques = totalCheques - securityCheques;
    
    document.getElementById('totalChequeCount').textContent = totalCheques;
    document.getElementById('datedChequeCount').textContent = datedCheques;
    document.getElementById('securityChequeCount').textContent = securityCheques;
}

function generateChequeDates() {
    const totalCheques = parseInt(document.getElementById('tenantChequeCount').value) || 
                        parseInt(document.getElementById('customChequeCount').value) || 0;
    
    if (totalCheques === 0) {
        showMessage('Please set cheque count first.', 'error');
        return;
    }
    
    // Get the first cheque details
    const firstChequeDate = document.getElementById('chequeDate1').value;
    const firstChequeNumber = document.getElementById('chequeNumber1').value;
    const firstChequeBank = document.getElementById('chequeBank1').value;
    const firstChequeAmount = document.getElementById('chequeAmount1').value;
    
    if (!firstChequeDate) {
        showMessage('Please set the first cheque date first, then use Auto-Generate.', 'error');
        return;
    }
    
    if (!firstChequeNumber) {
        showMessage('Please set the first cheque number first, then use Auto-Generate.', 'error');
        return;
    }
    
    const startDate = new Date(firstChequeDate);
    const securityCheques = totalCheques === 13 ? 1 : (totalCheques > 1 ? 1 : 0);
    const datedCheques = totalCheques - securityCheques;
    
    // Extract the base number from first cheque number
    let baseNumber = 1;
    if (firstChequeNumber) {
        const numberMatch = firstChequeNumber.match(/(\d+)/);
        if (numberMatch) {
            baseNumber = parseInt(numberMatch[1]);
        }
    }
    
    // Generate dates starting from the first cheque date
    for (let i = 1; i <= datedCheques; i++) {
        const chequeDate = new Date(startDate);
        chequeDate.setMonth(startDate.getMonth() + i - 1);
        
        const dateInput = document.getElementById(`chequeDate${i}`);
        if (dateInput) {
            dateInput.value = chequeDate.toISOString().split('T')[0];
        }
    }
    
    // Auto-generate cheque numbers, bank names, and amounts based on first cheque
    for (let i = 1; i <= totalCheques; i++) {
        const chequeNumberInput = document.getElementById(`chequeNumber${i}`);
        const bankNameInput = document.getElementById(`chequeBank${i}`);
        const amountInput = document.getElementById(`chequeAmount${i}`);
        
        if (chequeNumberInput) {
            // Increment from the first cheque number
            const nextNumber = baseNumber + i - 1;
            chequeNumberInput.value = String(nextNumber).padStart(4, '0');
        }
        
        if (bankNameInput && firstChequeBank) {
            // Copy the bank name from first cheque
            bankNameInput.value = firstChequeBank;
        }
        
        if (amountInput && firstChequeAmount) {
            // Copy the amount from first cheque
            amountInput.value = firstChequeAmount;
        }
    }
    
    showMessage(`Generated dates, cheque numbers, bank names, and amounts for ${datedCheques} cheques starting from ${firstChequeDate}`, 'success');
}

function clearAllCheques() {
    const container = document.getElementById('chequeFieldsContainer');
    const inputs = container.querySelectorAll('input');
    
    inputs.forEach(input => {
        input.value = '';
    });
    
    showMessage('All cheque details cleared', 'success');
}

function getChequeData() {
    const chequeCount = parseInt(document.getElementById('tenantChequeCount').value) || 
                       parseInt(document.getElementById('customChequeCount').value) || 0;
    
    if (chequeCount === 0) return null;
    
    const cheques = [];
    for (let i = 1; i <= chequeCount; i++) {
        const chequeNumber = document.getElementById(`chequeNumber${i}`).value;
        const chequeBank = document.getElementById(`chequeBank${i}`).value;
        const chequeDate = document.getElementById(`chequeDate${i}`).value;
        const chequeAmount = document.getElementById(`chequeAmount${i}`).value;
        
        if (chequeNumber || chequeBank || chequeDate || chequeAmount) {
            cheques.push({
                cheque_number: chequeNumber,
                bank_name: chequeBank,
                date: chequeDate,
                amount: parseFloat(chequeAmount) || 0,
                is_security: i === chequeCount && chequeCount === 13
            });
        }
    }
    
    return cheques.length > 0 ? cheques : null;
}

function loadChequeData(cheques) {
    if (!cheques || cheques.length === 0) return;
    
    // Set cheque count
    const chequeCount = cheques.length;
    const chequeCountSelect = document.getElementById('tenantChequeCount');
    
    if (chequeCount <= 12) {
        chequeCountSelect.value = chequeCount.toString();
    } else if (chequeCount === 13) {
        chequeCountSelect.value = '13';
    } else {
        chequeCountSelect.value = 'custom';
        document.getElementById('customChequeCount').value = chequeCount;
    }
    
    updateChequeFields();
    
    // Populate cheque data
    cheques.forEach((cheque, index) => {
        const i = index + 1;
        const chequeNumberInput = document.getElementById(`chequeNumber${i}`);
        const chequeBankInput = document.getElementById(`chequeBank${i}`);
        const chequeDateInput = document.getElementById(`chequeDate${i}`);
        const chequeAmountInput = document.getElementById(`chequeAmount${i}`);
        
        if (chequeNumberInput) chequeNumberInput.value = cheque.cheque_number || '';
        if (chequeBankInput) chequeBankInput.value = cheque.bank_name || '';
        if (chequeDateInput) chequeDateInput.value = cheque.date || '';
        if (chequeAmountInput) chequeAmountInput.value = cheque.amount || '';
    });
}

// Function to setup property selection listeners for auto-populating rent amounts
function setupPropertySelectionListeners() {
    // Tenant form property selection
    const tenantPropertySelect = document.getElementById('tenantProperty');
    if (tenantPropertySelect) {
        tenantPropertySelect.addEventListener('change', function() {
            const selectedOption = this.options[this.selectedIndex];
            if (selectedOption && selectedOption.value) {
                const rentAmount = selectedOption.dataset.rentAmount;
                const currency = selectedOption.dataset.currency;
                
                if (rentAmount) {
                    document.getElementById('tenantRent').value = rentAmount;
                    document.getElementById('tenantCurrency').value = currency;
                } else {
                    document.getElementById('tenantRent').value = '';
                    document.getElementById('tenantCurrency').value = 'USD';
                }
            } else {
                document.getElementById('tenantRent').value = '';
                document.getElementById('tenantCurrency').value = 'USD';
            }
        });
    }
    
    // Maintenance form property selection
    const maintenancePropertySelect = document.getElementById('maintenanceProperty');
    if (maintenancePropertySelect) {
        maintenancePropertySelect.addEventListener('change', function() {
            autoFillTenantForProperty(this.value, 'maintenanceTenant');
        });
    }
    
    // Financial form property selection
    const financialPropertySelect = document.getElementById('financialProperty');
    if (financialPropertySelect) {
        financialPropertySelect.addEventListener('change', function() {
            autoFillTenantForProperty(this.value, 'financialTenant');
        });
    }
    
    // Rent tracking form property selection
    const rentTrackingPropertySelect = document.getElementById('rentTrackingProperty');
    if (rentTrackingPropertySelect) {
        rentTrackingPropertySelect.addEventListener('change', function() {
            const selectedOption = this.options[this.selectedIndex];
            if (selectedOption && selectedOption.value) {
                const rentAmount = selectedOption.dataset.rentAmount;
                const currency = selectedOption.dataset.currency;
                
                if (rentAmount) {
                    document.getElementById('rentTrackingTotalAmount').value = rentAmount;
                    document.getElementById('rentTrackingCurrency').value = currency;
                    document.getElementById('rentTrackingPaymentAmount').value = rentAmount;
                } else {
                    document.getElementById('rentTrackingTotalAmount').value = '';
                    document.getElementById('rentTrackingPaymentAmount').value = '';
                    document.getElementById('rentTrackingCurrency').value = 'USD';
                }
            } else {
                document.getElementById('rentTrackingTotalAmount').value = '';
                document.getElementById('rentTrackingPaymentAmount').value = '';
                document.getElementById('rentTrackingCurrency').value = 'USD';
            }
            
            // Also auto-fill tenant
            autoFillTenantForProperty(this.value, 'rentTrackingTenant');
        });
    }
}

// Function to auto-fill tenant based on selected property
async function autoFillTenantForProperty(propertyId, tenantSelectId) {
    if (!propertyId) {
        document.getElementById(tenantSelectId).value = '';
        return;
    }
    
    try {
        const tenants = await apiCall('/api/tenants');
        const propertyTenants = tenants.filter(tenant => 
            tenant.property_id == propertyId && tenant.status === 'active'
        );
        
        const tenantSelect = document.getElementById(tenantSelectId);
        
        if (propertyTenants.length > 0) {
            // Auto-select the first active tenant for this property
            tenantSelect.value = propertyTenants[0].id;
        } else {
            // No active tenants for this property
            tenantSelect.value = '';
        }
    } catch (error) {
        console.error('Error auto-filling tenant:', error);
    }
}

// Function to toggle custom property type input field
function toggleCustomPropertyType() {
    const propertyTypeSelect = document.getElementById('propertyType');
    const customPropertyTypeRow = document.getElementById('customPropertyTypeRow');
    const customPropertyTypeInput = document.getElementById('customPropertyType');
    
    if (propertyTypeSelect.value === 'other') {
        customPropertyTypeRow.style.display = 'flex';
        customPropertyTypeInput.required = true;
        customPropertyTypeInput.focus();
    } else {
        customPropertyTypeRow.style.display = 'none';
        customPropertyTypeInput.required = false;
        customPropertyTypeInput.value = '';
    }
}

// Function to toggle free month details visibility
function toggleFreeMonthDetails() {
    const freeMonthSelect = document.getElementById('tenantFreeMonth');
    const freeMonthDetails = document.getElementById('freeMonthDetails');
    const freeMonthDate = document.getElementById('tenantFreeMonthDate');
    
    console.log('toggleFreeMonthDetails called, value:', freeMonthSelect.value);
    
    if (freeMonthSelect.value === 'custom') {
        freeMonthDetails.style.display = 'block';
        freeMonthDate.required = true;
    } else {
        freeMonthDetails.style.display = 'none';
        freeMonthDate.required = false;
        freeMonthDate.value = '';
    }
}

// Add event listener for free month dropdown when modal opens
function setupFreeMonthListener() {
    const freeMonthSelect = document.getElementById('tenantFreeMonth');
    if (freeMonthSelect) {
        // Remove existing listener to prevent duplicates
        freeMonthSelect.removeEventListener('change', toggleFreeMonthDetails);
        // Add new listener
        freeMonthSelect.addEventListener('change', toggleFreeMonthDetails);
        console.log('Free month listener setup complete');
    }
}

async function populateTenantDropdown() {
    try {
        const tenants = await apiCall('/api/tenants');
        const tenantSelects = ['maintenanceTenant', 'financialTenant', 'rentTrackingTenant'];
        
        tenantSelects.forEach(selectId => {
            const select = document.getElementById(selectId);
            if (select) {
                // Clear existing options except the first one
                select.innerHTML = '<option value="">Select Tenant</option>';
                
                tenants.forEach(tenant => {
                    const option = document.createElement('option');
                    option.value = tenant.id;
                    option.textContent = `${tenant.first_name} ${tenant.last_name}`;
                    select.appendChild(option);
                });
            }
        });
    } catch (error) {
        console.error('Error populating tenant dropdowns:', error);
    }
}

// Authentication functions
function showAuthTab(tab) {
    const tabs = document.querySelectorAll('.auth-tab');
    const forms = document.querySelectorAll('.auth-form');
    
    tabs.forEach(t => t.classList.remove('active'));
    forms.forEach(f => f.style.display = 'none');
    
    event.target.classList.add('active');
    document.getElementById(`${tab}Form`).style.display = 'block';
}

function showModal(modalId) {
    console.log('Opening modal:', modalId);
    document.getElementById(modalId).style.display = 'block';
    
    // Populate dropdowns when opening modals (but not for tenant modal when editing)
    if (modalId === 'maintenanceModal' || modalId === 'financialModal' || modalId === 'rentTrackingModal') {
        console.log('Populating property dropdowns for modal:', modalId);
        populatePropertyDropdowns();
        console.log('Populating tenant dropdowns for modal:', modalId);
        populateTenantDropdown();
    } else if (modalId === 'tenantModal') {
        // Only populate dropdowns for new tenant (not when editing)
        const tenantForm = document.getElementById('tenantForm');
        if (!tenantForm.dataset.editId) {
            console.log('Populating property dropdowns for new tenant modal');
            populatePropertyDropdowns();
        }
    }
    
    // Setup free month listener for tenant modal
    if (modalId === 'tenantModal') {
        // Use setTimeout to ensure DOM elements are loaded
        setTimeout(() => {
            setupFreeMonthListener();
            // Initialize the free month display state
            toggleFreeMonthDetails();
        }, 100);
    }
    
    // Set default values for rent tracking
    if (modalId === 'rentTrackingModal') {
        setDefaultRentTrackingValues();
    }
    
    // Load profile data when opening profile modal
    if (modalId === 'profileModal') {
        loadProfileData();
    }
}

function closeModal(modalId) {
    document.getElementById(modalId).style.display = 'none';
    // Reset form
    const form = document.querySelector(`#${modalId} form`);
    if (form) {
        form.reset();
        // Clear edit mode
        delete form.dataset.editId;
        
        // Reset modal titles and custom fields
        if (modalId === 'propertyModal') {
            document.getElementById('propertyModalTitle').textContent = 'Add New Property';
            // Reset custom property type field
            document.getElementById('customPropertyTypeRow').style.display = 'none';
            document.getElementById('customPropertyType').required = false;
            document.getElementById('customPropertyType').value = '';
        } else if (modalId === 'tenantModal') {
            document.getElementById('tenantModalTitle').textContent = 'Add New Tenant';
            // Reset free month fields
            const freeMonthDetails = document.getElementById('freeMonthDetails');
            if (freeMonthDetails) {
                freeMonthDetails.style.display = 'none';
            }
        } else if (modalId === 'maintenanceModal') {
            document.getElementById('maintenanceModalTitle').textContent = 'New Maintenance Request';
        } else if (modalId === 'financialModal') {
            document.getElementById('financialModalTitle').textContent = 'Add Financial Record';
        }
    }
}

function showSection(sectionId) {
    // Hide all sections
    document.querySelectorAll('.section').forEach(section => {
        section.classList.remove('active');
    });
    
    // Remove active class from all nav buttons
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    
    // Show selected section
    document.getElementById(sectionId).classList.add('active');
    
    // Add active class to clicked nav button
    event.target.classList.add('active');
    
    // Load section data
    loadSectionData(sectionId);
}

function loadSectionData(sectionId) {
    switch(sectionId) {
        case 'dashboard':
            loadDashboard();
            break;
        case 'properties':
            loadProperties();
            break;
        case 'tenants':
            loadTenants();
            break;
        case 'maintenance':
            loadMaintenance();
            break;
        case 'financial':
            loadFinancial();
            break;
    }
}

// API functions
async function apiCall(endpoint, options = {}) {
    const url = `${API_BASE}${endpoint}`;
    const config = {
        headers: {
            'Content-Type': 'application/json',
            ...(authToken && { 'Authorization': `Bearer ${authToken}` })
        },
        ...options
    };
    
    try {
        const response = await fetch(url, config);
        const data = await response.json();
        
        if (!response.ok) {
            // Handle validation errors and SQL errors more gracefully
            let errorMessage = data.error || 'API request failed';
            
            // Make SQL errors more user-friendly
            if (errorMessage.includes('SQLITE_CONSTRAINT')) {
                if (errorMessage.includes('UNIQUE constraint failed')) {
                    errorMessage = 'This record already exists. Please check for duplicates.';
                } else if (errorMessage.includes('FOREIGN KEY constraint failed')) {
                    errorMessage = 'Invalid reference. Please check the selected property or tenant.';
                } else {
                    errorMessage = 'Database constraint error. Please check your input.';
                }
            } else if (errorMessage.includes('NOT NULL constraint failed')) {
                errorMessage = 'Required fields cannot be empty. Please fill in all required fields.';
            }
            
            throw new Error(errorMessage);
        }
        
        return data;
    } catch (error) {
        console.error('API Error:', error);
        showMessage(error.message, 'error');
        throw error;
    }
}

// Authentication handlers
document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const username = document.getElementById('loginUsername').value;
    const passwordInput = document.getElementById('loginPassword');
    const password = passwordInput.value;
    
    try {
        const data = await apiCall('/api/login', {
            method: 'POST',
            body: JSON.stringify({ username, password })
        });
        
        authToken = data.token;
        currentUser = data.user;
        localStorage.setItem('authToken', authToken);
        localStorage.setItem('currentUser', JSON.stringify(currentUser));
        
        document.getElementById('authModal').style.display = 'none';
        document.getElementById('app').style.display = 'block';
        document.getElementById('currentUser').textContent = currentUser.username;
        
        loadDashboard();
        showMessage('Login successful!');
    } catch (error) {
        let errorMessage = 'Login failed. Please check your username and password.';
        
        // Make error messages more specific
        if (error.message.includes('Invalid token') || error.message.includes('Access token required')) {
            errorMessage = 'Authentication error. Please try logging in again.';
        } else if (error.message.includes('Network') || error.message.includes('fetch')) {
            errorMessage = 'Connection error. Please check your internet connection.';
        }
        
        showMessage(errorMessage, 'error');
        passwordInput.value = '';
        // Keep username filled for retry
        document.getElementById('loginUsername').value = username;
    }
});

document.getElementById('registerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const usernameInput = document.getElementById('registerUsername');
    const emailInput = document.getElementById('registerEmail');
    const passwordInput = document.getElementById('registerPassword');
    const username = usernameInput.value;
    const email = emailInput.value;
    const password = passwordInput.value;
    
    try {
        const data = await apiCall('/api/register', {
            method: 'POST',
            body: JSON.stringify({ username, email, password })
        });
        
        authToken = data.token;
        currentUser = data.user;
        localStorage.setItem('authToken', authToken);
        localStorage.setItem('currentUser', JSON.stringify(currentUser));
        
        document.getElementById('authModal').style.display = 'none';
        document.getElementById('app').style.display = 'block';
        document.getElementById('currentUser').textContent = currentUser.username;
        
        loadDashboard();
        showMessage('Registration successful!');
    } catch (error) {
        let errorMessage = 'Registration failed. Please try again.';
        
        // Make error messages more specific
        if (error.message.includes('already exists')) {
            if (error.message.includes('Username')) {
                errorMessage = 'Username already exists. Please choose a different username.';
            } else if (error.message.includes('Email')) {
                errorMessage = 'Email already exists. Please use a different email address.';
            } else {
                errorMessage = 'Username or email already exists. Please try different values.';
            }
            // Keep fields filled for retry
            usernameInput.value = username;
            emailInput.value = email;
        } else if (error.message.includes('Network') || error.message.includes('fetch')) {
            errorMessage = 'Connection error. Please check your internet connection.';
        } else if (error.message.includes('password')) {
            errorMessage = 'Password error. Please check your password requirements.';
        }
        
        showMessage(errorMessage, 'error');
        passwordInput.value = '';
    }
});

function logout() {
    authToken = null;
    currentUser = null;
    localStorage.removeItem('authToken');
    localStorage.removeItem('currentUser');
    
    document.getElementById('app').style.display = 'none';
    document.getElementById('authModal').style.display = 'block';
    
    // Reset forms
    document.getElementById('loginForm').reset();
    document.getElementById('registerForm').reset();
}

// Dashboard functions
async function loadDashboard() {
    try {
        console.log('Loading dashboard...');
        const stats = await apiCall('/api/dashboard');
        console.log('Dashboard stats received:', stats);
        
        // Store data globally for popup access
        dashboardData.pendingRentProperties = stats.pendingRentProperties || [];
        dashboardData.rentPaidProperties = stats.rentPaidProperties || [];
        dashboardData.vacantPropertiesList = stats.vacantPropertiesList || [];
        
        console.log('Dashboard data loaded:', {
            pending: dashboardData.pendingRentProperties.length,
            paid: dashboardData.rentPaidProperties.length,
            vacant: dashboardData.vacantPropertiesList.length
        });
        
        // Calculate total rent amount from all properties with currency grouping
        let totalRentAmount = 0;
        let pendingRentAmount = 0;
        let paidRentAmount = 0;
        let currencyMap = {};
        
        try {
            const allProperties = await apiCall('/api/properties');
            
            // Group properties by currency and calculate totals
            allProperties.forEach(property => {
                const currency = property.currency || 'USD';
                const amount = property.rent_amount || 0;
                
                if (!currencyMap[currency]) {
                    currencyMap[currency] = { total: 0, pending: 0, paid: 0 };
                }
                currencyMap[currency].total += amount;
            });
            
            // Calculate pending rent amount from pending rent properties
            if (stats.pendingRentProperties && stats.pendingRentProperties.length > 0) {
                stats.pendingRentProperties.forEach(property => {
                    const currency = property.currency || 'USD';
                    const amount = property.rent_amount || 0;
                    
                    if (!currencyMap[currency]) {
                        currencyMap[currency] = { total: 0, pending: 0, paid: 0 };
                    }
                    currencyMap[currency].pending += amount;
                });
            }
            
            // Calculate paid rent amount from paid rent properties
            if (stats.rentPaidProperties && stats.rentPaidProperties.length > 0) {
                stats.rentPaidProperties.forEach(property => {
                    const currency = property.currency || 'USD';
                    const amount = property.rent_amount || 0;
                    
                    if (!currencyMap[currency]) {
                        currencyMap[currency] = { total: 0, pending: 0, paid: 0 };
                    }
                    currencyMap[currency].paid += amount;
                });
            }
            
            // Get the most common currency or default to USD
            const currencies = Object.keys(currencyMap);
            const primaryCurrency = currencies.length > 0 ? currencies[0] : 'USD';
            
            totalRentAmount = currencyMap[primaryCurrency]?.total || 0;
            pendingRentAmount = currencyMap[primaryCurrency]?.pending || 0;
            paidRentAmount = currencyMap[primaryCurrency]?.paid || 0;
            
        } catch (error) {
            console.error('Error calculating rent amounts:', error);
        }
        
        // Function to get currency symbol
        function getCurrencySymbol(currency) {
            const symbols = {
                'USD': '$',
                'EUR': '€',
                'GBP': '£',
                'INR': '₹',
                'QAR': 'QAR',
                'AED': 'AED',
                'SAR': 'SAR',
                'KWD': 'KWD',
                'BHD': 'BHD',
                'OMR': 'OMR',
                'CAD': 'C$',
                'AUD': 'A$',
                'JPY': '¥',
                'CHF': 'CHF',
                'SGD': 'S$'
            };
            return symbols[currency] || currency;
        }
        
        // Get the most common currency
        const currencies = Object.keys(currencyMap);
        const primaryCurrency = currencies.length > 0 ? currencies[0] : 'USD';
        const currencySymbol = getCurrencySymbol(primaryCurrency);
        
        // Update rent amount displays in header
        document.getElementById('headerTotalRentAmount').textContent = `${currencySymbol} ${totalRentAmount.toLocaleString()}`;
        document.getElementById('headerPendingRentAmount').textContent = `${currencySymbol} ${pendingRentAmount.toLocaleString()}`;
        document.getElementById('headerPaidRentAmount').textContent = `${currencySymbol} ${paidRentAmount.toLocaleString()}`;
        
        document.getElementById('totalProperties').textContent = stats.totalProperties;
        document.getElementById('occupiedProperties').textContent = stats.occupiedProperties;
        document.getElementById('vacantProperties').textContent = stats.vacantProperties;
        document.getElementById('activeTenants').textContent = stats.activeTenants;
        document.getElementById('pendingMaintenance').textContent = stats.pendingMaintenance;
        document.getElementById('pendingRentCount').textContent = stats.pendingRentProperties ? stats.pendingRentProperties.length : 0;
        
        // Update dashboard card counts
        try {
            const pendingElement = document.getElementById('dashboardPendingRentCount');
            const paidElement = document.getElementById('dashboardPaidRentCount');
            
            console.log('Updating dashboard counts:', {
                pendingCount: stats.pendingRentProperties ? stats.pendingRentProperties.length : 0,
                paidCount: stats.rentPaidProperties ? stats.rentPaidProperties.length : 0
            });
            
            if (pendingElement) {
                pendingElement.textContent = stats.pendingRentProperties ? stats.pendingRentProperties.length : 0;
                console.log('Updated pending count to:', pendingElement.textContent);
            } else {
                console.error('dashboardPendingRentCount element not found');
            }
            
            if (paidElement) {
                paidElement.textContent = stats.rentPaidProperties ? stats.rentPaidProperties.length : 0;
                console.log('Updated paid count to:', paidElement.textContent);
            } else {
                console.error('dashboardPaidRentCount element not found');
            }
        } catch (error) {
            console.error('Error updating dashboard counts:', error);
        }
        
        // Load dashboard sections
        try {
            await loadVacantPropertiesList(stats.vacantPropertiesList);
            await loadRecentMaintenance();
        } catch (error) {
            console.error('Error loading dashboard sections:', error);
        }
    } catch (error) {
        console.error('Error loading dashboard:', error);
    }
}

async function loadRecentProperties() {
    try {
        const properties = await apiCall('/api/properties');
        const recentProperties = properties.slice(0, 5);
        
        const container = document.getElementById('recentProperties');
        container.innerHTML = '';
        
        if (recentProperties.length === 0) {
            container.innerHTML = '<div class="empty-state"><i class="fas fa-home"></i><h3>No properties yet</h3></div>';
            return;
        }
        
        recentProperties.forEach(property => {
            const item = document.createElement('div');
            item.className = 'list-item';
            item.innerHTML = `
                <div class="list-item-info">
                    <h4>${property.name}</h4>
                    <p>${property.address}</p>
                </div>
                <span class="card-status status-${property.status}">${property.status}</span>
            `;
            container.appendChild(item);
        });
    } catch (error) {
        console.error('Error loading recent properties:', error);
    }
}

async function loadPendingRentProperties(pendingRentProperties) {
    try {
        const container = document.getElementById('pendingRentProperties');
        container.innerHTML = '';
        
        if (!pendingRentProperties || pendingRentProperties.length === 0) {
            container.innerHTML = '<div class="empty-state"><i class="fas fa-check-circle"></i><h3>All rent paid</h3><p>No pending rent for this month</p></div>';
            return;
        }
        
        pendingRentProperties.forEach((property, index) => {
            const item = document.createElement('div');
            item.className = 'list-item rent-item pending clickable';
            item.innerHTML = `
                <div class="list-item-content" onclick="showPropertyPopup('pending', ${index})">
                    <div class="list-item-info">
                        <h4>${property.name}</h4>
                        <span class="card-status status-pending">Pending</span>
                    </div>
                    <div class="click-icon">
                        <i class="fas fa-eye"></i>
                    </div>
                </div>
            `;
            container.appendChild(item);
        });
    } catch (error) {
        console.error('Error loading pending rent properties:', error);
    }
}

async function loadRentPaidProperties(rentPaidProperties) {
    try {
        const container = document.getElementById('rentPaidProperties');
        container.innerHTML = '';
        
        if (!rentPaidProperties || rentPaidProperties.length === 0) {
            container.innerHTML = '<div class="empty-state"><i class="fas fa-info-circle"></i><h3>No rent paid yet</h3><p>No rent payments recorded for this month</p></div>';
            return;
        }
        
        rentPaidProperties.forEach((property, index) => {
            const item = document.createElement('div');
            item.className = 'list-item rent-item paid clickable';
            item.innerHTML = `
                <div class="list-item-content" onclick="showPropertyPopup('paid', ${index})">
                    <div class="list-item-info">
                        <h4>${property.name}</h4>
                        <span class="card-status status-completed">Paid</span>
                    </div>
                    <div class="click-icon">
                        <i class="fas fa-eye"></i>
                    </div>
                </div>
            `;
            container.appendChild(item);
        });
    } catch (error) {
        console.error('Error loading rent paid properties:', error);
    }
}

async function loadVacantPropertiesList(vacantPropertiesList) {
    try {
        console.log('Loading vacant properties list:', vacantPropertiesList);
        const container = document.getElementById('vacantPropertiesList');
        if (!container) {
            console.error('vacantPropertiesList container not found');
            return;
        }
        container.innerHTML = '';
        
        if (!vacantPropertiesList || vacantPropertiesList.length === 0) {
            console.log('No vacant properties in dashboard data, trying to load from API...');
            try {
                // Try to load vacant properties directly from API
                const allProperties = await apiCall('/api/properties');
                const vacantProperties = allProperties.filter(p => p.status === 'vacant');
                
                if (vacantProperties.length === 0) {
                    console.log('No vacant properties found in API either');
                    container.innerHTML = '<div class="empty-state"><i class="fas fa-home"></i><h3>No vacant properties</h3><p>All properties are currently occupied</p></div>';
                    return;
                }
                
                console.log('Found vacant properties from API:', vacantProperties.length);
                vacantPropertiesList = vacantProperties;
            } catch (error) {
                console.error('Error loading vacant properties from API:', error);
                container.innerHTML = '<div class="empty-state"><i class="fas fa-home"></i><h3>No vacant properties</h3><p>All properties are currently occupied</p></div>';
                return;
            }
        }
        
        vacantPropertiesList.forEach((property, index) => {
            const item = document.createElement('div');
            item.className = 'list-item property-item vacant clickable';
            item.innerHTML = `
                <div class="list-item-content" onclick="showPropertyPopup('vacant', ${index})">
                    <div class="list-item-info">
                        <h4>${property.name}</h4>
                        <p>${property.address || 'No address'}</p>
                        <small>${property.type ? formatPropertyType(property.type) : 'N/A'} • ${property.rent_amount ? `${property.currency || 'USD'} ${property.rent_amount.toLocaleString()}` : 'Rent not set'}</small>
                    </div>
                    <div class="click-icon">
                        <i class="fas fa-eye"></i>
                    </div>
                </div>
            `;
            container.appendChild(item);
        });
        
        console.log('Vacant properties loaded:', vacantPropertiesList.length, 'properties');
    } catch (error) {
        console.error('Error loading vacant properties list:', error);
        const container = document.getElementById('vacantPropertiesList');
        if (container) {
            container.innerHTML = '<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><h3>Error loading properties</h3><p>Failed to load vacant properties</p></div>';
        }
    }
}

// Global variables to store property data
let dashboardData = {
    pendingRentProperties: [],
    rentPaidProperties: [],
    vacantPropertiesList: []
};

// Function to show property popup
function showPropertyPopup(type, index) {
    let property, title, content;
    
    switch(type) {
        case 'pending':
            property = dashboardData.pendingRentProperties[index];
            title = 'Pending Rent Property Details';
            content = `
                <div class="popup-content">
                    <div class="property-header">
                        <h3>${property.name}</h3>
                        <span class="card-status status-pending">Pending</span>
                    </div>
                                                <div class="property-details">
                                <div class="detail-row">
                                    <strong>Tenant:</strong> <span>${property.first_name} ${property.last_name}</span>
                                </div>
                                <div class="detail-row">
                                    <strong>Email:</strong> <span>${property.email}</span>
                                </div>
                                <div class="detail-row">
                                    <strong>Phone:</strong> <span>${property.phone || 'N/A'}</span>
                                </div>
                                <div class="detail-row">
                                    <strong>Rent Amount:</strong> <span>${property.currency} ${property.rent_amount?.toLocaleString() || 'N/A'}</span>
                                </div>
                            </div>
                    <div class="popup-actions">
                        <button onclick="showModal('rentTrackingModal')" class="btn-primary">
                            <i class="fas fa-money-bill-wave"></i> Record Payment
                        </button>
                    </div>
                </div>
            `;
            break;
            
        case 'paid':
            property = dashboardData.rentPaidProperties[index];
            title = 'Rent Paid Property Details';
            content = `
                <div class="popup-content">
                    <div class="property-header">
                        <h3>${property.name}</h3>
                        <span class="card-status status-completed">Paid</span>
                    </div>
                                                <div class="property-details">
                                <div class="detail-row">
                                    <strong>Tenant:</strong> <span>${property.first_name} ${property.last_name}</span>
                                </div>
                                <div class="detail-row">
                                    <strong>Payment Amount:</strong> <span>${property.currency} ${property.payment_amount?.toLocaleString() || 'N/A'}</span>
                                </div>
                                <div class="detail-row">
                                    <strong>Payment Method:</strong> <span>${property.payment_method}</span>
                                </div>
                                <div class="detail-row">
                                    <strong>Payment Date:</strong> <span>${formatDate(property.payment_date)}</span>
                                </div>
                            </div>
                </div>
            `;
            break;
            
        case 'vacant':
            property = dashboardData.vacantPropertiesList[index];
            title = 'Vacant Property Details';
            content = `
                <div class="popup-content">
                    <div class="property-header">
                        <h3>${property.name}</h3>
                        <span class="card-status status-vacant">Vacant</span>
                    </div>
                                                <div class="property-details">
                                <div class="detail-row">
                                    <strong>Address:</strong> <span>${property.address}</span>
                                </div>
                                <div class="detail-row">
                                    <strong>Type:</strong> <span>${property.type ? property.type.charAt(0).toUpperCase() + property.type.slice(1).replace(/([A-Z])/g, ' $1') : 'N/A'}</span>
                                </div>
                                <div class="detail-row">
                                    <strong>Rent Amount:</strong> <span>${property.currency} ${property.rent_amount?.toLocaleString() || 'N/A'}</span>
                                </div>
                                <div class="detail-row">
                                    <strong>Bedrooms:</strong> <span>${property.bedrooms || 'N/A'} | Bathrooms: ${property.bathrooms || 'N/A'}</span>
                                </div>
                            </div>
                    <div class="popup-actions">
                        <button onclick="editProperty(${property.id})" class="btn-secondary">
                            <i class="fas fa-edit"></i> Edit Property
                        </button>
                    </div>
                </div>
            `;
            break;
    }
    
    // Create and show popup
    showCustomPopup(title, content);
}

// Function to show custom popup
function showCustomPopup(title, content, isStatDetails = false) {
    // Remove existing popup if any
    const existingPopup = document.getElementById('customPopup');
    if (existingPopup) {
        existingPopup.remove();
    }
    
    // Create popup modal
    const popup = document.createElement('div');
    popup.id = 'customPopup';
    popup.className = 'modal';
    popup.style.display = 'block';
    
    const modalClass = isStatDetails ? 'popup-modal stat-details-popup' : 'popup-modal';
    
    popup.innerHTML = `
        <div class="modal-content ${modalClass}">
            <div class="modal-header">
                <h2>${title}</h2>
                <button onclick="closeCustomPopup()" class="close-btn">&times;</button>
            </div>
            <div class="modal-body">
                ${content}
            </div>
        </div>
    `;
    
    document.body.appendChild(popup);
    
    // Close popup when clicking outside
    popup.addEventListener('click', (e) => {
        if (e.target === popup) {
            closeCustomPopup();
        }
    });
}

// Function to close custom popup
function closeCustomPopup() {
    const popup = document.getElementById('customPopup');
    if (popup) {
        popup.remove();
    }
}

// Profile Tab Functions
function showProfileTab(tabName) {
    // Hide all tab contents
    const tabContents = document.querySelectorAll('.profile-tab-content');
    tabContents.forEach(content => content.classList.remove('active'));
    
    // Remove active class from all tabs
    const tabs = document.querySelectorAll('.profile-tab');
    tabs.forEach(tab => tab.classList.remove('active'));
    
    // Show selected tab content
    const selectedContent = document.getElementById(tabName + 'Tab');
    if (selectedContent) {
        selectedContent.classList.add('active');
    }
    
    // Add active class to selected tab
    const selectedTab = document.querySelector(`[onclick="showProfileTab('${tabName}')"]`);
    if (selectedTab) {
        selectedTab.classList.add('active');
    }
    
    // Load data for bulk upload tab
    if (tabName === 'bulkUpload') {
        loadAvailableProperties();
    }
}

async function loadAvailableProperties() {
    try {
        const properties = await apiCall('/api/properties');
        const container = document.getElementById('availablePropertiesList');
        
        if (properties.length === 0) {
            container.innerHTML = '<p style="padding: 1rem; color: #666; text-align: center;">No properties available. Please add properties first.</p>';
            return;
        }
        
        container.innerHTML = '';
        properties.forEach(property => {
            const item = document.createElement('div');
            item.className = 'property-item';
            item.innerHTML = `
                <div class="property-info">
                    <div class="property-name">${property.name}</div>
                    <div class="property-details">${property.address} • ${property.type || 'N/A'}</div>
                </div>
                <div class="property-id">Use: "${property.name}"</div>
            `;
            container.appendChild(item);
        });
    } catch (error) {
        console.error('Error loading available properties:', error);
        const container = document.getElementById('availablePropertiesList');
        container.innerHTML = '<p style="padding: 1rem; color: #dc3545; text-align: center;">Error loading properties. Please try again.</p>';
    }
}

// Bulk Upload Functions
function handlePropertiesFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const statusDiv = document.getElementById('propertiesUploadStatus');
    const progressFill = statusDiv.querySelector('.progress-fill');
    const progressText = statusDiv.querySelector('.progress-text');
    const messageDiv = statusDiv.querySelector('.upload-message');
    
    statusDiv.style.display = 'block';
    messageDiv.textContent = 'Processing file...';
    messageDiv.className = 'upload-message';
    
    // Validate file type
    if (!file.name.match(/\.(xlsx|xls)$/)) {
        messageDiv.textContent = 'Error: Please select a valid Excel file (.xlsx or .xls)';
        messageDiv.className = 'upload-message error';
        return;
    }
    
    // Validate file size (5MB limit)
    if (file.size > 5 * 1024 * 1024) {
        messageDiv.textContent = 'Error: File size must be less than 5MB';
        messageDiv.className = 'upload-message error';
        return;
    }
    
    const formData = new FormData();
    formData.append('file', file);
    
    // Simulate upload progress
    let progress = 0;
    const progressInterval = setInterval(() => {
        progress += 10;
        progressFill.style.width = progress + '%';
        progressText.textContent = progress + '%';
        
        if (progress >= 100) {
            clearInterval(progressInterval);
            uploadPropertiesFile(formData, messageDiv);
        }
    }, 200);
}

function handleTenantsFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const statusDiv = document.getElementById('tenantsUploadStatus');
    const progressFill = statusDiv.querySelector('.progress-fill');
    const progressText = statusDiv.querySelector('.progress-text');
    const messageDiv = statusDiv.querySelector('.upload-message');
    
    statusDiv.style.display = 'block';
    messageDiv.textContent = 'Processing file...';
    messageDiv.className = 'upload-message';
    
    // Validate file type
    if (!file.name.match(/\.(xlsx|xls)$/)) {
        messageDiv.textContent = 'Error: Please select a valid Excel file (.xlsx or .xls)';
        messageDiv.className = 'upload-message error';
        return;
    }
    
    // Validate file size (5MB limit)
    if (file.size > 5 * 1024 * 1024) {
        messageDiv.textContent = 'Error: File size must be less than 5MB';
        messageDiv.className = 'upload-message error';
        return;
    }
    
    const formData = new FormData();
    formData.append('file', file);
    
    // Simulate upload progress
    let progress = 0;
    const progressInterval = setInterval(() => {
        progress += 10;
        progressFill.style.width = progress + '%';
        progressText.textContent = progress + '%';
        
        if (progress >= 100) {
            clearInterval(progressInterval);
            uploadTenantsFile(formData, messageDiv);
        }
    }, 200);
}

async function uploadPropertiesFile(formData, messageDiv) {
    try {
        const token = localStorage.getItem('authToken');
        if (!token) {
            messageDiv.textContent = 'Error: Not authenticated. Please log in again.';
            messageDiv.className = 'upload-message error';
            return;
        }

        const response = await fetch('/api/bulk-upload/properties', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            },
            body: formData
        });
        
        // Check if response is JSON
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            const text = await response.text();
            console.error('Non-JSON response:', text);
            messageDiv.textContent = 'Error: Server returned invalid response. Please try again.';
            messageDiv.className = 'upload-message error';
            return;
        }
        
        const result = await response.json();
        
        if (response.ok) {
            messageDiv.textContent = `Success: ${result.message}`;
            messageDiv.className = 'upload-message success';
            // Refresh properties list and dashboard
            loadProperties();
            loadDashboard();
        } else {
            messageDiv.textContent = `Error: ${result.error}`;
            messageDiv.className = 'upload-message error';
        }
    } catch (error) {
        console.error('Upload error:', error);
        messageDiv.textContent = `Error: ${error.message}`;
        messageDiv.className = 'upload-message error';
    }
}

async function uploadTenantsFile(formData, messageDiv) {
    try {
        const token = localStorage.getItem('authToken');
        if (!token) {
            messageDiv.textContent = 'Error: Not authenticated. Please log in again.';
            messageDiv.className = 'upload-message error';
            return;
        }

        const response = await fetch('/api/bulk-upload/tenants', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            },
            body: formData
        });
        
        // Check if response is JSON
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            const text = await response.text();
            console.error('Non-JSON response:', text);
            messageDiv.textContent = 'Error: Server returned invalid response. Please try again.';
            messageDiv.className = 'upload-message error';
            return;
        }
        
        const result = await response.json();
        console.log('Tenant upload response:', result);
        
        if (response.ok) {
            messageDiv.textContent = `Success: ${result.message}`;
            messageDiv.className = 'upload-message success';
            // Refresh tenants list and dashboard
            loadTenants();
            loadDashboard();
            // Also refresh available properties list
            loadAvailableProperties();
        } else {
            let errorMessage = result.error;
            if (result.errors && result.errors.length > 0) {
                errorMessage += '\n\nDetails:\n' + result.errors.slice(0, 5).join('\n');
                if (result.errors.length > 5) {
                    errorMessage += `\n... and ${result.errors.length - 5} more errors`;
                }
            }
            messageDiv.textContent = `Error: ${errorMessage}`;
            messageDiv.className = 'upload-message error';
        }
    } catch (error) {
        console.error('Upload error:', error);
        messageDiv.textContent = `Error: ${error.message}`;
        messageDiv.className = 'upload-message error';
    }
}

function downloadPropertiesTemplate() {
    const template = [
        ['Name', 'Address', 'Type', 'Status', 'Bedrooms', 'Bathrooms', 'Electricity Number', 'Water Number', 'Square Feet', 'Rent Amount', 'Currency'],
        ['Sunset Apartments', '123 Main St', 'apartment', 'vacant', '2', '1', 'EL123456', 'WT789012', '1200', '1500', 'USD'],
        ['Downtown Condo', '456 Oak Ave', 'condo', 'vacant', '3', '2', 'EL234567', 'WT890123', '1500', '2000', 'USD'],
        ['Suburban Villa', '789 Pine Rd', 'villa', 'vacant', '4', '3', 'EL345678', 'WT901234', '2000', '2500', 'USD'],
        ['Studio Unit', '321 Beach Rd', 'studio', 'vacant', '0', '1', 'EL456789', 'WT012345', '500', '800', 'USD'],
        ['2 BHK Flat', '654 Park St', '2bhk', 'vacant', '2', '2', 'EL567890', 'WT123456', '1000', '1200', 'USD']
    ];
    
    downloadCSV(template, 'properties_template.csv');
}

async function downloadTenantsTemplate() {
    try {
        // Get available properties to show correct names
        const properties = await apiCall('/api/properties');
        
        const template = [
            ['First Name', 'Last Name', 'Email', 'Phone', 'Property Name', 'Rent Amount', 'Currency', 'Lease Start Date', 'Lease End Date']
        ];
        
        // Add sample rows with actual property names if available
        if (properties.length > 0) {
            template.push([
                'John', 'Doe', 'john.doe@email.com', '+1234567890', 
                properties[0].name, '1500', 'USD', '2024-01-01', '2024-12-31'
            ]);
            
            if (properties.length > 1) {
                template.push([
                    'Jane', '', 'jane.smith@email.com', '+1234567891', 
                    properties[1].name, '2000', 'USD', '2024-02-01', '2025-01-31'
                ]);
            }
            
            if (properties.length > 2) {
                template.push([
                    'Mike', 'Johnson', 'mike.johnson@email.com', '+1234567892', 
                    properties[2].name, '2500', 'USD', '2024-03-01', '2025-02-28'
                ]);
            }
        } else {
            // Fallback if no properties exist
            template.push([
                'John', '', 'john.doe@email.com', '+1234567890', 'Sample Property', '1500', 'USD', '2024-01-01', '2024-12-31'
            ]);
        }
        
        downloadCSV(template, 'tenants_template.csv');
    } catch (error) {
        console.error('Error downloading tenants template:', error);
        // Fallback template
        const template = [
            ['First Name', 'Last Name', 'Email', 'Phone', 'Property Name', 'Rent Amount', 'Currency', 'Lease Start Date', 'Lease End Date'],
            ['John', '', 'john.doe@email.com', '+1234567890', 'Sample Property', '1500', 'USD', '2024-01-01', '2024-12-31']
        ];
        downloadCSV(template, 'tenants_template.csv');
    }
}

function downloadCSV(data, filename) {
    const csvContent = data.map(row => row.join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
}

// Combined Upload Functions
function handleCombinedFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const statusDiv = document.getElementById('combinedUploadStatus');
    const messageDiv = statusDiv.querySelector('.upload-message');
    const progressBar = statusDiv.querySelector('.progress-fill');
    const progressText = statusDiv.querySelector('.progress-text');

    // Validate file type
    if (!file.name.match(/\.(xlsx|xls)$/)) {
        messageDiv.textContent = 'Error: Please select a valid Excel file (.xlsx or .xls)';
        messageDiv.className = 'upload-message error';
        statusDiv.style.display = 'block';
        return;
    }

    // Validate file size (5MB limit)
    if (file.size > 5 * 1024 * 1024) {
        messageDiv.textContent = 'Error: File size must be less than 5MB';
        messageDiv.className = 'upload-message error';
        statusDiv.style.display = 'block';
        return;
    }

    // Show upload status
    statusDiv.style.display = 'block';
    messageDiv.textContent = 'Uploading combined file...';
    messageDiv.className = 'upload-message info';

    // Simulate progress
    let progress = 0;
    const progressInterval = setInterval(() => {
        progress += 10;
        progressBar.style.width = `${progress}%`;
        progressText.textContent = `${progress}%`;
        if (progress >= 90) {
            clearInterval(progressInterval);
        }
    }, 100);

    // Create FormData
    const formData = new FormData();
    formData.append('file', file);

    // Upload file
    uploadCombinedFile(formData, messageDiv, progressBar, progressText, progressInterval);
}

async function uploadCombinedFile(formData, messageDiv, progressBar, progressText, progressInterval) {
    try {
        const token = localStorage.getItem('authToken');
        if (!token) {
            messageDiv.textContent = 'Error: Not authenticated. Please log in again.';
            messageDiv.className = 'upload-message error';
            return;
        }

        const response = await fetch('/api/bulk-upload/combined', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            },
            body: formData
        });
        
        // Clear progress interval
        clearInterval(progressInterval);
        progressBar.style.width = '100%';
        progressText.textContent = '100%';
        
        // Check if response is JSON
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            const text = await response.text();
            console.error('Non-JSON response:', text);
            messageDiv.textContent = 'Error: Server returned invalid response. Please try again.';
            messageDiv.className = 'upload-message error';
            return;
        }
        
        const result = await response.json();
        console.log('Combined upload response:', result);
        
        if (response.ok) {
            let successMessage = `Success: ${result.message}`;
            
            // Add detailed results if available
            if (result.results) {
                if (result.results.properties.successCount > 0) {
                    successMessage += `\nProperties: ${result.results.properties.successCount} imported`;
                }
                if (result.results.tenants.successCount > 0) {
                    successMessage += `\nTenants: ${result.results.tenants.successCount} imported`;
                }
                if (result.totalErrors > 0) {
                    successMessage += `\nErrors: ${result.totalErrors} occurred`;
                }
            }
            
            // Show detailed summary if available
            if (result.summary) {
                successMessage += '\n\n📋 Imported Details:';
                
                if (result.summary.properties && result.summary.properties.length > 0) {
                    successMessage += '\n\n🏠 Properties:';
                    result.summary.properties.forEach((prop, index) => {
                        successMessage += `\n${index + 1}. ${prop.name} - ${prop.address} (${prop.type})`;
                        if (prop.rentAmount) {
                            successMessage += ` - ${prop.currency} ${prop.rentAmount}`;
                        }
                    });
                }
                
                if (result.summary.tenants && result.summary.tenants.length > 0) {
                    successMessage += '\n\n👥 Tenants:';
                    result.summary.tenants.forEach((tenant, index) => {
                        successMessage += `\n${index + 1}. ${tenant.name} (${tenant.email})`;
                        successMessage += ` - ${tenant.propertyName}`;
                        if (tenant.rentAmount) {
                            successMessage += ` - ${tenant.currency} ${tenant.rentAmount}`;
                        }
                    });
                }
            }
            
            messageDiv.textContent = successMessage;
            messageDiv.className = 'upload-message success';
            
            // Refresh all data
            loadProperties();
            loadTenants();
            loadDashboard();
            loadAvailableProperties();
        } else {
            let errorMessage = result.error;
            if (result.results) {
                const allErrors = [];
                if (result.results.properties.errors && result.results.properties.errors.length > 0) {
                    allErrors.push('Properties errors: ' + result.results.properties.errors.slice(0, 3).join(', '));
                }
                if (result.results.tenants.errors && result.results.tenants.errors.length > 0) {
                    allErrors.push('Tenants errors: ' + result.results.tenants.errors.slice(0, 3).join(', '));
                }
                if (allErrors.length > 0) {
                    errorMessage += '\n\nDetails:\n' + allErrors.join('\n');
                }
            }
            messageDiv.textContent = `Error: ${errorMessage}`;
            messageDiv.className = 'upload-message error';
        }
    } catch (error) {
        clearInterval(progressInterval);
        console.error('Upload error:', error);
        messageDiv.textContent = `Error: ${error.message}`;
        messageDiv.className = 'upload-message error';
    }
}

async function downloadCombinedTemplate() {
    try {
        // Create a single sheet with both property and tenant columns
        const combinedData = [
            [
                'Property Name', 'Property Address', 'Property Type', 'Property Status', 'Bedrooms', 'Bathrooms', 
                'Electricity Number', 'Water Number', 'Square Feet', 'Property Rent Amount', 'Property Currency',
                'Tenant First Name', 'Tenant Last Name', 'Tenant Email', 'Tenant Phone', 
                'Tenant Rent Amount', 'Lease Start Date', 'Lease End Date'
            ],
            [
                'Sunset Apartments', '123 Main St', 'apartment', 'vacant', '2', '1', 
                'EL123456', 'WT789012', '1200', '1500', 'USD',
                'John', 'Doe', 'john.doe@email.com', '+1234567890', 
                '1500', '2024-01-01', '2024-12-31'
            ],
            [
                'Downtown Condo', '456 Oak Ave', 'condo', 'vacant', '3', '2', 
                'EL234567', 'WT890123', '1500', '2000', 'USD',
                'Jane', 'Smith', 'jane.smith@email.com', '+1234567891', 
                '2000', '2024-02-01', '2025-01-31'
            ],
            [
                'Suburban Villa', '789 Pine Rd', 'villa', 'vacant', '4', '3', 
                'EL345678', 'WT901234', '2000', '2500', 'USD',
                'Mike', 'Johnson', 'mike.johnson@email.com', '+1234567892', 
                '2500', '2024-03-01', '2025-02-28'
            ],
            [
                'Studio Unit', '321 Beach Rd', 'studio', 'vacant', '0', '1', 
                'EL456789', 'WT012345', '500', '800', 'USD',
                '', '', '', '', 
                '', '', ''
            ]
        ];
        
        // Create a workbook with single sheet
        const workbook = {
            SheetNames: ['Properties & Tenants'],
            Sheets: {}
        };
        
        // Convert data to worksheet format
        const worksheet = {};
        combinedData.forEach((row, rowIndex) => {
            row.forEach((cell, colIndex) => {
                const cellRef = String.fromCharCode(65 + colIndex) + (rowIndex + 1);
                worksheet[cellRef] = { v: cell };
            });
        });
        worksheet['!ref'] = 'A1:' + String.fromCharCode(65 + combinedData[0].length - 1) + combinedData.length;
        
        workbook.Sheets['Properties & Tenants'] = worksheet;
        
        // Download as Excel file
        const wbout = XLSX.write(workbook, { bookType: 'xlsx', type: 'binary' });
        
        function s2ab(s) {
            const buf = new ArrayBuffer(s.length);
            const view = new Uint8Array(buf);
            for (let i = 0; i < s.length; i++) view[i] = s.charCodeAt(i) & 0xFF;
            return buf;
        }
        
        const blob = new Blob([s2ab(wbout)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'properties_tenants_template.xlsx';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        
    } catch (error) {
        console.error('Error downloading combined template:', error);
        // Fallback to CSV format
        const combinedTemplate = [
            [
                'Property Name', 'Property Address', 'Property Type', 'Property Status', 'Bedrooms', 'Bathrooms', 
                'Electricity Number', 'Water Number', 'Square Feet', 'Property Rent Amount', 'Property Currency',
                'Tenant First Name', 'Tenant Last Name', 'Tenant Email', 'Tenant Phone', 
                'Tenant Rent Amount', 'Lease Start Date', 'Lease End Date'
            ],
            [
                'Sunset Apartments', '123 Main St', 'apartment', 'vacant', '2', '1', 
                'EL123456', 'WT789012', '1200', '1500', 'USD',
                'John', 'Doe', 'john.doe@email.com', '+1234567890', 
                '1500', '2024-01-01', '2024-12-31'
            ]
        ];
        downloadCSV(combinedTemplate, 'properties_tenants_template.csv');
    }
}

async function loadRecentMaintenance() {
    try {
        const container = document.getElementById('recentMaintenance');
        if (!container) {
            console.error('recentMaintenance container not found');
            return;
        }
        
        const maintenance = await apiCall('/api/maintenance');
        const recentMaintenance = maintenance.slice(0, 5);
        
        container.innerHTML = '';
        
        if (recentMaintenance.length === 0) {
            container.innerHTML = '<div class="empty-state"><i class="fas fa-tools"></i><h3>No maintenance requests</h3><p>No recent maintenance requests found</p></div>';
            return;
        }
        
        recentMaintenance.forEach(request => {
            const item = document.createElement('div');
            item.className = 'list-item';
            item.innerHTML = `
                <div class="list-item-info">
                    <h4>${request.title}</h4>
                    <p>${request.property_name || 'No property'}</p>
                </div>
                <span class="card-status status-${request.status}">${request.status}</span>
            `;
            container.appendChild(item);
        });
        
        console.log('Recent maintenance loaded:', recentMaintenance.length, 'items');
    } catch (error) {
        console.error('Error loading recent maintenance:', error);
        const container = document.getElementById('recentMaintenance');
        if (container) {
            container.innerHTML = '<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><h3>Error loading maintenance</h3><p>Failed to load maintenance requests</p></div>';
        }
    }
}

// Properties functions
async function loadProperties() {
    try {
        const properties = await apiCall('/api/properties');
        displayProperties(properties);
    } catch (error) {
        console.error('Error loading properties:', error);
    }
}

// Function to toggle property view between card and list
function togglePropertyView(view) {
    currentPropertyView = view;
    
    // Update button states
    document.getElementById('propertyCardViewBtn').classList.toggle('active', view === 'card');
    document.getElementById('propertyListViewBtn').classList.toggle('active', view === 'list');
    
    // Show/hide containers
    const cardContainer = document.getElementById('propertiesList');
    const tableContainer = document.getElementById('propertiesTable');
    
    if (view === 'card') {
        cardContainer.style.display = 'grid';
        tableContainer.style.display = 'none';
    } else {
        cardContainer.style.display = 'none';
        tableContainer.style.display = 'block';
    }
    
    // Reload properties to display in the correct view
    loadProperties();
}

function displayProperties(properties) {
    if (properties.length === 0) {
        if (currentPropertyView === 'card') {
            const container = document.getElementById('propertiesList');
            container.innerHTML = '<div class="empty-state"><i class="fas fa-home"></i><h3>No properties found</h3></div>';
        } else {
            const tableBody = document.getElementById('propertiesTableBody');
            tableBody.innerHTML = '<tr><td colspan="9" class="empty-state"><i class="fas fa-home"></i><h3>No properties found</h3></td></tr>';
        }
        return;
    }
    
    // Sort properties by name alphabetically
    const sortedProperties = properties.sort((a, b) => {
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    });
    
    if (currentPropertyView === 'card') {
        displayPropertiesCardView(sortedProperties);
    } else {
        displayPropertiesListView(sortedProperties);
    }
}

function displayPropertiesCardView(properties) {
    const container = document.getElementById('propertiesList');
    container.innerHTML = '';
    
    properties.forEach(property => {
        const card = document.createElement('div');
        card.className = 'card';
        card.innerHTML = `
            <div class="card-header">
                <div class="card-title">${property.name}</div>
                <span class="card-status status-${property.status}">${formatPropertyStatus(property.status)}</span>
            </div>
            <div class="card-details">
                <div class="card-detail">
                    <span>Address:</span>
                    <span>${property.address}</span>
                </div>
                <div class="card-detail">
                    <span>Type:</span>
                    <span>${property.type ? formatPropertyType(property.type) : 'N/A'}</span>
                </div>
                <div class="card-detail">
                    <span>Bedrooms:</span>
                    <span>${property.bedrooms || 'N/A'}</span>
                </div>
                <div class="card-detail">
                    <span>Bathrooms:</span>
                    <span>${property.bathrooms || 'N/A'}</span>
                </div>
                <div class="card-detail">
                    <span>Square Feet:</span>
                    <span>${property.square_feet || 'N/A'}</span>
                </div>
                <div class="card-detail">
                    <span>Rent:</span>
                    <span>${property.rent_amount ? `${property.currency || 'USD'} ${property.rent_amount.toLocaleString()}` : 'N/A'}</span>
                </div>
                ${property.electricity_number ? `<div class="card-detail">
                    <span>Electricity:</span>
                    <span>${property.electricity_number}</span>
                </div>` : ''}
                ${property.water_number ? `<div class="card-detail">
                    <span>Water:</span>
                    <span>${property.water_number}</span>
                </div>` : ''}
            </div>
            <div class="card-actions">
                <button onclick="editProperty(${property.id})" class="btn-edit">Edit</button>
                <button onclick="deleteProperty(${property.id})" class="btn-delete">Delete</button>
            </div>
        `;
        container.appendChild(card);
    });
}

function displayPropertiesListView(properties) {
    const tableBody = document.getElementById('propertiesTableBody');
    tableBody.innerHTML = '';
    
    properties.forEach(property => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>
                <div class="property-name">${property.name}</div>
            </td>
            <td>
                <span class="property-address">${property.address}</span>
            </td>
            <td>
                <span class="property-type">${property.type ? formatPropertyType(property.type) : 'N/A'}</span>
            </td>
            <td>
                <span class="property-status status-${property.status}">${formatPropertyStatus(property.status)}</span>
            </td>
            <td>
                <span class="property-bedrooms">${property.bedrooms || 'N/A'}</span>
            </td>
            <td>
                <span class="property-bathrooms">${property.bathrooms || 'N/A'}</span>
            </td>
            <td>
                <span class="property-square-feet">${property.square_feet || 'N/A'}</span>
            </td>
            <td>
                <span class="property-rent">${property.rent_amount ? `${property.currency || 'USD'} ${property.rent_amount.toLocaleString()}` : 'N/A'}</span>
            </td>
            <td>
                <div class="property-actions">
                    <button onclick="editProperty(${property.id})" class="btn-edit">
                        <i class="fas fa-edit"></i>
                        Edit
                    </button>
                    <button onclick="deleteProperty(${property.id})" class="btn-delete">
                        <i class="fas fa-trash"></i>
                        Delete
                    </button>
                </div>
            </td>
        `;
        tableBody.appendChild(row);
    });
}

// Property form handlers
document.getElementById('propertyForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    // Handle custom property type
    let propertyType = document.getElementById('propertyType').value;
    if (propertyType === 'other') {
        const customType = document.getElementById('customPropertyType').value.trim();
        if (!customType) {
            showMessage('Please enter a custom property type.', 'error');
            return;
        }
        propertyType = customType;
    }
    
    const formData = {
        name: document.getElementById('propertyName').value,
        address: document.getElementById('propertyAddress').value,
        type: propertyType,
        status: document.getElementById('propertyStatus').value,
        bedrooms: parseInt(document.getElementById('propertyBedrooms').value) || null,
        bathrooms: parseFloat(document.getElementById('propertyBathrooms').value) || null,
        square_feet: parseFloat(document.getElementById('propertySquareFeet').value) || null,
        rent_amount: parseFloat(document.getElementById('propertyRent').value) || null,
        currency: document.getElementById('propertyCurrency').value,
        electricity_number: document.getElementById('propertyElectricityNumber').value || null,
        water_number: document.getElementById('propertyWaterNumber').value || null
    };
    
    const editId = e.target.dataset.editId;
    
    try {
        if (editId) {
            // Update existing property
            await apiCall(`/api/properties/${editId}`, {
                method: 'PUT',
                body: JSON.stringify(formData)
            });
            
            // If property status changed to vacant, update associated tenants
            if (formData.status === 'vacant') {
                await updateTenantsForVacantProperty(editId);
            }
            
            showMessage('Property updated successfully!');
        } else {
            // Create new property
            await apiCall('/api/properties', {
                method: 'POST',
                body: JSON.stringify(formData)
            });
            showMessage('Property added successfully!');
        }
        
        closeModal('propertyModal');
        loadProperties();
    } catch (error) {
        showMessage(editId ? 'Failed to update property.' : 'Failed to add property.', 'error');
    }
});

// Function to update tenants when property becomes vacant
async function updateTenantsForVacantProperty(propertyId) {
    try {
        await apiCall(`/api/properties/${propertyId}/update-tenants-vacant`, {
            method: 'POST'
        });
        console.log('Tenants updated for vacant property');
    } catch (error) {
        console.error('Error updating tenants for vacant property:', error);
    }
}

async function editProperty(id) {
    try {
        const property = await apiCall(`/api/properties/${id}`);
        
        // Populate the form with existing data
        document.getElementById('propertyName').value = property.name;
        document.getElementById('propertyAddress').value = property.address;
        
        // Handle property type - check if it's a custom type
        const standardTypes = ['villa', '1bhk', '2bhk', '3bhk', '4bhk', 'studio', 'apartment', 'house', 'condo', 'townhouse', 'shop', 'mall'];
        if (standardTypes.includes(property.type.toLowerCase())) {
            document.getElementById('propertyType').value = property.type;
            document.getElementById('customPropertyTypeRow').style.display = 'none';
            document.getElementById('customPropertyType').required = false;
        } else {
            document.getElementById('propertyType').value = 'other';
            document.getElementById('customPropertyType').value = property.type;
            document.getElementById('customPropertyTypeRow').style.display = 'flex';
            document.getElementById('customPropertyType').required = true;
        }
        
        document.getElementById('propertyStatus').value = property.status;
        document.getElementById('propertyBedrooms').value = property.bedrooms || '';
        document.getElementById('propertyBathrooms').value = property.bathrooms || '';
        document.getElementById('propertySquareFeet').value = property.square_feet || '';
        document.getElementById('propertyRent').value = property.rent_amount || '';
        document.getElementById('propertyCurrency').value = property.currency || 'USD';
        document.getElementById('propertyElectricityNumber').value = property.electricity_number || '';
        document.getElementById('propertyWaterNumber').value = property.water_number || '';
        
        // Update modal title
        document.getElementById('propertyModalTitle').textContent = 'Edit Property';
        
        // Store the property ID for update
        document.getElementById('propertyForm').dataset.editId = id;
        
        // Show the modal
        showModal('propertyModal');
    } catch (error) {
        showMessage('Failed to load property details.', 'error');
    }
}

async function deleteProperty(id) {
    if (!confirm('Are you sure you want to delete this property?')) return;
    
    try {
        await apiCall(`/api/properties/${id}`, { method: 'DELETE' });
        loadProperties();
        showMessage('Property deleted successfully!');
    } catch (error) {
        showMessage('Failed to delete property.', 'error');
    }
}

async function createSampleData() {
    try {
        await apiCall('/api/sample-data', { method: 'POST' });
        loadProperties();
        showMessage('Sample properties created successfully!');
    } catch (error) {
        showMessage('Failed to create sample data.', 'error');
    }
}

async function createSampleVacantProperties() {
    try {
        const sampleVacantProperties = [
            {
                name: 'Riverside Apartments',
                address: '789 River Rd, City, State 12345',
                type: 'apartment',
                rent_amount: 1500,
                bedrooms: 2,
                bathrooms: 2,
                status: 'vacant',
                currency: 'USD'
            },
            {
                name: 'Mountain View House',
                address: '321 Hill St, City, State 12345',
                type: 'house',
                rent_amount: 2200,
                bedrooms: 4,
                bathrooms: 3,
                status: 'vacant',
                currency: 'USD'
            },
            {
                name: 'Downtown Studio',
                address: '555 Center Ave, City, State 12345',
                type: 'apartment',
                rent_amount: 900,
                bedrooms: 1,
                bathrooms: 1,
                status: 'vacant',
                currency: 'USD'
            }
        ];

        for (const property of sampleVacantProperties) {
            await apiCall('/api/properties', {
                method: 'POST',
                body: JSON.stringify(property)
            });
        }

        showMessage('Sample vacant properties created successfully!');
        
        // Reload the dashboard to show the new vacant properties
        loadDashboard();
        
    } catch (error) {
        console.error('Error creating sample vacant properties:', error);
        showMessage('Failed to create sample vacant properties.', 'error');
    }
}

async function createSampleRentData() {
    try {
        // First create some occupied properties
        const sampleProperties = [
            {
                name: 'Sunset Apartments',
                address: '123 Main St, City, State 12345',
                type: 'apartment',
                rent_amount: 1200,
                bedrooms: 2,
                bathrooms: 1,
                status: 'occupied',
                currency: 'USD'
            },
            {
                name: 'Downtown Condo',
                address: '456 Oak Ave, City, State 12345',
                type: 'condo',
                rent_amount: 1800,
                bedrooms: 3,
                bathrooms: 2,
                status: 'occupied',
                currency: 'USD'
            },
            {
                name: 'Garden Villa',
                address: '789 Park Blvd, City, State 12345',
                type: 'house',
                rent_amount: 2500,
                bedrooms: 4,
                bathrooms: 3,
                status: 'occupied',
                currency: 'USD'
            }
        ];

        // Create properties
        for (const property of sampleProperties) {
            await apiCall('/api/properties', {
                method: 'POST',
                body: JSON.stringify(property)
            });
        }

        // Get the created properties to get their IDs
        const properties = await apiCall('/api/properties');
        const occupiedProperties = properties.filter(p => p.status === 'occupied');

        // Create tenants for these properties
        const sampleTenants = [
            {
                first_name: 'John',
                last_name: 'Doe',
                email: 'john.doe@email.com',
                phone: '555-0101',
                nationality: 'US',
                property_id: occupiedProperties[0].id,
                rent_amount: 1200,
                currency: 'USD',
                status: 'active'
            },
            {
                first_name: 'Jane',
                last_name: 'Smith',
                email: 'jane.smith@email.com',
                phone: '555-0102',
                nationality: 'US',
                property_id: occupiedProperties[1].id,
                rent_amount: 1800,
                currency: 'USD',
                status: 'active'
            },
            {
                first_name: 'Mike',
                last_name: 'Johnson',
                email: 'mike.johnson@email.com',
                phone: '555-0103',
                nationality: 'US',
                property_id: occupiedProperties[2].id,
                rent_amount: 2500,
                currency: 'USD',
                status: 'active'
            }
        ];

        // Create tenants
        for (const tenant of sampleTenants) {
            await apiCall('/api/tenants', {
                method: 'POST',
                body: JSON.stringify(tenant)
            });
        }

        // Create some rent tracking records (some paid, some pending)
        const rentRecords = [
            {
                tenant_id: 1,
                property_id: occupiedProperties[0].id,
                rent_amount: 1200,
                payment_amount: 1200,
                payment_method: 'bank_transfer',
                payment_date: new Date().toISOString().split('T')[0],
                status: 'paid',
                currency: 'USD'
            },
            {
                tenant_id: 2,
                property_id: occupiedProperties[1].id,
                rent_amount: 1800,
                payment_amount: 0,
                payment_method: 'pending',
                payment_date: null,
                status: 'pending',
                currency: 'USD'
            },
            {
                tenant_id: 3,
                property_id: occupiedProperties[2].id,
                rent_amount: 2500,
                payment_amount: 2500,
                payment_method: 'credit_card',
                payment_date: new Date().toISOString().split('T')[0],
                status: 'paid',
                currency: 'USD'
            }
        ];

        // Create rent tracking records
        for (const record of rentRecords) {
            await apiCall('/api/rent-tracking', {
                method: 'POST',
                body: JSON.stringify(record)
            });
        }

        showMessage('Sample rent data created successfully!');
        
        // Reload the dashboard to show the new data
        loadDashboard();
        
    } catch (error) {
        console.error('Error creating sample rent data:', error);
        showMessage('Failed to create sample rent data.', 'error');
    }
}

async function showQuickEditPanel() {
    showModal('quickEditModal');
    await loadPropertiesForQuickEdit();
}

async function loadPropertiesForQuickEdit() {
    try {
        const properties = await apiCall('/api/properties');
        const propertyList = document.getElementById('quickEditPropertyList');
        const propertySelect = document.getElementById('quickEditPropertySelect');
        
        // Clear existing content
        propertyList.innerHTML = '';
        propertySelect.innerHTML = '<option value="">Choose a property...</option>';
        
        if (properties.length === 0) {
            propertyList.innerHTML = '<p style="text-align: center; color: #6c757d; padding: 1rem;">No properties found</p>';
            return;
        }
        
        // Populate dropdown and list
        properties.forEach(property => {
            // Add to dropdown
            const option = document.createElement('option');
            option.value = property.id;
            option.textContent = property.name;
            propertySelect.appendChild(option);
            
            // Add to list
            const listItem = document.createElement('div');
            listItem.className = 'property-list-item';
            listItem.onclick = () => selectPropertyForQuickEdit(property);
            listItem.innerHTML = `
                <h4>${property.name}</h4>
                <p>${property.address}</p>
                <p><strong>Status:</strong> ${property.status || 'Available'}</p>
            `;
            propertyList.appendChild(listItem);
        });
    } catch (error) {
        console.error('Error loading properties for quick edit:', error);
        showMessage('Failed to load properties', 'error');
    }
}

function selectPropertyForQuickEdit(property) {
    // Update active state in list
    document.querySelectorAll('.property-list-item').forEach(item => {
        item.classList.remove('active');
    });
    event.target.closest('.property-list-item').classList.add('active');
    
    // Update dropdown
    document.getElementById('quickEditPropertySelect').value = property.id;
    
    // Load property details for editing
    loadPropertyForQuickEdit(property);
}

async function loadPropertyForQuickEdit(property = null) {
    const propertyId = property ? property.id : document.getElementById('quickEditPropertySelect').value;
    
    if (!propertyId) {
        document.getElementById('quickEditContent').innerHTML = `
            <div class="quick-edit-placeholder">
                <i class="fas fa-home"></i>
                <h3>Select a Property</h3>
                <p>Choose a property from the list to edit or delete</p>
            </div>
        `;
        return;
    }
    
    try {
        if (!property) {
            property = await apiCall(`/api/properties/${propertyId}`);
        }
        
        const content = document.getElementById('quickEditContent');
        content.innerHTML = `
            <form id="quickEditForm" class="quick-edit-form">
                <div class="form-row">
                    <div class="form-group">
                        <label for="quickEditName">Property Name</label>
                        <input type="text" id="quickEditName" value="${property.name}" required>
                    </div>
                    <div class="form-group">
                        <label for="quickEditType">Type</label>
                        <select id="quickEditType" required>
                            <option value="apartment" ${property.type === 'apartment' ? 'selected' : ''}>Apartment</option>
                            <option value="house" ${property.type === 'house' ? 'selected' : ''}>House</option>
                            <option value="condo" ${property.type === 'condo' ? 'selected' : ''}>Condo</option>
                            <option value="townhouse" ${property.type === 'townhouse' ? 'selected' : ''}>Townhouse</option>
                            <option value="commercial" ${property.type === 'commercial' ? 'selected' : ''}>Commercial</option>
                        </select>
                    </div>
                </div>
                
                <div class="form-group">
                    <label for="quickEditAddress">Address</label>
                    <input type="text" id="quickEditAddress" value="${property.address}" required>
                </div>
                
                <div class="form-row">
                    <div class="form-group">
                        <label for="quickEditBedrooms">Bedrooms</label>
                        <input type="number" id="quickEditBedrooms" value="${property.bedrooms || ''}" min="0">
                    </div>
                    <div class="form-group">
                        <label for="quickEditBathrooms">Bathrooms</label>
                        <input type="number" id="quickEditBathrooms" value="${property.bathrooms || ''}" min="0" step="0.5">
                    </div>
                    <div class="form-group">
                        <label for="quickEditSquareFeet">Square Feet</label>
                        <input type="number" id="quickEditSquareFeet" value="${property.square_feet || ''}" min="0">
                    </div>
                </div>
                
                <div class="form-row">
                    <div class="form-group">
                        <label for="quickEditRentAmount">Rent Amount</label>
                        <input type="number" id="quickEditRentAmount" value="${property.rent_amount || ''}" min="0" step="0.01">
                    </div>
                    <div class="form-group">
                        <label for="quickEditCurrency">Currency</label>
                        <select id="quickEditCurrency">
                            <option value="USD" ${property.currency === 'USD' ? 'selected' : ''}>USD</option>
                            <option value="EUR" ${property.currency === 'EUR' ? 'selected' : ''}>EUR</option>
                            <option value="GBP" ${property.currency === 'GBP' ? 'selected' : ''}>GBP</option>
                            <option value="INR" ${property.currency === 'INR' ? 'selected' : ''}>INR</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="quickEditStatus">Status</label>
                        <select id="quickEditStatus">
                            <option value="available" ${property.status === 'available' ? 'selected' : ''}>Available</option>
                            <option value="occupied" ${property.status === 'occupied' ? 'selected' : ''}>Occupied</option>
                            <option value="maintenance" ${property.status === 'maintenance' ? 'selected' : ''}>Under Maintenance</option>
                        </select>
                    </div>
                </div>
            </form>
            
            <div class="quick-edit-actions">
                <button onclick="deletePropertyFromQuickEdit(${property.id})" class="btn-danger">
                    <i class="fas fa-trash"></i> Delete Property
                </button>
                <button onclick="savePropertyFromQuickEdit(${property.id})" class="btn-primary">
                    <i class="fas fa-save"></i> Save Changes
                </button>
            </div>
        `;
    } catch (error) {
        console.error('Error loading property for quick edit:', error);
        showMessage('Failed to load property details', 'error');
    }
}

async function savePropertyFromQuickEdit(propertyId) {
    try {
        const formData = {
            name: document.getElementById('quickEditName').value,
            type: document.getElementById('quickEditType').value,
            address: document.getElementById('quickEditAddress').value,
            bedrooms: document.getElementById('quickEditBedrooms').value,
            bathrooms: document.getElementById('quickEditBathrooms').value,
            square_feet: document.getElementById('quickEditSquareFeet').value,
            rent_amount: document.getElementById('quickEditRentAmount').value,
            currency: document.getElementById('quickEditCurrency').value,
            status: document.getElementById('quickEditStatus').value
        };
        
        await apiCall(`/api/properties/${propertyId}`, {
            method: 'PUT',
            body: JSON.stringify(formData)
        });
        
        showMessage('Property updated successfully!');
        closeModal('quickEditModal');
        loadProperties(); // Refresh the main properties list
    } catch (error) {
        console.error('Error saving property:', error);
        showMessage('Failed to update property', 'error');
    }
}

async function deletePropertyFromQuickEdit(propertyId) {
    if (confirm('Are you sure you want to delete this property? This action cannot be undone.')) {
        try {
            await apiCall(`/api/properties/${propertyId}`, {
                method: 'DELETE'
            });
            
            showMessage('Property deleted successfully!');
            closeModal('quickEditModal');
            loadProperties(); // Refresh the main properties list
        } catch (error) {
            console.error('Error deleting property:', error);
            showMessage('Failed to delete property', 'error');
        }
    }
}

// Tenants functions
async function loadTenants() {
    try {
        const tenants = await apiCall('/api/tenants');
        console.log('Loaded tenants from API:', tenants);
        displayTenants(tenants);
    } catch (error) {
        console.error('Error loading tenants:', error);
    }
}

// Function to toggle tenant view between card and list
function toggleTenantView(view) {
    currentTenantView = view;
    
    // Update button states
    document.getElementById('cardViewBtn').classList.toggle('active', view === 'card');
    document.getElementById('listViewBtn').classList.toggle('active', view === 'list');
    
    // Show/hide containers
    const cardContainer = document.getElementById('tenantsList');
    const tableContainer = document.getElementById('tenantsTable');
    
    if (view === 'card') {
        cardContainer.style.display = 'grid';
        tableContainer.style.display = 'none';
    } else {
        cardContainer.style.display = 'none';
        tableContainer.style.display = 'block';
    }
    
    // Reload tenants to display in the correct view
    loadTenants();
}

function displayTenants(tenants) {
    console.log('Displaying tenants:', tenants);
    
    // Sort tenants by property name first, then by tenant name
    const sortedTenants = tenants.sort((a, b) => {
        // First sort by property name
        const propertyA = (a.property_name || 'No property').toLowerCase();
        const propertyB = (b.property_name || 'No property').toLowerCase();
        
        const propertyComparison = propertyA.localeCompare(propertyB, undefined, { numeric: true, sensitivity: 'base' });
        
        // If properties are the same, sort by tenant name
        if (propertyComparison === 0) {
            const nameA = `${a.first_name} ${a.last_name}`.toLowerCase();
            const nameB = `${b.first_name} ${b.last_name}`.toLowerCase();
            return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
        }
        
        return propertyComparison;
    });
    
    if (currentTenantView === 'card') {
        displayTenantsCardView(sortedTenants);
    } else {
        displayTenantsListView(sortedTenants);
    }
}

function displayTenantsCardView(tenants) {
    const container = document.getElementById('tenantsList');
    container.innerHTML = '';
    
    tenants.forEach(tenant => {
        // Format free month information
        let freeMonthText = 'N/A';
        console.log('Tenant free month data:', { 
            id: tenant.id, 
            free_month_type: tenant.free_month_type, 
            free_month_date: tenant.free_month_date 
        });
        
        if (tenant.free_month_type) {
            if (tenant.free_month_type === 'first') {
                freeMonthText = 'First Month';
            } else if (tenant.free_month_type === 'last') {
                freeMonthText = 'Last Month';
            } else if (tenant.free_month_type === 'custom' && tenant.free_month_date) {
                const date = new Date(tenant.free_month_date + '-01');
                freeMonthText = `Custom: ${date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`;
            }
        }
        
        // Format property name - show previous property for expired tenants
        let propertyDisplay = 'No property';
        if (tenant.property_name) {
            if (tenant.status === 'expired') {
                propertyDisplay = `Previous: ${tenant.property_name}`;
            } else {
                propertyDisplay = tenant.property_name;
            }
        }
        
        // Format lease dates
        const leaseStart = tenant.lease_start ? new Date(tenant.lease_start).toLocaleDateString() : 'N/A';
        const leaseEnd = tenant.lease_end ? new Date(tenant.lease_end).toLocaleDateString() : 'N/A';
        
        const card = document.createElement('div');
        card.className = 'card';
        card.innerHTML = `
            <div class="card-header">
                <h3>${tenant.first_name} ${tenant.last_name}</h3>
                <span class="card-status status-${tenant.status}">${tenant.status}</span>
            </div>
            <div class="card-content">
                <div class="card-info">
                    <div class="info-item">
                        <i class="fas fa-envelope"></i>
                        <span>${tenant.email}</span>
                    </div>
                    <div class="info-item">
                        <i class="fas fa-phone"></i>
                        <span>${tenant.phone || 'N/A'}</span>
                    </div>
                    <div class="info-item">
                        <i class="fas fa-globe"></i>
                        <span>${tenant.nationality || 'N/A'}</span>
                    </div>
                    <div class="info-item">
                        <i class="fas fa-home"></i>
                        <span>${tenant.property_id ? `<a href="#" onclick="showPropertyDetails(${tenant.property_id})" class="property-link">${propertyDisplay}</a>` : propertyDisplay}</span>
                    </div>
                    <div class="info-item">
                        <i class="fas fa-money-bill-wave"></i>
                        <span>${tenant.rent_amount ? `${tenant.currency || 'USD'} ${tenant.rent_amount.toLocaleString()}` : 'N/A'}</span>
                    </div>
                    <div class="info-item">
                        <i class="fas fa-calendar-alt"></i>
                        <span>Free Month: ${freeMonthText}</span>
                    </div>
                    <div class="info-item">
                        <i class="fas fa-calendar-check"></i>
                        <span>Lease: ${leaseStart} - ${leaseEnd}</span>
                    </div>
                    <div class="info-item">
                        <i class="fas fa-money-check-alt"></i>
                        <span class="cheque-status-${getChequeStatus(tenant).toLowerCase()}" ${getChequeStatus(tenant) === 'Yes' ? `onclick="showChequeDetails(${tenant.id})" style="cursor: pointer;"` : ''}>${getChequeStatus(tenant)}</span>
                    </div>
                </div>
            </div>
                                <div class="card-actions">
                        <button onclick="editTenant(${tenant.id})" class="btn-edit btn-small">
                            <i class="fas fa-edit"></i>
                            Edit
                        </button>
                        <button onclick="manageTenantContract(${tenant.id})" class="btn-secondary btn-small">
                            <i class="fas fa-file-contract"></i>
                            Contract
                        </button>
                        <button onclick="deleteTenant(${tenant.id})" class="btn-delete btn-small">
                            <i class="fas fa-trash"></i>
                            Delete
                        </button>
                    </div>
        `;
        container.appendChild(card);
    });
}

function displayTenantsListView(tenants) {
    const tableBody = document.getElementById('tenantsTableBody');
    tableBody.innerHTML = '';
    
    tenants.forEach(tenant => {
        // Format property name - show previous property for expired tenants
        let propertyDisplay = 'No property';
        if (tenant.property_name) {
            if (tenant.status === 'expired') {
                propertyDisplay = `Previous: ${tenant.property_name}`;
            } else {
                propertyDisplay = tenant.property_name;
            }
        }
        
        // Format lease dates
        const leaseStart = tenant.lease_start ? new Date(tenant.lease_start).toLocaleDateString() : 'N/A';
        const leaseEnd = tenant.lease_end ? new Date(tenant.lease_end).toLocaleDateString() : 'N/A';
        const leasePeriod = `${leaseStart} - ${leaseEnd}`;
        
        // Format rent amount
        const rentDisplay = tenant.rent_amount ? `${tenant.currency || 'USD'} ${tenant.rent_amount.toLocaleString()}` : 'N/A';
        
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>
                <div class="tenant-name">${tenant.first_name} ${tenant.last_name}</div>
            </td>
            <td>
                <a href="mailto:${tenant.email}" class="tenant-email">${tenant.email}</a>
            </td>
            <td>
                <span class="tenant-phone">${tenant.phone || 'N/A'}</span>
            </td>
            <td>
                <span class="tenant-nationality">${tenant.nationality || 'N/A'}</span>
            </td>
            <td>
                <span class="tenant-property">${tenant.property_id ? `<a href="#" onclick="showPropertyDetails(${tenant.property_id})" class="property-link">${propertyDisplay}</a>` : propertyDisplay}</span>
            </td>
            <td>
                <span class="tenant-rent">${rentDisplay}</span>
            </td>
            <td>
                <span class="tenant-lease">${leasePeriod}</span>
            </td>
            <td>
                <span class="tenant-cheques cheque-status-${getChequeStatus(tenant).toLowerCase()}" ${getChequeStatus(tenant) === 'Yes' ? `onclick="showChequeDetails(${tenant.id})" style="cursor: pointer;"` : ''}>
                    ${getChequeStatus(tenant)}
                </span>
            </td>
            <td>
                <span class="tenant-status status-${tenant.status}">${tenant.status}</span>
            </td>
            <td>
                <div class="tenant-actions">
                    <button onclick="editTenant(${tenant.id})" class="btn-edit btn-small">
                        <i class="fas fa-edit"></i>
                        Edit
                    </button>
                    <button onclick="manageTenantContract(${tenant.id})" class="btn-secondary btn-small">
                        <i class="fas fa-file-contract"></i>
                        Contract
                    </button>
                    <button onclick="deleteTenant(${tenant.id})" class="btn-delete btn-small">
                        <i class="fas fa-trash"></i>
                        Delete
                    </button>
                </div>
            </td>
        `;
        tableBody.appendChild(row);
    });
}

async function editTenant(id) {
    try {
        const tenant = await apiCall(`/api/tenants/${id}`);
        
        // Show the modal first
        showModal('tenantModal');
        
        // Wait for property dropdown to be populated
        await populatePropertyDropdowns();
        
        // Populate the form with existing data
        document.getElementById('tenantFirstName').value = tenant.first_name;
        document.getElementById('tenantLastName').value = tenant.last_name;
        document.getElementById('tenantEmail').value = tenant.email;
        document.getElementById('tenantPhone').value = tenant.phone || '';
        document.getElementById('tenantNationality').value = tenant.nationality || '';
        
        // Set property value after dropdown is populated
        const propertySelect = document.getElementById('tenantProperty');
        if (propertySelect && tenant.property_id) {
            // Add a small delay to ensure dropdown is fully populated
            setTimeout(() => {
                propertySelect.value = tenant.property_id;
                
                // Trigger the change event to auto-fill rent amount and currency
                const event = new Event('change', { bubbles: true });
                propertySelect.dispatchEvent(event);
            }, 100);
        }
        
        // Set rent and currency (these might be overridden by the property selection)
        document.getElementById('tenantRent').value = tenant.rent_amount || '';
        document.getElementById('tenantCurrency').value = tenant.currency || 'USD';
        document.getElementById('tenantLeaseStart').value = tenant.lease_start || '';
        document.getElementById('tenantLeaseEnd').value = tenant.lease_end || '';
        
        // Populate free month fields
        document.getElementById('tenantFreeMonth').value = tenant.free_month_type || '';
        if (tenant.free_month_type === 'custom' && tenant.free_month_date) {
            document.getElementById('tenantFreeMonthDate').value = tenant.free_month_date;
            document.getElementById('freeMonthDetails').style.display = 'block';
        } else {
            document.getElementById('freeMonthDetails').style.display = 'none';
        }
        
        // Call toggle function to ensure correct state
        setTimeout(() => {
            toggleFreeMonthDetails();
        }, 50);
        
        // Load cheque data if available
        if (tenant.cheques && tenant.cheques.length > 0) {
            loadChequeData(tenant.cheques);
        }
        
        // Update modal title
        document.getElementById('tenantModalTitle').textContent = 'Edit Tenant';
        
        // Store the tenant ID for update
        document.getElementById('tenantForm').dataset.editId = id;
        
    } catch (error) {
        showMessage('Failed to load tenant details.', 'error');
    }
}

async function showPropertyDetails(propertyId) {
    try {
        // Show the modal first
        showModal('propertyDetailsModal');
        
        // Show loading state
        const content = document.getElementById('propertyDetailsContent');
        content.innerHTML = `
            <div class="loading">
                <i class="fas fa-spinner fa-spin"></i>
                Loading property details...
            </div>
        `;
        
        // Fetch property details
        const property = await apiCall(`/api/properties/${propertyId}`);
        
        // Update modal title
        document.getElementById('propertyDetailsTitle').textContent = property.name;
        
        // Format property details
        const detailsHtml = `
            <div class="property-details-grid">
                <div class="property-detail-section">
                    <h3><i class="fas fa-info-circle"></i> Basic Information</h3>
                    <div class="detail-row">
                        <strong>Name:</strong>
                        <span>${property.name}</span>
                    </div>
                    <div class="detail-row">
                        <strong>Address:</strong>
                        <span>${property.address}</span>
                    </div>
                    <div class="detail-row">
                        <strong>Type:</strong>
                        <span>${property.type ? formatPropertyType(property.type) : 'N/A'}</span>
                    </div>
                    <div class="detail-row">
                        <strong>Status:</strong>
                        <span class="property-status-badge status-${property.status}">${formatPropertyStatus(property.status)}</span>
                    </div>
                </div>
                
                <div class="property-detail-section">
                    <h3><i class="fas fa-home"></i> Property Specifications</h3>
                    <div class="detail-row">
                        <strong>Bedrooms:</strong>
                        <span>${property.bedrooms || 'N/A'}</span>
                    </div>
                    <div class="detail-row">
                        <strong>Bathrooms:</strong>
                        <span>${property.bathrooms || 'N/A'}</span>
                    </div>
                    <div class="detail-row">
                        <strong>Square Feet:</strong>
                        <span>${property.square_feet || 'N/A'}</span>
                    </div>
                    <div class="detail-row">
                        <strong>Rent Amount:</strong>
                        <span class="rent-amount">${property.rent_amount ? `${property.currency || 'USD'} ${property.rent_amount.toLocaleString()}` : 'N/A'}</span>
                    </div>
                </div>
                
                <div class="property-detail-section">
                    <h3><i class="fas fa-tools"></i> Utility Information</h3>
                    <div class="detail-row">
                        <strong>Electricity Number:</strong>
                        <span>${property.electricity_number || 'N/A'}</span>
                    </div>
                    <div class="detail-row">
                        <strong>Water Number:</strong>
                        <span>${property.water_number || 'N/A'}</span>
                    </div>
                </div>
                
                <div class="property-detail-section">
                    <h3><i class="fas fa-users"></i> Current Tenant</h3>
                    <div id="currentTenantInfo">
                        <div class="loading">
                            <i class="fas fa-spinner fa-spin"></i>
                            Loading tenant information...
                        </div>
                    </div>
                </div>
            </div>
            
            <div class="property-actions-section">
                <button onclick="editProperty(${property.id})" class="btn-primary">
                    <i class="fas fa-edit"></i>
                    Edit Property
                </button>
                <button onclick="closeModal('propertyDetailsModal'); showQuickEditPanel(); selectPropertyForQuickEdit(${JSON.stringify(property).replace(/"/g, '&quot;')})" class="btn-secondary">
                    <i class="fas fa-edit"></i>
                    Quick Edit
                </button>
            </div>
        `;
        
        content.innerHTML = detailsHtml;
        
        // Load current tenant information
        try {
            const tenants = await apiCall('/api/tenants');
            const currentTenant = tenants.find(tenant => tenant.property_id === propertyId && tenant.status === 'active');
            
            const tenantInfoDiv = document.getElementById('currentTenantInfo');
            if (currentTenant) {
                tenantInfoDiv.innerHTML = `
                    <div class="detail-row">
                        <strong>Name:</strong>
                        <span>${currentTenant.first_name} ${currentTenant.last_name}</span>
                    </div>
                    <div class="detail-row">
                        <strong>Email:</strong>
                        <span><a href="mailto:${currentTenant.email}" class="tenant-email-link">${currentTenant.email}</a></span>
                    </div>
                    <div class="detail-row">
                        <strong>Phone:</strong>
                        <span>${currentTenant.phone || 'N/A'}</span>
                    </div>
                    <div class="detail-row">
                        <strong>Lease Period:</strong>
                        <span>${currentTenant.lease_start ? new Date(currentTenant.lease_start).toLocaleDateString() : 'N/A'} - ${currentTenant.lease_end ? new Date(currentTenant.lease_end).toLocaleDateString() : 'N/A'}</span>
                    </div>
                    <div class="detail-row">
                        <strong>Rent Amount:</strong>
                        <span class="rent-amount">${currentTenant.rent_amount ? `${currentTenant.currency || 'USD'} ${currentTenant.rent_amount.toLocaleString()}` : 'N/A'}</span>
                    </div>
                `;
            } else {
                tenantInfoDiv.innerHTML = `
                    <div class="no-tenant">
                        <i class="fas fa-user-slash"></i>
                        <span>No active tenant assigned to this property</span>
                    </div>
                `;
            }
        } catch (error) {
            console.error('Error loading tenant information:', error);
            document.getElementById('currentTenantInfo').innerHTML = `
                <div class="error-message">
                    <i class="fas fa-exclamation-triangle"></i>
                    <span>Failed to load tenant information</span>
                </div>
            `;
        }
        
    } catch (error) {
        console.error('Error loading property details:', error);
        const content = document.getElementById('propertyDetailsContent');
        content.innerHTML = `
            <div class="error-message">
                <i class="fas fa-exclamation-triangle"></i>
                <h3>Error Loading Property Details</h3>
                <p>Failed to load property information. Please try again.</p>
                <button onclick="closeModal('propertyDetailsModal')" class="btn-secondary">Close</button>
            </div>
        `;
    }
}

async function deleteTenant(id) {
    if (!confirm('Are you sure you want to delete this tenant?')) return;
    
    try {
        await apiCall(`/api/tenants/${id}`, { method: 'DELETE' });
        loadTenants();
        showMessage('Tenant deleted successfully!');
    } catch (error) {
        showMessage('Failed to delete tenant.', 'error');
    }
}

// Tenant form handlers
document.getElementById('tenantForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    // Validate that property is not vacant
    const propertySelect = document.getElementById('tenantProperty');
    const selectedPropertyId = propertySelect.value;
    
    if (selectedPropertyId) {
        const selectedOption = propertySelect.options[propertySelect.selectedIndex];
        if (selectedOption && selectedOption.dataset.status === 'vacant') {
            showMessage('Cannot assign tenant to a vacant property. Please select a non-vacant property.', 'error');
            return;
        }
    }
    
    // Calculate free month date based on selection
    let freeMonthDate = null;
    const freeMonthType = document.getElementById('tenantFreeMonth').value;
    const leaseStart = document.getElementById('tenantLeaseStart').value;
    const leaseEnd = document.getElementById('tenantLeaseEnd').value;
    
    if (freeMonthType === 'first' && leaseStart) {
        freeMonthDate = leaseStart.substring(0, 7); // Get YYYY-MM format
    } else if (freeMonthType === 'last' && leaseEnd) {
        // Calculate last month by subtracting one month from lease end
        const endDate = new Date(leaseEnd);
        endDate.setMonth(endDate.getMonth() - 1);
        freeMonthDate = endDate.toISOString().substring(0, 7);
    } else if (freeMonthType === 'custom') {
        freeMonthDate = document.getElementById('tenantFreeMonthDate').value;
    }
    
    const formData = {
        first_name: document.getElementById('tenantFirstName').value,
        last_name: document.getElementById('tenantLastName').value,
        email: document.getElementById('tenantEmail').value,
        phone: document.getElementById('tenantPhone').value,
        nationality: document.getElementById('tenantNationality').value,
        property_id: document.getElementById('tenantProperty').value || null,
        rent_amount: parseFloat(document.getElementById('tenantRent').value) || null,
        currency: document.getElementById('tenantCurrency').value,
        lease_start: document.getElementById('tenantLeaseStart').value,
        lease_end: document.getElementById('tenantLeaseEnd').value,
        free_month_type: freeMonthType || null,
        free_month_date: freeMonthDate,
        cheques: getChequeData()
    };
    
    console.log('Tenant form data being submitted:', formData);
    
    const editId = e.target.dataset.editId;
    
    try {
        if (editId) {
            // Update existing tenant
            await apiCall(`/api/tenants/${editId}`, {
                method: 'PUT',
                body: JSON.stringify(formData)
            });
            showMessage('Tenant updated successfully!');
        } else {
            // Create new tenant
            await apiCall('/api/tenants', {
                method: 'POST',
                body: JSON.stringify(formData)
            });
            showMessage('Tenant added successfully!');
        }
        
        closeModal('tenantModal');
        loadTenants();
    } catch (error) {
        showMessage(editId ? 'Failed to update tenant.' : 'Failed to add tenant.', 'error');
    }
});

// Maintenance functions
async function loadMaintenance() {
    try {
        const maintenance = await apiCall('/api/maintenance');
        displayMaintenance(maintenance);
    } catch (error) {
        console.error('Error loading maintenance:', error);
    }
}

function displayMaintenance(maintenance) {
    const container = document.getElementById('maintenanceList');
    container.innerHTML = '';
    
    console.log('Displaying maintenance requests:', maintenance);
    
    if (maintenance.length === 0) {
        container.innerHTML = '<div class="empty-state"><i class="fas fa-tools"></i><h3>No maintenance requests</h3></div>';
        return;
    }
    
    // Sort maintenance requests by title alphabetically
    const sortedMaintenance = maintenance.sort((a, b) => {
        return a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' });
    });
    
    sortedMaintenance.forEach(request => {
        console.log('Processing maintenance request:', request.id, 'Status:', request.status);
        const card = document.createElement('div');
        card.className = 'card';
        card.innerHTML = `
            <div class="card-header">
                <div class="card-title">${request.title}</div>
                <span class="card-status status-${request.status}">${request.status}</span>
            </div>
            <div class="card-details">
                <div class="card-detail">
                    <span>Property:</span>
                    <span>${request.property_name || 'No property'}</span>
                </div>
                <div class="card-detail">
                    <span>Tenant:</span>
                    <span>${request.first_name && request.last_name ? `${request.first_name} ${request.last_name}` : 'N/A'}</span>
                </div>
                <div class="card-detail">
                    <span>Priority:</span>
                    <span class="card-status priority-${request.priority}">${request.priority}</span>
                </div>
                <div class="card-detail">
                    <span>Created:</span>
                    <span>${formatDate(request.created_at)}</span>
                </div>
                ${request.description ? `<div class="card-detail"><span>Description:</span><span>${request.description}</span></div>` : ''}
            </div>
            <div class="card-actions">
                ${request.status === 'completed' ? 
                    `<button onclick="deleteMaintenance(${request.id})" class="btn-delete" style="background-color: #dc3545; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer;">
                        <i class="fas fa-trash"></i> Delete
                    </button>` :
                    `<button onclick="updateMaintenanceStatus(${request.id}, '${request.status === 'pending' ? 'in-progress' : 'completed'}')" class="btn-edit">
                        ${request.status === 'pending' ? 'Start' : request.status === 'in-progress' ? 'Complete' : 'Completed'}
                    </button>`
                }
            </div>
        `;
        container.appendChild(card);
    });
}

// Maintenance form handlers
document.getElementById('maintenanceForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    console.log('Maintenance form submitted');
    
    const formData = {
        property_id: document.getElementById('maintenanceProperty').value || null,
        tenant_id: document.getElementById('maintenanceTenant').value || null,
        title: document.getElementById('maintenanceTitle').value,
        description: document.getElementById('maintenanceDescription').value,
        priority: document.getElementById('maintenancePriority').value
    };
    
    console.log('Form data:', formData);
    
    // Validate required fields
    if (!formData.title) {
        showMessage('Title is required for maintenance request.', 'error');
        return;
    }
    
    try {
        const response = await apiCall('/api/maintenance', {
            method: 'POST',
            body: JSON.stringify(formData)
        });
        
        console.log('Maintenance request created:', response);
        
        closeModal('maintenanceModal');
        loadMaintenance();
        showMessage('Maintenance request created successfully!');
    } catch (error) {
        console.error('Error creating maintenance request:', error);
        showMessage('Failed to create maintenance request.', 'error');
    }
});

async function updateMaintenanceStatus(id, status) {
    try {
        const completed_at = status === 'completed' ? new Date().toISOString() : null;
        await apiCall(`/api/maintenance/${id}`, {
            method: 'PUT',
            body: JSON.stringify({ status, completed_at })
        });
        
        loadMaintenance();
        showMessage('Maintenance request updated successfully!');
    } catch (error) {
        showMessage('Failed to update maintenance request.', 'error');
    }
}

async function deleteMaintenance(id) {
    console.log('Attempting to delete maintenance request with ID:', id);
    
    if (!confirm('Are you sure you want to delete this completed maintenance request? This action cannot be undone.')) {
        console.log('User cancelled deletion');
        return;
    }
    
    try {
        console.log('Making DELETE request to /api/maintenance/' + id);
        console.log('Current auth token:', authToken ? 'Present' : 'Missing');
        
        const response = await apiCall(`/api/maintenance/${id}`, {
            method: 'DELETE'
        });
        
        console.log('Delete response:', response);
        loadMaintenance();
        showMessage('Maintenance request deleted successfully!');
    } catch (error) {
        console.error('Error deleting maintenance request:', error);
        console.error('Error details:', {
            message: error.message,
            stack: error.stack,
            name: error.name
        });
        showMessage(`Failed to delete maintenance request: ${error.message}`, 'error');
    }
}

// Test function to create a maintenance request
async function testMaintenanceCreation() {
    const testData = {
        title: 'Test Maintenance Request',
        description: 'This is a test maintenance request',
        priority: 'medium'
    };
    
    try {
        const response = await apiCall('/api/maintenance', {
            method: 'POST',
            body: JSON.stringify(testData)
        });
        
        console.log('Test maintenance request created:', response);
        loadMaintenance();
        showMessage('Test maintenance request created successfully!');
    } catch (error) {
        console.error('Error creating test maintenance request:', error);
        showMessage('Failed to create test maintenance request.', 'error');
    }
}

// Test function to test delete functionality
async function testDeleteMaintenance() {
    console.log('Testing delete maintenance functionality...');
    
    // First, let's see what maintenance requests exist
    try {
        const maintenance = await apiCall('/api/maintenance');
        console.log('Current maintenance requests:', maintenance);
        
        // Find a completed maintenance request
        const completedRequest = maintenance.find(req => req.status === 'completed');
        
        if (completedRequest) {
            console.log('Found completed maintenance request:', completedRequest);
            console.log('Attempting to delete maintenance request ID:', completedRequest.id);
            
            // Test the delete function
            await deleteMaintenance(completedRequest.id);
        } else {
            console.log('No completed maintenance requests found. Creating one for testing...');
            
            // Create a test maintenance request and complete it
            const testData = {
                title: 'Test Delete Maintenance',
                description: 'This is a test maintenance request for deletion',
                priority: 'low'
            };
            
            const newRequest = await apiCall('/api/maintenance', {
                method: 'POST',
                body: JSON.stringify(testData)
            });
            
            console.log('Created test maintenance request:', newRequest);
            
            // Complete it
            await apiCall(`/api/maintenance/${newRequest.id}`, {
                method: 'PUT',
                body: JSON.stringify({ status: 'completed', completed_at: new Date().toISOString() })
            });
            
            console.log('Completed the test maintenance request');
            
            // Now try to delete it
            await deleteMaintenance(newRequest.id);
        }
    } catch (error) {
        console.error('Error in test delete maintenance:', error);
    }
}

// Rent Tracking Functions
function setDefaultRentTrackingValues() {
    // Set current month as default
    const now = new Date();
    const currentMonth = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    document.getElementById('rentTrackingMonth').value = currentMonth;
    
    // Set due date to 5th of next month
    const dueDate = new Date(now.getFullYear(), now.getMonth() + 1, 5);
    document.getElementById('rentTrackingDueDate').value = dueDate.toISOString().split('T')[0];
}

function togglePaymentFields() {
    const paymentMethod = document.getElementById('rentTrackingPaymentMethod').value;
    const totalAmount = parseFloat(document.getElementById('rentTrackingTotalAmount').value) || 0;
    const paymentAmount = parseFloat(document.getElementById('rentTrackingPaymentAmount').value) || 0;
    
    // Hide all payment fields
    document.querySelectorAll('.payment-fields').forEach(field => {
        field.style.display = 'none';
    });
    
    // Show relevant fields based on payment method
    switch(paymentMethod) {
        case 'cash':
            document.getElementById('cashFields').style.display = 'block';
            break;
        case 'cheque':
            document.getElementById('chequeFields').style.display = 'block';
            break;
        case 'online':
            document.getElementById('onlineFields').style.display = 'block';
            break;
        case 'partial':
            document.getElementById('partialFields').style.display = 'block';
            // Calculate remaining balance
            const remainingBalance = totalAmount - paymentAmount;
            document.getElementById('rentTrackingPartialBalance').value = remainingBalance.toFixed(2);
            break;
    }
}

function calculateRemainingBalance() {
    const totalAmount = parseFloat(document.getElementById('rentTrackingTotalAmount').value) || 0;
    const paymentAmount = parseFloat(document.getElementById('rentTrackingPaymentAmount').value) || 0;
    const remainingBalance = totalAmount - paymentAmount;
    
    if (document.getElementById('rentTrackingPaymentMethod').value === 'partial') {
        document.getElementById('rentTrackingPartialBalance').value = remainingBalance.toFixed(2);
    }
}

// Rent Tracking Form Handler
document.getElementById('rentTrackingForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const formData = {
        property_id: document.getElementById('rentTrackingProperty').value,
        tenant_id: document.getElementById('rentTrackingTenant').value,
        rent_month: document.getElementById('rentTrackingMonth').value,
        due_date: document.getElementById('rentTrackingDueDate').value,
        total_amount: parseFloat(document.getElementById('rentTrackingTotalAmount').value),
        currency: document.getElementById('rentTrackingCurrency').value,
        payment_method: document.getElementById('rentTrackingPaymentMethod').value,
        payment_amount: parseFloat(document.getElementById('rentTrackingPaymentAmount').value),
        payment_date: new Date().toISOString().split('T')[0],
        
        // Cash payment details
        cash_received_by: document.getElementById('rentTrackingCashReceivedBy').value || null,
        cash_receipt_number: document.getElementById('rentTrackingCashReceiptNumber').value || null,
        
        // Cheque payment details
        cheque_number: document.getElementById('rentTrackingChequeNumber').value || null,
        cheque_bank: document.getElementById('rentTrackingChequeBank').value || null,
        cheque_date: document.getElementById('rentTrackingChequeDate').value || null,
        cheque_status: document.getElementById('rentTrackingChequeStatus').value || 'pending',
        
        // Online payment details
        online_reference: document.getElementById('rentTrackingOnlineReference').value || null,
        online_bank: document.getElementById('rentTrackingOnlineBank').value || null,
        
        // Partial payment details
        partial_reason: document.getElementById('rentTrackingPartialReason').value || null,
        partial_balance: parseFloat(document.getElementById('rentTrackingPartialBalance').value) || 0,
        partial_notes: document.getElementById('rentTrackingPartialNotes').value || null,
        
        // General notes
        notes: document.getElementById('rentTrackingNotes').value || null
    };
    
    try {
        const response = await apiCall('/api/rent-tracking', {
            method: 'POST',
            body: JSON.stringify(formData)
        });
        
        closeModal('rentTrackingModal');
        showMessage('Rent payment tracked successfully!');
        
        // Refresh financial records to show new payment
        loadFinancial();
    } catch (error) {
        console.error('Error tracking rent payment:', error);
        showMessage('Failed to track rent payment.', 'error');
    }
});

// Add event listeners for dynamic calculations
document.addEventListener('DOMContentLoaded', function() {
    // Test server connection
    testServerConnection();
    
    const totalAmountInput = document.getElementById('rentTrackingTotalAmount');
    const paymentAmountInput = document.getElementById('rentTrackingPaymentAmount');
    
    if (totalAmountInput && paymentAmountInput) {
        totalAmountInput.addEventListener('input', calculateRemainingBalance);
        paymentAmountInput.addEventListener('input', calculateRemainingBalance);
    }
    
    // Add event listeners for contract management
    const contractForm = document.getElementById('contractManagementForm');
    if (contractForm) {
        contractForm.addEventListener('submit', handleContractManagement);
        
        // Add event listeners for settlement calculation
        const rentOwedInput = document.getElementById('contractRentOwed');
        const depositReturnInput = document.getElementById('contractDepositReturn');
        const penaltyAmountInput = document.getElementById('contractPenaltyAmount');
        
        if (rentOwedInput) rentOwedInput.addEventListener('input', calculateSettlementAmount);
        if (depositReturnInput) depositReturnInput.addEventListener('input', calculateSettlementAmount);
        if (penaltyAmountInput) penaltyAmountInput.addEventListener('input', calculateSettlementAmount);
    }
});

// Function to test server connection
async function testServerConnection() {
    try {
        const response = await fetch(`${API_BASE}/api/test`);
        const data = await response.json();
        console.log('Server connection test:', data);
    } catch (error) {
        console.error('Server connection test failed:', error);
        showMessage('Warning: Cannot connect to server. Please ensure the server is running.', 'error');
    }
}

// Financial functions
async function loadFinancial() {
    try {
        const financial = await apiCall('/api/financial');
        displayFinancial(financial);
        
        // Also load rent tracking records
        await loadRentTracking();
    } catch (error) {
        console.error('Error loading financial records:', error);
    }
}

// Load rent tracking records
async function loadRentTracking() {
    try {
        const response = await apiCall('/api/rent-tracking');
        const rentRecords = response;
        
        // Create a section to display rent tracking records
        let rentTrackingSection = document.getElementById('rentTrackingSection');
        if (!rentTrackingSection) {
            rentTrackingSection = document.createElement('div');
            rentTrackingSection.id = 'rentTrackingSection';
            rentTrackingSection.className = 'rent-tracking-section';
            rentTrackingSection.innerHTML = '<h3>Recent Rent Payments</h3>';
            
            const financialSection = document.getElementById('financial');
            if (financialSection) {
                financialSection.appendChild(rentTrackingSection);
            }
        }
        
        if (rentRecords.length === 0) {
            rentTrackingSection.innerHTML = '<h3>Recent Rent Payments</h3><p>No rent payments recorded yet.</p>';
            return;
        }
        
        let rentTrackingHTML = '<h3>Recent Rent Payments</h3><div class="rent-cards-grid">';
        
        rentRecords.slice(0, 6).forEach(record => {
            const paymentMethodClass = getPaymentMethodClass(record.payment_method);
            const statusClass = record.payment_method === 'partial' ? 'partial' : 'completed';
            
            rentTrackingHTML += `
                <div class="rent-card ${statusClass}">
                    <div class="rent-card-header">
                        <h4>${record.property_name}</h4>
                        <span class="payment-method ${paymentMethodClass}">${record.payment_method}</span>
                    </div>
                    <div class="rent-card-body">
                        <p><strong>Tenant:</strong> ${record.first_name} ${record.last_name}</p>
                        <p><strong>Month:</strong> ${record.rent_month}</p>
                        <p><strong>Amount:</strong> ${record.currency} ${record.payment_amount.toFixed(2)}</p>
                        <p><strong>Date:</strong> ${formatDate(record.payment_date)}</p>
                        ${record.payment_method === 'partial' ? `<p><strong>Balance:</strong> ${record.currency} ${record.partial_balance.toFixed(2)}</p>` : ''}
                    </div>
                    <div class="rent-card-footer">
                        <small>${record.notes || 'No additional notes'}</small>
                    </div>
                </div>
            `;
        });
        
        rentTrackingHTML += '</div>';
        rentTrackingSection.innerHTML = rentTrackingHTML;
        
    } catch (error) {
        console.error('Error loading rent tracking records:', error);
    }
}

function getPaymentMethodClass(method) {
    switch(method) {
        case 'cash': return 'cash';
        case 'cheque': return 'cheque';
        case 'online': return 'online';
        case 'partial': return 'partial';
        default: return 'default';
    }
}

function displayFinancial(financial) {
    const tbody = document.getElementById('financialTableBody');
    tbody.innerHTML = '';
    
    financial.forEach(record => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${formatDate(record.date)}</td>
            <td><span class="card-status priority-${record.type}">${record.type.charAt(0).toUpperCase() + record.type.slice(1)}</span></td>
            <td>${record.property_name || 'N/A'}</td>
            <td>${record.first_name && record.last_name ? `${record.first_name} ${record.last_name}` : 'N/A'}</td>
            <td>${record.description || 'N/A'}</td>
            <td>${record.currency || 'USD'} ${record.amount.toLocaleString()}</td>
            <td>
                <button onclick="deleteFinancialRecord(${record.id})" class="btn-delete">Delete</button>
            </td>
        `;
        tbody.appendChild(row);
    });
}

// Financial form handlers
document.getElementById('financialForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const formData = {
        property_id: document.getElementById('financialProperty').value || null,
        tenant_id: document.getElementById('financialTenant').value || null,
        type: document.getElementById('financialType').value,
        amount: parseFloat(document.getElementById('financialAmount').value),
        currency: document.getElementById('financialCurrency').value,
        description: document.getElementById('financialDescription').value,
        date: document.getElementById('financialDate').value
    };
    
    try {
        await apiCall('/api/financial', {
            method: 'POST',
            body: JSON.stringify(formData)
        });
        
        closeModal('financialModal');
        loadFinancial();
        showMessage('Financial record added successfully!');
    } catch (error) {
        showMessage('Failed to add financial record.', 'error');
    }
});

async function deleteFinancialRecord(id) {
    console.log('Attempting to delete financial record with ID:', id);
    
    if (!confirm('Are you sure you want to delete this financial record?')) {
        console.log('User cancelled deletion');
        return;
    }
    
    try {
        console.log('Sending DELETE request to:', `/api/financial/${id}`);
        const response = await apiCall(`/api/financial/${id}`, { method: 'DELETE' });
        console.log('Delete response:', response);
        
        await loadFinancial();
        showMessage('Financial record deleted successfully!');
    } catch (error) {
        console.error('Delete error details:', error);
        showMessage(`Failed to delete financial record: ${error.message}`, 'error');
    }
}

// Simple search function for properties
function filterProperties() {
    const searchTerm = document.getElementById('propertySearch').value.toLowerCase();
    const statusFilter = document.getElementById('propertyStatusFilter').value.toLowerCase();
    
    if (currentPropertyView === 'card') {
        const cards = document.querySelectorAll('#propertiesList .card');
        
        cards.forEach(card => {
            const title = card.querySelector('.card-title').textContent.toLowerCase();
            const address = card.querySelector('.card-detail span:last-child').textContent.toLowerCase();
            const type = card.querySelector('.card-detail span:first-child').textContent.toLowerCase();
            const status = card.querySelector('.card-status').textContent.toLowerCase();
            const rentText = card.querySelector('.card-detail span:last-child').textContent;
            
            // Search across all fields
            const matchesSearch = title.includes(searchTerm) || 
                                address.includes(searchTerm) || 
                                type.includes(searchTerm) || 
                                status.includes(searchTerm) || 
                                rentText.includes(searchTerm);
            
            // Check status filter
            const matchesStatus = !statusFilter || status.includes(statusFilter);
            
            if (matchesSearch && matchesStatus) {
                card.style.display = 'block';
            } else {
                card.style.display = 'none';
            }
        });
    } else {
        // List view filtering
        const rows = document.querySelectorAll('#propertiesTableBody tr');
        
        rows.forEach(row => {
            const name = row.querySelector('.property-name').textContent.toLowerCase();
            const address = row.querySelector('.property-address').textContent.toLowerCase();
            const type = row.querySelector('.property-type').textContent.toLowerCase();
            const status = row.querySelector('.property-status').textContent.toLowerCase();
            const bedrooms = row.querySelector('.property-bedrooms').textContent.toLowerCase();
            const bathrooms = row.querySelector('.property-bathrooms').textContent.toLowerCase();
            const squareFeet = row.querySelector('.property-square-feet').textContent.toLowerCase();
            const rent = row.querySelector('.property-rent').textContent.toLowerCase();
            
            // Search across all fields
            const matchesSearch = name.includes(searchTerm) || 
                                address.includes(searchTerm) || 
                                type.includes(searchTerm) || 
                                status.includes(searchTerm) || 
                                bedrooms.includes(searchTerm) || 
                                bathrooms.includes(searchTerm) || 
                                squareFeet.includes(searchTerm) || 
                                rent.includes(searchTerm);
            
            // Check status filter
            const matchesStatus = !statusFilter || status.includes(statusFilter);
            
            if (matchesSearch && matchesStatus) {
                row.style.display = 'table-row';
            } else {
                row.style.display = 'none';
            }
        });
    }
}

// Property search event listener
document.getElementById('propertySearch').addEventListener('input', filterProperties);

// Simple search function for tenants
function filterTenants() {
    const searchTerm = document.getElementById('tenantSearch').value.toLowerCase();
    const statusFilter = document.getElementById('tenantStatusFilter').value.toLowerCase();
    
    if (currentTenantView === 'card') {
        const cards = document.querySelectorAll('#tenantsList .card');
        
        cards.forEach(card => {
            const name = card.querySelector('.card-header h3').textContent.toLowerCase();
            const email = card.querySelector('.info-item:nth-child(1) span').textContent.toLowerCase();
            const phone = card.querySelector('.info-item:nth-child(2) span').textContent.toLowerCase();
            const nationality = card.querySelector('.info-item:nth-child(3) span').textContent.toLowerCase();
            const property = card.querySelector('.info-item:nth-child(4) span').textContent.toLowerCase();
            const rentText = card.querySelector('.info-item:nth-child(5) span').textContent.toLowerCase();
            const freeMonth = card.querySelector('.info-item:nth-child(6) span').textContent.toLowerCase();
            const status = card.querySelector('.card-status').textContent.toLowerCase();
            
            // Search across all fields
            const matchesSearch = name.includes(searchTerm) || 
                                email.includes(searchTerm) || 
                                phone.includes(searchTerm) || 
                                nationality.includes(searchTerm) || 
                                property.includes(searchTerm) || 
                                rentText.includes(searchTerm) || 
                                freeMonth.includes(searchTerm) || 
                                status.includes(searchTerm);
            
            // Check status filter
            const matchesStatus = !statusFilter || status.includes(statusFilter);
            
            if (matchesSearch && matchesStatus) {
                card.style.display = 'block';
            } else {
                card.style.display = 'none';
            }
        });
    } else {
        // List view filtering
        const rows = document.querySelectorAll('#tenantsTableBody tr');
        
        rows.forEach(row => {
            const name = row.querySelector('.tenant-name').textContent.toLowerCase();
            const email = row.querySelector('.tenant-email').textContent.toLowerCase();
            const phone = row.querySelector('.tenant-phone').textContent.toLowerCase();
            const nationality = row.querySelector('.tenant-nationality').textContent.toLowerCase();
            const property = row.querySelector('.tenant-property').textContent.toLowerCase();
            const rent = row.querySelector('.tenant-rent').textContent.toLowerCase();
            const lease = row.querySelector('.tenant-lease').textContent.toLowerCase();
            const status = row.querySelector('.tenant-status').textContent.toLowerCase();
            
            // Search across all fields
            const matchesSearch = name.includes(searchTerm) || 
                                email.includes(searchTerm) || 
                                phone.includes(searchTerm) || 
                                nationality.includes(searchTerm) || 
                                property.includes(searchTerm) || 
                                rent.includes(searchTerm) || 
                                lease.includes(searchTerm) || 
                                status.includes(searchTerm);
            
            // Check status filter
            const matchesStatus = !statusFilter || status.includes(statusFilter);
            
            if (matchesSearch && matchesStatus) {
                row.style.display = 'table-row';
            } else {
                row.style.display = 'none';
            }
        });
    }
}

// Tenant search event listener
document.getElementById('tenantSearch').addEventListener('input', filterTenants);

document.getElementById('maintenanceSearch').addEventListener('input', (e) => {
    const searchTerm = e.target.value.toLowerCase();
    const cards = document.querySelectorAll('#maintenanceList .card');
    
    cards.forEach(card => {
        const title = card.querySelector('.card-title').textContent.toLowerCase();
        const property = card.querySelector('.card-detail span:last-child').textContent.toLowerCase();
        
        if (title.includes(searchTerm) || property.includes(searchTerm)) {
            card.style.display = 'block';
        } else {
            card.style.display = 'none';
        }
    });
});

// Initialize app
function initApp() {
    try {
        console.log('Initializing app...');
        
        // Check if user is already logged in
        if (authToken && currentUser) {
            console.log('User is logged in, showing app');
            document.getElementById('authModal').style.display = 'none';
            document.getElementById('app').style.display = 'block';
            document.getElementById('currentUser').textContent = currentUser.username;
            loadDashboard();
        } else {
            console.log('No user logged in, showing auth modal');
            // Show auth modal by default
            document.getElementById('authModal').style.display = 'block';
            document.getElementById('app').style.display = 'none';
        }
        
        // Close modals when clicking outside
        window.onclick = function(event) {
            const modals = document.querySelectorAll('.modal');
            modals.forEach(modal => {
                if (event.target === modal) {
                    modal.style.display = 'none';
                }
            });
        };
        
        // Ensure auth modal is visible on page load
        setTimeout(() => {
            if (!authToken) {
                document.getElementById('authModal').style.display = 'block';
            }
        }, 100);
        
        console.log('App initialization complete');
    } catch (error) {
        console.error('Error initializing app:', error);
        // Fallback: show auth modal
        document.getElementById('authModal').style.display = 'block';
        document.getElementById('app').style.display = 'none';
    }
}

// Load current user from localStorage
if (localStorage.getItem('currentUser')) {
    currentUser = JSON.parse(localStorage.getItem('currentUser'));
}

// Profile Management Functions
async function loadProfileData() {
    try {
        const response = await apiCall('/api/profile');
        const profileData = response;
        
        document.getElementById('profileUsername').value = profileData.username;
        document.getElementById('profileEmail').value = profileData.email || '';
        document.getElementById('profilePhone').value = profileData.phone || '';
        document.getElementById('profileAddress').value = profileData.address || '';
        
    } catch (error) {
        console.error('Error loading profile data:', error);
        // Fallback to basic data if API fails
        if (currentUser) {
            document.getElementById('profileUsername').value = currentUser.username;
            document.getElementById('profileEmail').value = currentUser.email || '';
        }
    }
}

// Profile form handler
document.getElementById('profileForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const currentPassword = document.getElementById('profileCurrentPassword').value;
    const newPassword = document.getElementById('profileNewPassword').value;
    const confirmPassword = document.getElementById('profileConfirmPassword').value;
    const newEmail = document.getElementById('profileEmail').value;
    const phone = document.getElementById('profilePhone').value;
    const address = document.getElementById('profileAddress').value;
    
    // Validate current password is provided
    if (!currentPassword) {
        showMessage('Current password is required.', 'error');
        return;
    }
    
    // Validate email format
    if (newEmail && !isValidEmail(newEmail)) {
        showMessage('Please enter a valid email address.', 'error');
        return;
    }
    
    // Validate new password if provided
    if (newPassword) {
        if (newPassword.length < 8) {
            showMessage('New password must be at least 8 characters long.', 'error');
            return;
        }
        
        if (newPassword !== confirmPassword) {
            showMessage('New passwords do not match.', 'error');
            return;
        }
        
        // Additional password strength validation
        const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
        if (!passwordRegex.test(newPassword)) {
            showMessage('Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character.', 'error');
            return;
        }
    }
    
    try {
        const updateData = {
            currentPassword,
            email: newEmail,
            phone: phone || null,
            address: address || null
        };
        
        if (newPassword) {
            updateData.newPassword = newPassword;
        }
        
        const response = await apiCall('/api/profile/update', {
            method: 'PUT',
            body: JSON.stringify(updateData)
        });
        
        // Update local user data
        currentUser.email = newEmail;
        localStorage.setItem('currentUser', JSON.stringify(currentUser));
        
        closeModal('profileModal');
        showMessage('Profile updated successfully!');
        
        // Clear form
        document.getElementById('profileForm').reset();
        loadProfileData();
        
    } catch (error) {
        showMessage(`Failed to update profile: ${error.message}`, 'error');
    }
});

// Email validation helper
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

// Function to show stat details popup
async function showStatDetails(statType) {
    try {
        let title, content;
        
        switch(statType) {
            case 'totalProperties':
                const allProperties = await apiCall('/api/properties');
                title = 'All Properties';
                content = `
                    <div class="popup-content">
                        <div class="property-header">
                            <h3>All Properties (${allProperties.length})</h3>
                            <span class="card-status status-available">Total</span>
                        </div>
                        <div class="property-details">
                            ${allProperties.map(property => `
                                <div class="detail-row">
                                    <strong>${property.name}</strong>
                                    <span>${property.address} • ${property.type} • ${property.currency || 'USD'} ${property.rent_amount || 'N/A'}</span>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                `;
                break;
                
            case 'occupiedProperties':
                const occupiedProperties = await apiCall('/api/properties');
                const occupied = occupiedProperties.filter(p => p.status === 'occupied');
                title = 'Occupied Properties';
                content = `
                    <div class="popup-content">
                        <div class="property-header">
                            <h3>Occupied Properties (${occupied.length})</h3>
                            <span class="card-status status-occupied">Occupied</span>
                        </div>
                        <div class="property-details">
                            ${occupied.map(property => `
                                <div class="detail-row">
                                    <strong>${property.name}</strong>
                                    <span>${property.address} • ${property.type} • ${property.currency || 'USD'} ${property.rent_amount || 'N/A'}</span>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                `;
                break;
                
            case 'vacantProperties':
                const vacantProperties = await apiCall('/api/properties');
                const vacant = vacantProperties.filter(p => p.status === 'vacant');
                title = 'Vacant Properties';
                content = `
                    <div class="popup-content">
                        <div class="property-header">
                            <h3>Vacant Properties (${vacant.length})</h3>
                            <span class="card-status status-vacant">Vacant</span>
                        </div>
                        <div class="property-details">
                            ${vacant.map(property => `
                                <div class="detail-row">
                                    <strong>${property.name}</strong>
                                    <span>${property.address} • ${property.type} • ${property.currency || 'USD'} ${property.rent_amount || 'N/A'}</span>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                `;
                break;
                
            case 'activeTenants':
                const allTenants = await apiCall('/api/tenants');
                const activeTenants = allTenants.filter(t => t.status === 'active');
                title = 'Active Tenants';
                content = `
                    <div class="popup-content">
                        <div class="property-header">
                            <h3>Active Tenants (${activeTenants.length})</h3>
                            <span class="card-status status-active">Active</span>
                        </div>
                        <div class="property-details">
                            ${activeTenants.map(tenant => `
                                <div class="detail-row">
                                    <strong>${tenant.first_name} ${tenant.last_name}</strong>
                                    <span>${tenant.email} • ${tenant.nationality} • ${tenant.currency || 'USD'} ${tenant.rent_amount || 'N/A'}</span>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                `;
                break;
                
            case 'pendingMaintenance':
                const allMaintenance = await apiCall('/api/maintenance');
                const pendingMaintenance = allMaintenance.filter(m => m.status === 'pending');
                title = 'Pending Maintenance';
                content = `
                    <div class="popup-content">
                        <div class="property-header">
                            <h3>Pending Maintenance (${pendingMaintenance.length})</h3>
                            <span class="card-status status-pending">Pending</span>
                        </div>
                        <div class="property-details">
                            ${pendingMaintenance.map(maintenance => `
                                <div class="detail-row">
                                    <strong>${maintenance.title}</strong>
                                    <span>${maintenance.property_name} • ${maintenance.priority} • ${formatDate(maintenance.created_at)}</span>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                `;
                break;
                
            case 'pendingRent':
                const pendingRent = dashboardData.pendingRentProperties || [];
                title = 'Pending Rent';
                content = `
                    <div class="popup-content">
                        <div class="property-header">
                            <h3>Pending Rent (${pendingRent.length})</h3>
                            <span class="card-status status-pending">Pending</span>
                        </div>
                        <div class="property-details">
                            ${pendingRent.map(property => `
                                <div class="detail-row">
                                    <strong>${property.name}</strong>
                                    <span>${property.first_name} ${property.last_name} • ${property.currency || 'USD'} ${property.rent_amount || 'N/A'}</span>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                `;
                break;
        }
        
        showCustomPopup(title, content, true);
        
    } catch (error) {
        console.error('Error loading stat details:', error);
        showMessage('Failed to load details', 'error');
    }
}

// Function to open rent properties popup
function openRentPropertiesPopup() {
    const pendingRent = dashboardData.pendingRentProperties || [];
    const rentPaid = dashboardData.rentPaidProperties || [];
    
    const title = 'Rent Properties Overview';
    const content = `
        <div class="rent-popup-content">
            <div class="rent-popup-header">
                <div class="rent-stats">
                    <div class="rent-stat pending">
                        <i class="fas fa-clock"></i>
                        <div class="stat-info">
                            <span class="stat-number">${pendingRent.length}</span>
                            <span class="stat-label">Pending</span>
                        </div>
                    </div>
                    <div class="rent-stat paid">
                        <i class="fas fa-check-circle"></i>
                        <div class="stat-info">
                            <span class="stat-number">${rentPaid.length}</span>
                            <span class="stat-label">Paid</span>
                        </div>
                    </div>
                    <div class="rent-stat total">
                        <i class="fas fa-home"></i>
                        <div class="stat-info">
                            <span class="stat-number">${pendingRent.length + rentPaid.length}</span>
                            <span class="stat-label">Total</span>
                        </div>
                    </div>
                </div>
            </div>
            
            <div class="rent-popup-body">
                <div class="rent-sections">
                    <div class="rent-section">
                        <h3><i class="fas fa-clock" style="color: #ffc107;"></i> Pending Rent Properties</h3>
                        <div class="property-list">
                            ${pendingRent.length > 0 ? pendingRent.map(property => `
                                <div class="property-item pending">
                                    <h4>${property.name}</h4>
                                    <div class="property-details">
                                        <div class="property-detail">
                                            <span>Tenant:</span>
                                            <span>${property.first_name} ${property.last_name}</span>
                                        </div>
                                        <div class="property-detail">
                                            <span>Email:</span>
                                            <span>${property.email}</span>
                                        </div>
                                        <div class="property-detail">
                                            <span>Rent Amount:</span>
                                            <span>${property.currency} ${property.rent_amount?.toLocaleString() || 'N/A'}</span>
                                        </div>
                                        <div class="property-detail">
                                            <span>Status:</span>
                                            <span>${property.status || 'N/A'}</span>
                                        </div>
                                    </div>
                                </div>
                            `).join('') : `
                                <div class="empty-state">
                                    <i class="fas fa-check-circle"></i>
                                    <h3>No Pending Rent</h3>
                                    <p>All properties have received their rent payments</p>
                                </div>
                            `}
                        </div>
                    </div>
                    
                    <div class="rent-section">
                        <h3><i class="fas fa-check-circle" style="color: #28a745;"></i> Rent Paid Properties</h3>
                        <div class="property-list">
                            ${rentPaid.length > 0 ? rentPaid.map(property => `
                                <div class="property-item paid">
                                    <h4>${property.name}</h4>
                                    <div class="property-details">
                                        <div class="property-detail">
                                            <span>Tenant:</span>
                                            <span>${property.first_name} ${property.last_name}</span>
                                        </div>
                                        <div class="property-detail">
                                            <span>Payment Amount:</span>
                                            <span>${property.currency} ${property.payment_amount?.toLocaleString() || 'N/A'}</span>
                                        </div>
                                        <div class="property-detail">
                                            <span>Payment Method:</span>
                                            <span>${property.payment_method}</span>
                                        </div>
                                        <div class="property-detail">
                                            <span>Payment Date:</span>
                                            <span>${formatDate(property.payment_date)}</span>
                                        </div>
                                    </div>
                                </div>
                            `).join('') : `
                                <div class="empty-state">
                                    <i class="fas fa-exclamation-circle"></i>
                                    <h3>No Rent Paid</h3>
                                    <p>No properties have received rent payments yet</p>
                                </div>
                            `}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    showCustomPopup(title, content);
}

// Initialize the app when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM loaded, initializing app...');
    console.log('Auth token:', authToken);
    console.log('Current user:', currentUser);
    initApp();
});

// ===== DATA SHARING FUNCTIONS =====

// Export all data to Excel file
async function exportAllData() {
    try {
        showMessage('Preparing data export...', 'info');
        
        // Fetch all data from different endpoints
        const [properties, tenants, maintenance, financial, rentTracking] = await Promise.all([
            apiCall('/api/properties'),
            apiCall('/api/tenants'),
            apiCall('/api/maintenance'),
            apiCall('/api/financial'),
            apiCall('/api/rent-tracking')
        ]);
        
        // Create workbook with multiple sheets
        const workbook = XLSX.utils.book_new();
        
        // Add properties sheet - ALL FIELDS INCLUDED
        const propertiesWS = XLSX.utils.json_to_sheet(properties.map(p => ({
            'Property ID': p.id,
            'User ID': p.user_id,
            'Name': p.name,
            'Address': p.address,
            'Type': p.type,
            'Status': p.status,
            'Bedrooms': p.bedrooms,
            'Bathrooms': p.bathrooms,
            'Square Feet': p.square_feet,
            'Rent Amount': p.rent_amount,
            'Currency': p.currency,
            'Electricity Number': p.electricity_number,
            'Water Number': p.water_number,
            'Created At': p.created_at
        })));
        XLSX.utils.book_append_sheet(workbook, propertiesWS, 'Properties');
        
        // Add tenants sheet - ALL FIELDS INCLUDED with property relationships
        const tenantsWS = XLSX.utils.json_to_sheet(tenants.map(t => {
            // Find the associated property to get complete property details
            const associatedProperty = properties.find(p => p.id === t.property_id);
            return {
                'Tenant ID': t.id,
                'User ID': t.user_id,
                'First Name': t.first_name,
                'Last Name': t.last_name,
                'Email': t.email,
                'Phone': t.phone,
                'Nationality': t.nationality,
                'Property ID': t.property_id,
                'Property Name': associatedProperty ? associatedProperty.name : t.property_name,
                'Property Address': associatedProperty ? associatedProperty.address : '',
                'Property Type': associatedProperty ? associatedProperty.type : '',
                'Property Status': associatedProperty ? associatedProperty.status : '',
                'Lease Start Date': t.lease_start,
                'Lease End Date': t.lease_end,
                'Rent Amount': t.rent_amount,
                'Currency': t.currency,
                'Status': t.status,
                'Free Month Type': t.free_month_type,
                'Free Month Date': t.free_month_date,
                'Created At': t.created_at
            };
        }));
        XLSX.utils.book_append_sheet(workbook, tenantsWS, 'Tenants');
        
        // Add maintenance sheet - ALL FIELDS INCLUDED with property and tenant relationships
        const maintenanceWS = XLSX.utils.json_to_sheet(maintenance.map(m => {
            // Find the associated property and tenant
            const associatedProperty = properties.find(p => p.id === m.property_id);
            const associatedTenant = tenants.find(t => t.id === m.tenant_id);
            return {
                'Maintenance ID': m.id,
                'User ID': m.user_id,
                'Title': m.title,
                'Description': m.description,
                'Property ID': m.property_id,
                'Property Name': associatedProperty ? associatedProperty.name : m.property_name,
                'Property Address': associatedProperty ? associatedProperty.address : '',
                'Property Type': associatedProperty ? associatedProperty.type : '',
                'Property Status': associatedProperty ? associatedProperty.status : '',
                'Tenant ID': m.tenant_id,
                'Tenant Name': associatedTenant ? `${associatedTenant.first_name} ${associatedTenant.last_name}`.trim() : m.tenant_name,
                'Tenant Email': associatedTenant ? associatedTenant.email : '',
                'Tenant Phone': associatedTenant ? associatedTenant.phone : '',
                'Priority': m.priority,
                'Status': m.status,
                'Created At': m.created_at,
                'Completed At': m.completed_at
            };
        }));
        XLSX.utils.book_append_sheet(workbook, maintenanceWS, 'Maintenance');
        
        // Add financial sheet - ALL FIELDS INCLUDED with property and tenant relationships
        const financialWS = XLSX.utils.json_to_sheet(financial.map(f => {
            // Find the associated property and tenant
            const associatedProperty = properties.find(p => p.id === f.property_id);
            const associatedTenant = tenants.find(t => t.id === f.tenant_id);
            return {
                'Financial ID': f.id,
                'User ID': f.user_id,
                'Property ID': f.property_id,
                'Property Name': associatedProperty ? associatedProperty.name : f.property_name,
                'Property Address': associatedProperty ? associatedProperty.address : '',
                'Property Type': associatedProperty ? associatedProperty.type : '',
                'Property Status': associatedProperty ? associatedProperty.status : '',
                'Tenant ID': f.tenant_id,
                'Tenant Name': associatedTenant ? `${associatedTenant.first_name} ${associatedTenant.last_name}`.trim() : f.tenant_name,
                'Tenant Email': associatedTenant ? associatedTenant.email : '',
                'Tenant Phone': associatedTenant ? associatedTenant.phone : '',
                'Transaction Type': f.type,
                'Amount': f.amount,
                'Currency': f.currency,
                'Description': f.description,
                'Date': f.date,
                'Created At': f.created_at
            };
        }));
        XLSX.utils.book_append_sheet(workbook, financialWS, 'Financial');
        
        // Add rent tracking sheet - ALL FIELDS INCLUDED with property and tenant relationships
        const rentTrackingWS = XLSX.utils.json_to_sheet(rentTracking.map(rt => {
            // Find the associated property and tenant
            const associatedProperty = properties.find(p => p.id === rt.property_id);
            const associatedTenant = tenants.find(t => t.id === rt.tenant_id);
            return {
                'Rent Tracking ID': rt.id,
                'User ID': rt.user_id,
                'Property ID': rt.property_id,
                'Property Name': associatedProperty ? associatedProperty.name : '',
                'Property Address': associatedProperty ? associatedProperty.address : '',
                'Property Type': associatedProperty ? associatedProperty.type : '',
                'Property Status': associatedProperty ? associatedProperty.status : '',
                'Tenant ID': rt.tenant_id,
                'Tenant Name': associatedTenant ? `${associatedTenant.first_name} ${associatedTenant.last_name}`.trim() : '',
                'Tenant Email': associatedTenant ? associatedTenant.email : '',
                'Tenant Phone': associatedTenant ? associatedTenant.phone : '',
                'Rent Month': rt.rent_month,
                'Due Date': rt.due_date,
                'Total Amount': rt.total_amount,
                'Currency': rt.currency,
                'Payment Method': rt.payment_method,
                'Payment Amount': rt.payment_amount,
                'Payment Date': rt.payment_date,
                'Cash Received By': rt.cash_received_by || '',
                'Cash Receipt Number': rt.cash_receipt_number || '',
                'Cheque Number': rt.cheque_number || '',
                'Cheque Bank': rt.cheque_bank || '',
                'Cheque Date': rt.cheque_date || '',
                'Cheque Status': rt.cheque_status || '',
                'Online Reference': rt.online_reference || '',
                'Online Bank': rt.online_bank || '',
                'Partial Reason': rt.partial_reason || '',
                'Partial Balance': rt.partial_balance || '',
                'Partial Notes': rt.partial_notes || '',
                'Notes': rt.notes || '',
                'Created At': rt.created_at
            };
        }));
        XLSX.utils.book_append_sheet(workbook, rentTrackingWS, 'Rent Tracking');
        
        // Generate filename with timestamp
        const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
        const filename = `property_management_data_${timestamp}.xlsx`;
        
        // Download the file
        XLSX.writeFile(workbook, filename);
        
        showMessage('Data exported successfully!', 'success');
        
    } catch (error) {
        console.error('Error exporting data:', error);
        showMessage('Failed to export data', 'error');
    }
}

// Export data by category
async function exportDataByCategory(category) {
    try {
        showMessage(`Preparing ${category} export...`, 'info');
        
        let data, filename, worksheet;
        
        switch (category) {
            case 'properties':
                data = await apiCall('/api/properties');
                filename = `properties_export_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.xlsx`;
                worksheet = XLSX.utils.json_to_sheet(data.map(p => ({
                    'Property ID': p.id,
                    'User ID': p.user_id,
                    'Name': p.name,
                    'Address': p.address,
                    'Type': p.type,
                    'Status': p.status,
                    'Bedrooms': p.bedrooms,
                    'Bathrooms': p.bathrooms,
                    'Square Feet': p.square_feet,
                    'Rent Amount': p.rent_amount,
                    'Currency': p.currency,
                    'Electricity Number': p.electricity_number,
                    'Water Number': p.water_number,
                    'Created At': p.created_at
                })));
                break;
                
            case 'tenants':
                const [tenantsData, propertiesData] = await Promise.all([
                    apiCall('/api/tenants'),
                    apiCall('/api/properties')
                ]);
                filename = `tenants_export_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.xlsx`;
                worksheet = XLSX.utils.json_to_sheet(tenantsData.map(t => {
                    // Find the associated property to get complete property details
                    const associatedProperty = propertiesData.find(p => p.id === t.property_id);
                    return {
                        'Tenant ID': t.id,
                        'User ID': t.user_id,
                        'First Name': t.first_name,
                        'Last Name': t.last_name,
                        'Email': t.email,
                        'Phone': t.phone,
                        'Nationality': t.nationality,
                        'Property ID': t.property_id,
                        'Property Name': associatedProperty ? associatedProperty.name : t.property_name,
                        'Property Address': associatedProperty ? associatedProperty.address : '',
                        'Property Type': associatedProperty ? associatedProperty.type : '',
                        'Property Status': associatedProperty ? associatedProperty.status : '',
                        'Lease Start Date': t.lease_start,
                        'Lease End Date': t.lease_end,
                        'Rent Amount': t.rent_amount,
                        'Currency': t.currency,
                        'Status': t.status,
                        'Free Month Type': t.free_month_type,
                        'Free Month Date': t.free_month_date,
                        'Created At': t.created_at
                    };
                }));
                break;
                
            case 'maintenance':
                const [maintenanceData, maintenanceProperties, maintenanceTenants] = await Promise.all([
                    apiCall('/api/maintenance'),
                    apiCall('/api/properties'),
                    apiCall('/api/tenants')
                ]);
                filename = `maintenance_export_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.xlsx`;
                worksheet = XLSX.utils.json_to_sheet(maintenanceData.map(m => {
                    // Find the associated property and tenant
                    const associatedProperty = maintenanceProperties.find(p => p.id === m.property_id);
                    const associatedTenant = maintenanceTenants.find(t => t.id === m.tenant_id);
                    return {
                        'Maintenance ID': m.id,
                        'User ID': m.user_id,
                        'Title': m.title,
                        'Description': m.description,
                        'Property ID': m.property_id,
                        'Property Name': associatedProperty ? associatedProperty.name : m.property_name,
                        'Property Address': associatedProperty ? associatedProperty.address : '',
                        'Property Type': associatedProperty ? associatedProperty.type : '',
                        'Property Status': associatedProperty ? associatedProperty.status : '',
                        'Tenant ID': m.tenant_id,
                        'Tenant Name': associatedTenant ? `${associatedTenant.first_name} ${associatedTenant.last_name}`.trim() : m.tenant_name,
                        'Tenant Email': associatedTenant ? associatedTenant.email : '',
                        'Tenant Phone': associatedTenant ? associatedTenant.phone : '',
                        'Priority': m.priority,
                        'Status': m.status,
                        'Created At': m.created_at,
                        'Completed At': m.completed_at
                    };
                }));
                break;
                
            case 'financial':
                const [financialData, financialProperties, financialTenants, financialRentTrackingData] = await Promise.all([
                    apiCall('/api/financial'),
                    apiCall('/api/properties'),
                    apiCall('/api/tenants'),
                    apiCall('/api/rent-tracking')
                ]);
                filename = `financial_export_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.xlsx`;
                
                // Combine financial data with rent tracking data for comprehensive export
                const enhancedFinancialData = financialData.map(f => {
                    // Find the associated property and tenant
                    const associatedProperty = financialProperties.find(p => p.id === f.property_id);
                    const associatedTenant = financialTenants.find(t => t.id === f.tenant_id);
                    
                    // Find related rent tracking data for this financial record
                    const relatedRentTracking = financialRentTrackingData.find(rt => 
                        rt.property_id === f.property_id && 
                        rt.tenant_id === f.tenant_id &&
                        rt.payment_date === f.date
                    );
                    
                    return {
                        'Financial ID': f.id,
                        'User ID': f.user_id,
                        'Property ID': f.property_id,
                        'Property Name': associatedProperty ? associatedProperty.name : f.property_name,
                        'Property Address': associatedProperty ? associatedProperty.address : '',
                        'Property Type': associatedProperty ? associatedProperty.type : '',
                        'Property Status': associatedProperty ? associatedProperty.status : '',
                        'Tenant ID': f.tenant_id,
                        'Tenant Name': associatedTenant ? `${associatedTenant.first_name} ${associatedTenant.last_name}`.trim() : f.tenant_name,
                        'Tenant Email': associatedTenant ? associatedTenant.email : '',
                        'Tenant Phone': associatedTenant ? associatedTenant.phone : '',
                        'Transaction Type': f.type,
                        'Amount': f.amount,
                        'Currency': f.currency,
                        'Description': f.description,
                        'Date': f.date,
                        'Created At': f.created_at,
                        // Enhanced with Rent Payment Details
                        'Rent Month': relatedRentTracking ? relatedRentTracking.rent_month : '',
                        'Due Date': relatedRentTracking ? relatedRentTracking.due_date : '',
                        'Total Rent Amount': relatedRentTracking ? relatedRentTracking.total_amount : '',
                        'Payment Method': relatedRentTracking ? relatedRentTracking.payment_method : '',
                        'Payment Amount': relatedRentTracking ? relatedRentTracking.payment_amount : '',
                        'Payment Date': relatedRentTracking ? relatedRentTracking.payment_date : '',
                        'Cash Received By': relatedRentTracking ? (relatedRentTracking.cash_received_by || '') : '',
                        'Cash Receipt Number': relatedRentTracking ? (relatedRentTracking.cash_receipt_number || '') : '',
                        'Cheque Number': relatedRentTracking ? (relatedRentTracking.cheque_number || '') : '',
                        'Cheque Bank': relatedRentTracking ? (relatedRentTracking.cheque_bank || '') : '',
                        'Cheque Date': relatedRentTracking ? (relatedRentTracking.cheque_date || '') : '',
                        'Cheque Status': relatedRentTracking ? (relatedRentTracking.cheque_status || '') : '',
                        'Online Reference': relatedRentTracking ? (relatedRentTracking.online_reference || '') : '',
                        'Online Bank': relatedRentTracking ? (relatedRentTracking.online_bank || '') : '',
                        'Partial Reason': relatedRentTracking ? (relatedRentTracking.partial_reason || '') : '',
                        'Partial Balance': relatedRentTracking ? (relatedRentTracking.partial_balance || '') : '',
                        'Partial Notes': relatedRentTracking ? (relatedRentTracking.partial_notes || '') : '',
                        'Rent Payment Notes': relatedRentTracking ? (relatedRentTracking.notes || '') : ''
                    };
                });
                
                worksheet = XLSX.utils.json_to_sheet(enhancedFinancialData);
                break;
                
            case 'rent-tracking':
                const [rentTrackingData, rentTrackingProperties, rentTrackingTenants] = await Promise.all([
                    apiCall('/api/rent-tracking'),
                    apiCall('/api/properties'),
                    apiCall('/api/tenants')
                ]);
                filename = `rent_tracking_export_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.xlsx`;
                worksheet = XLSX.utils.json_to_sheet(rentTrackingData.map(rt => {
                    // Find the associated property and tenant
                    const associatedProperty = rentTrackingProperties.find(p => p.id === rt.property_id);
                    const associatedTenant = rentTrackingTenants.find(t => t.id === rt.tenant_id);
                    return {
                        'Rent Tracking ID': rt.id,
                        'User ID': rt.user_id,
                        'Property ID': rt.property_id,
                        'Property Name': associatedProperty ? associatedProperty.name : '',
                        'Property Address': associatedProperty ? associatedProperty.address : '',
                        'Property Type': associatedProperty ? associatedProperty.type : '',
                        'Property Status': associatedProperty ? associatedProperty.status : '',
                        'Tenant ID': rt.tenant_id,
                        'Tenant Name': associatedTenant ? `${associatedTenant.first_name} ${associatedTenant.last_name}`.trim() : '',
                        'Tenant Email': associatedTenant ? associatedTenant.email : '',
                        'Tenant Phone': associatedTenant ? associatedTenant.phone : '',
                        'Rent Month': rt.rent_month,
                        'Due Date': rt.due_date,
                        'Total Amount': rt.total_amount,
                        'Currency': rt.currency,
                        'Payment Method': rt.payment_method,
                        'Payment Amount': rt.payment_amount,
                        'Payment Date': rt.payment_date,
                        'Cash Received By': rt.cash_received_by || '',
                        'Cash Receipt Number': rt.cash_receipt_number || '',
                        'Cheque Number': rt.cheque_number || '',
                        'Cheque Bank': rt.cheque_bank || '',
                        'Cheque Date': rt.cheque_date || '',
                        'Cheque Status': rt.cheque_status || '',
                        'Online Reference': rt.online_reference || '',
                        'Online Bank': rt.online_bank || '',
                        'Partial Reason': rt.partial_reason || '',
                        'Partial Balance': rt.partial_balance || '',
                        'Partial Notes': rt.partial_notes || '',
                        'Notes': rt.notes || '',
                        'Created At': rt.created_at
                    };
                }));
                break;
                
            default:
                throw new Error('Invalid category');
        }
        
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, category.charAt(0).toUpperCase() + category.slice(1));
        XLSX.writeFile(workbook, filename);
        
        showMessage(`${category.charAt(0).toUpperCase() + category.slice(1)} exported successfully!`, 'success');
        
    } catch (error) {
        console.error(`Error exporting ${category}:`, error);
        showMessage(`Failed to export ${category}`, 'error');
    }
}

// Generate share link
async function generateShareLink() {
    try {
        const recipientEmail = document.getElementById('shareAccountEmail').value;
        
        // Call server to create share
        const response = await apiCall('/api/share-data', {
            method: 'POST',
            body: JSON.stringify({
                recipientEmail: recipientEmail,
                dataType: 'all',
                expiresIn: 7 * 24 * 60 * 60 * 1000 // 7 days
            })
        });
        
        // Display the results
        document.getElementById('shareLinkText').value = response.shareLink;
        document.getElementById('shareCodeText').value = response.shareToken;
        document.getElementById('shareResult').style.display = 'block';
        
        showMessage('Share link generated successfully!', 'success');
        
    } catch (error) {
        console.error('Error generating share link:', error);
        showMessage('Failed to generate share link', 'error');
    }
}

// Generate share code
async function generateShareCode() {
    try {
        const recipientEmail = document.getElementById('shareAccountEmail').value;
        
        // Call server to create share
        const response = await apiCall('/api/share-data', {
            method: 'POST',
            body: JSON.stringify({
                recipientEmail: recipientEmail,
                dataType: 'all',
                expiresIn: 7 * 24 * 60 * 60 * 1000 // 7 days
            })
        });
        
        // Display the results
        document.getElementById('shareLinkText').value = response.shareLink;
        document.getElementById('shareCodeText').value = response.shareToken;
        document.getElementById('shareResult').style.display = 'block';
        
        showMessage('Share code generated successfully!', 'success');
        
    } catch (error) {
        console.error('Error generating share code:', error);
        showMessage('Failed to generate share code', 'error');
    }
}

// Copy share link to clipboard
function copyShareLink() {
    const shareLinkInput = document.getElementById('shareLinkText');
    shareLinkInput.select();
    shareLinkInput.setSelectionRange(0, 99999); // For mobile devices
    
    try {
        document.execCommand('copy');
        showMessage('Share link copied to clipboard!', 'success');
    } catch (err) {
        showMessage('Failed to copy link', 'error');
    }
}

// Copy share code to clipboard
function copyShareCode() {
    const shareCodeInput = document.getElementById('shareCodeText');
    shareCodeInput.select();
    shareCodeInput.setSelectionRange(0, 99999); // For mobile devices
    
    try {
        document.execCommand('copy');
        showMessage('Share code copied to clipboard!', 'success');
    } catch (err) {
        showMessage('Failed to copy code', 'error');
    }
}

// Import shared data
async function importSharedData() {
    try {
        const shareInput = document.getElementById('importShareLink').value.trim();
        
        if (!shareInput) {
            showMessage('Please enter a share link or code', 'error');
            return;
        }
        
        // Extract token from input (could be full URL or just token)
        let shareToken = shareInput;
        if (shareInput.includes('share=')) {
            shareToken = shareInput.split('share=')[1].split('&')[0];
        }
        
        showMessage('Importing shared data...', 'info');
        
        // Call server to import shared data
        const response = await apiCall('/api/import-shared-data', {
            method: 'POST',
            body: JSON.stringify({
                shareToken: shareToken
            })
        });
        
        showMessage(`Successfully imported ${response.importedCount} items!`, 'success');
        
        // Clear the input
        document.getElementById('importShareLink').value = '';
        
        // Refresh dashboard to show imported data
        if (response.importedCount > 0) {
            setTimeout(() => {
                loadDashboard();
            }, 1000);
        }
        
    } catch (error) {
        console.error('Error importing shared data:', error);
        showMessage('Failed to import shared data', 'error');
    }
}

// Handle imported exported Excel file
function handleExportedExcelImport(event) {
    const file = event.target.files[0];
    if (!file) return;

    // Validate file type
    if (!file.name.match(/\.(xlsx|xls)$/)) {
        showMessage('Please select a valid Excel file (.xlsx or .xls)', 'error');
        return;
    }

    // Validate file size (5MB limit)
    if (file.size > 5 * 1024 * 1024) {
        showMessage('File size must be less than 5MB', 'error');
        return;
    }

    // Show upload status
    const statusDiv = document.getElementById('importExcelStatus');
    const messageDiv = statusDiv.querySelector('.upload-message');
    const progressBar = statusDiv.querySelector('.progress-fill');
    const progressText = statusDiv.querySelector('.progress-text');
    
    statusDiv.style.display = 'block';
    messageDiv.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing exported Excel file...';
    messageDiv.className = 'upload-message info';

    // Simulate progress
    let progress = 0;
    const progressInterval = setInterval(() => {
        progress += Math.random() * 15;
        if (progress > 90) progress = 90;
        progressBar.style.width = progress + '%';
        progressText.textContent = Math.round(progress) + '%';
    }, 200);

    // Read the file
    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            
            // Process each sheet
            const results = {
                properties: { imported: 0, errors: [] },
                tenants: { imported: 0, errors: [] },
                maintenance: { imported: 0, errors: [] },
                financial: { imported: 0, errors: [] },
                rentTracking: { imported: 0, errors: [] }
            };

            // Process Properties sheet
            if (workbook.Sheets['Properties']) {
                const propertiesData = XLSX.utils.sheet_to_json(workbook.Sheets['Properties']);
                for (const property of propertiesData) {
                    try {
                        // Check if property already exists
                        const existingProperties = await apiCall('/api/properties');
                        const existingProperty = existingProperties.find(p => 
                            p.name === property['Name'] && 
                            p.address === property['Address']
                        );
                        
                        if (existingProperty) {
                            // Update existing property with new status and data
                            await apiCall(`/api/properties/${existingProperty.id}`, {
                                method: 'PUT',
                                body: JSON.stringify({
                                    name: property['Name'],
                                    address: property['Address'],
                                    type: property['Type'],
                                    status: property['Status'], // This will update the status
                                    bedrooms: property['Bedrooms'],
                                    bathrooms: property['Bathrooms'],
                                    electricity_number: property['Electricity Number'],
                                    water_number: property['Water Number'],
                                    square_feet: property['Square Feet'],
                                    rent_amount: property['Rent Amount'],
                                    currency: property['Currency']
                                })
                            });
                            results.properties.imported++;
                        } else {
                            // Create new property if it doesn't exist
                            await apiCall('/api/properties', {
                                method: 'POST',
                                body: JSON.stringify({
                                    name: property['Name'],
                                    address: property['Address'],
                                    type: property['Type'],
                                    status: property['Status'],
                                    bedrooms: property['Bedrooms'],
                                    bathrooms: property['Bathrooms'],
                                    electricity_number: property['Electricity Number'],
                                    water_number: property['Water Number'],
                                    square_feet: property['Square Feet'],
                                    rent_amount: property['Rent Amount'],
                                    currency: property['Currency']
                                })
                            });
                            results.properties.imported++;
                        }
                    } catch (error) {
                        results.properties.errors.push(`Property ${property['Name']}: ${error.message}`);
                    }
                }
            }

            // Process Tenants sheet with property relationships
            if (workbook.Sheets['Tenants']) {
                const tenantsData = XLSX.utils.sheet_to_json(workbook.Sheets['Tenants']);
                for (const tenant of tenantsData) {
                    try {
                        // First, find or create the property if it exists
                        let propertyId = null;
                        if (tenant['Property Name'] && tenant['Property Address']) {
                            try {
                                // Try to find existing property by name and address
                                const existingProperties = await apiCall('/api/properties');
                                const existingProperty = existingProperties.find(p => 
                                    p.name === tenant['Property Name'] && 
                                    p.address === tenant['Property Address']
                                );
                                
                                if (existingProperty) {
                                    propertyId = existingProperty.id;
                                } else {
                                    // Create the property if it doesn't exist
                                    const newProperty = await apiCall('/api/properties', {
                                        method: 'POST',
                                        body: JSON.stringify({
                                            name: tenant['Property Name'],
                                            address: tenant['Property Address'],
                                            type: tenant['Property Type'] || 'villa',
                                            status: tenant['Property Status'] || 'occupied',
                                            bedrooms: null,
                                            bathrooms: null,
                                            square_feet: null,
                                            rent_amount: tenant['Rent Amount'],
                                            currency: tenant['Currency'] || 'USD',
                                            electricity_number: null,
                                            water_number: null
                                        })
                                    });
                                    propertyId = newProperty.id;
                                }
                            } catch (propertyError) {
                                console.log(`Could not create/find property for tenant ${tenant['First Name']}:`, propertyError);
                            }
                        }
                        
                        // Check if tenant already exists
                        const existingTenants = await apiCall('/api/tenants');
                        const existingTenant = existingTenants.find(t => 
                            t.email === tenant['Email'] && 
                            t.first_name === tenant['First Name'] && 
                            t.last_name === tenant['Last Name']
                        );
                        
                        if (existingTenant) {
                            // Update existing tenant
                            await apiCall(`/api/tenants/${existingTenant.id}`, {
                                method: 'PUT',
                                body: JSON.stringify({
                                    first_name: tenant['First Name'],
                                    last_name: tenant['Last Name'],
                                    email: tenant['Email'],
                                    phone: tenant['Phone'],
                                    nationality: tenant['Nationality'],
                                    property_id: propertyId,
                                    rent_amount: tenant['Rent Amount'],
                                    currency: tenant['Currency'],
                                    lease_start_date: tenant['Lease Start Date'],
                                    lease_end_date: tenant['Lease End Date'],
                                    status: tenant['Status']
                                })
                            });
                        } else {
                            // Create new tenant
                            await apiCall('/api/tenants', {
                                method: 'POST',
                                body: JSON.stringify({
                                    first_name: tenant['First Name'],
                                    last_name: tenant['Last Name'],
                                    email: tenant['Email'],
                                    phone: tenant['Phone'],
                                    nationality: tenant['Nationality'],
                                    property_id: propertyId,
                                    rent_amount: tenant['Rent Amount'],
                                    currency: tenant['Currency'],
                                    lease_start_date: tenant['Lease Start Date'],
                                    lease_end_date: tenant['Lease End Date'],
                                    status: tenant['Status']
                                })
                            });
                        }
                        results.tenants.imported++;
                    } catch (error) {
                        results.tenants.errors.push(`Tenant ${tenant['First Name']} ${tenant['Last Name']}: ${error.message}`);
                    }
                }
            }

            // Process Maintenance sheet with property and tenant relationships
            if (workbook.Sheets['Maintenance']) {
                const maintenanceData = XLSX.utils.sheet_to_json(workbook.Sheets['Maintenance']);
                for (const maintenance of maintenanceData) {
                    try {
                        // Find property and tenant IDs
                        let propertyId = null;
                        let tenantId = null;
                        
                        if (maintenance['Property Name'] && maintenance['Property Address']) {
                            try {
                                const existingProperties = await apiCall('/api/properties');
                                const existingProperty = existingProperties.find(p => 
                                    p.name === maintenance['Property Name'] && 
                                    p.address === maintenance['Property Address']
                                );
                                if (existingProperty) {
                                    propertyId = existingProperty.id;
                                }
                            } catch (propertyError) {
                                console.log(`Could not find property for maintenance ${maintenance['Title']}:`, propertyError);
                            }
                        }
                        
                        if (maintenance['Tenant Email']) {
                            try {
                                const existingTenants = await apiCall('/api/tenants');
                                const existingTenant = existingTenants.find(t => 
                                    t.email === maintenance['Tenant Email']
                                );
                                if (existingTenant) {
                                    tenantId = existingTenant.id;
                                }
                            } catch (tenantError) {
                                console.log(`Could not find tenant for maintenance ${maintenance['Title']}:`, tenantError);
                            }
                        }
                        
                        // Check if maintenance record already exists
                        const existingMaintenance = await apiCall('/api/maintenance');
                        const existingMaintenanceRecord = existingMaintenance.find(m => 
                            m.title === maintenance['Title'] && 
                            m.description === maintenance['Description'] &&
                            m.property_id === propertyId
                        );
                        
                        if (existingMaintenanceRecord) {
                            // Update existing maintenance record
                            await apiCall(`/api/maintenance/${existingMaintenanceRecord.id}`, {
                                method: 'PUT',
                                body: JSON.stringify({
                                    title: maintenance['Title'],
                                    description: maintenance['Description'],
                                    property_id: propertyId,
                                    tenant_id: tenantId,
                                    priority: maintenance['Priority'],
                                    status: maintenance['Status']
                                })
                            });
                        } else {
                            // Create new maintenance record
                            await apiCall('/api/maintenance', {
                                method: 'POST',
                                body: JSON.stringify({
                                    title: maintenance['Title'],
                                    description: maintenance['Description'],
                                    property_id: propertyId,
                                    tenant_id: tenantId,
                                    priority: maintenance['Priority'],
                                    status: maintenance['Status']
                                })
                            });
                        }
                        results.maintenance.imported++;
                    } catch (error) {
                        results.maintenance.errors.push(`Maintenance ${maintenance['Title']}: ${error.message}`);
                    }
                }
            }

            // Process Financial sheet with property and tenant relationships
            if (workbook.Sheets['Financial']) {
                const financialData = XLSX.utils.sheet_to_json(workbook.Sheets['Financial']);
                for (const financial of financialData) {
                    try {
                        // Find property and tenant IDs
                        let propertyId = null;
                        let tenantId = null;
                        
                        if (financial['Property Name'] && financial['Property Address']) {
                            try {
                                const existingProperties = await apiCall('/api/properties');
                                const existingProperty = existingProperties.find(p => 
                                    p.name === financial['Property Name'] && 
                                    p.address === financial['Property Address']
                                );
                                if (existingProperty) {
                                    propertyId = existingProperty.id;
                                }
                            } catch (propertyError) {
                                console.log(`Could not find property for financial record:`, propertyError);
                            }
                        }
                        
                        if (financial['Tenant Email']) {
                            try {
                                const existingTenants = await apiCall('/api/tenants');
                                const existingTenant = existingTenants.find(t => 
                                    t.email === financial['Tenant Email']
                                );
                                if (existingTenant) {
                                    tenantId = existingTenant.id;
                                }
                            } catch (tenantError) {
                                console.log(`Could not find tenant for financial record:`, tenantError);
                            }
                        }
                        
                        // Check if financial record already exists
                        const existingFinancial = await apiCall('/api/financial');
                        const existingFinancialRecord = existingFinancial.find(f => 
                            f.type === financial['Transaction Type'] &&
                            f.amount === financial['Amount'] &&
                            f.property_id === propertyId &&
                            f.date === financial['Date']
                        );
                        
                        if (existingFinancialRecord) {
                            // Update existing financial record
                            await apiCall(`/api/financial/${existingFinancialRecord.id}`, {
                                method: 'PUT',
                                body: JSON.stringify({
                                    type: financial['Transaction Type'],
                                    amount: financial['Amount'],
                                    currency: financial['Currency'],
                                    property_id: propertyId,
                                    tenant_id: tenantId,
                                    description: financial['Description'],
                                    date: financial['Date']
                                })
                            });
                        } else {
                            // Create new financial record
                            await apiCall('/api/financial', {
                                method: 'POST',
                                body: JSON.stringify({
                                    type: financial['Transaction Type'],
                                    amount: financial['Amount'],
                                    currency: financial['Currency'],
                                    property_id: propertyId,
                                    tenant_id: tenantId,
                                    description: financial['Description'],
                                    date: financial['Date']
                                })
                            });
                        }
                        
                        // Handle enhanced rent payment data if available
                        if (financial['Rent Month'] && financial['Payment Method']) {
                            try {
                                // Check if rent tracking record already exists
                                const existingRentTracking = await apiCall('/api/rent-tracking');
                                const existingRentTrackingRecord = existingRentTracking.find(rt => 
                                    rt.rent_month === financial['Rent Month'] &&
                                    rt.property_id === propertyId &&
                                    rt.tenant_id === tenantId &&
                                    rt.payment_date === financial['Payment Date']
                                );
                                
                                const rentTrackingData = {
                                    property_id: propertyId,
                                    tenant_id: tenantId,
                                    rent_month: financial['Rent Month'],
                                    due_date: financial['Due Date'] || financial['Date'],
                                    total_amount: financial['Total Rent Amount'] || financial['Amount'],
                                    currency: financial['Currency'],
                                    payment_method: financial['Payment Method'],
                                    payment_amount: financial['Payment Amount'] || financial['Amount'],
                                    payment_date: financial['Payment Date'] || financial['Date'],
                                    cash_received_by: financial['Cash Received By'] || null,
                                    cash_receipt_number: financial['Cash Receipt Number'] || null,
                                    cheque_number: financial['Cheque Number'] || null,
                                    cheque_bank: financial['Cheque Bank'] || null,
                                    cheque_date: financial['Cheque Date'] || null,
                                    cheque_status: financial['Cheque Status'] || null,
                                    online_reference: financial['Online Reference'] || null,
                                    online_bank: financial['Online Bank'] || null,
                                    partial_reason: financial['Partial Reason'] || null,
                                    partial_balance: financial['Partial Balance'] || null,
                                    partial_notes: financial['Partial Notes'] || null,
                                    notes: financial['Rent Payment Notes'] || financial['Description'] || null
                                };
                                
                                if (existingRentTrackingRecord) {
                                    // Update existing rent tracking record
                                    await apiCall(`/api/rent-tracking/${existingRentTrackingRecord.id}`, {
                                        method: 'PUT',
                                        body: JSON.stringify(rentTrackingData)
                                    });
                                } else {
                                    // Create new rent tracking record
                                    await apiCall('/api/rent-tracking', {
                                        method: 'POST',
                                        body: JSON.stringify(rentTrackingData)
                                    });
                                }
                            } catch (rentTrackingError) {
                                console.log(`Could not create/update rent tracking record:`, rentTrackingError);
                            }
                        }
                        results.financial.imported++;
                    } catch (error) {
                        results.financial.errors.push(`Financial record: ${error.message}`);
                    }
                }
            }

            // Process Rent Tracking sheet with property and tenant relationships
            if (workbook.Sheets['Rent Tracking']) {
                const rentTrackingData = XLSX.utils.sheet_to_json(workbook.Sheets['Rent Tracking']);
                for (const rentTracking of rentTrackingData) {
                    try {
                        // Find property and tenant IDs
                        let propertyId = null;
                        let tenantId = null;
                        
                        if (rentTracking['Property Name'] && rentTracking['Property Address']) {
                            try {
                                const existingProperties = await apiCall('/api/properties');
                                const existingProperty = existingProperties.find(p => 
                                    p.name === rentTracking['Property Name'] && 
                                    p.address === rentTracking['Property Address']
                                );
                                if (existingProperty) {
                                    propertyId = existingProperty.id;
                                }
                            } catch (propertyError) {
                                console.log(`Could not find property for rent tracking record:`, propertyError);
                            }
                        }
                        
                        if (rentTracking['Tenant Email']) {
                            try {
                                const existingTenants = await apiCall('/api/tenants');
                                const existingTenant = existingTenants.find(t => 
                                    t.email === rentTracking['Tenant Email']
                                );
                                if (existingTenant) {
                                    tenantId = existingTenant.id;
                                }
                            } catch (tenantError) {
                                console.log(`Could not find tenant for rent tracking record:`, tenantError);
                            }
                        }
                        
                        // Check if rent tracking record already exists
                        const existingRentTracking = await apiCall('/api/rent-tracking');
                        const existingRentTrackingRecord = existingRentTracking.find(rt => 
                            rt.rent_month === rentTracking['Rent Month'] &&
                            rt.property_id === propertyId &&
                            rt.tenant_id === tenantId &&
                            rt.payment_date === rentTracking['Payment Date']
                        );
                        
                        if (existingRentTrackingRecord) {
                            // Update existing rent tracking record
                            await apiCall(`/api/rent-tracking/${existingRentTrackingRecord.id}`, {
                                method: 'PUT',
                                body: JSON.stringify({
                                    property_id: propertyId,
                                    tenant_id: tenantId,
                                    rent_month: rentTracking['Rent Month'],
                                    due_date: rentTracking['Due Date'],
                                    total_amount: rentTracking['Total Amount'],
                                    currency: rentTracking['Currency'],
                                    payment_method: rentTracking['Payment Method'],
                                    payment_amount: rentTracking['Payment Amount'],
                                    payment_date: rentTracking['Payment Date'],
                                    cash_received_by: rentTracking['Cash Received By'] || null,
                                    cash_receipt_number: rentTracking['Cash Receipt Number'] || null,
                                    cheque_number: rentTracking['Cheque Number'] || null,
                                    cheque_bank: rentTracking['Cheque Bank'] || null,
                                    cheque_date: rentTracking['Cheque Date'] || null,
                                    cheque_status: rentTracking['Cheque Status'] || null,
                                    online_reference: rentTracking['Online Reference'] || null,
                                    online_bank: rentTracking['Online Bank'] || null,
                                    partial_reason: rentTracking['Partial Reason'] || null,
                                    partial_balance: rentTracking['Partial Balance'] || null,
                                    partial_notes: rentTracking['Partial Notes'] || null,
                                    notes: rentTracking['Notes'] || null
                                })
                            });
                        } else {
                            // Create new rent tracking record
                            await apiCall('/api/rent-tracking', {
                                method: 'POST',
                                body: JSON.stringify({
                                    property_id: propertyId,
                                    tenant_id: tenantId,
                                    rent_month: rentTracking['Rent Month'],
                                    due_date: rentTracking['Due Date'],
                                    total_amount: rentTracking['Total Amount'],
                                    currency: rentTracking['Currency'],
                                    payment_method: rentTracking['Payment Method'],
                                    payment_amount: rentTracking['Payment Amount'],
                                    payment_date: rentTracking['Payment Date'],
                                    cash_received_by: rentTracking['Cash Received By'] || null,
                                    cash_receipt_number: rentTracking['Cash Receipt Number'] || null,
                                    cheque_number: rentTracking['Cheque Number'] || null,
                                    cheque_bank: rentTracking['Cheque Bank'] || null,
                                    cheque_date: rentTracking['Cheque Date'] || null,
                                    cheque_status: rentTracking['Cheque Status'] || null,
                                    online_reference: rentTracking['Online Reference'] || null,
                                    online_bank: rentTracking['Online Bank'] || null,
                                    partial_reason: rentTracking['Partial Reason'] || null,
                                    partial_balance: rentTracking['Partial Balance'] || null,
                                    partial_notes: rentTracking['Partial Notes'] || null,
                                    notes: rentTracking['Notes'] || null
                                })
                            });
                        }
                        results.rentTracking.imported++;
                    } catch (error) {
                        results.rentTracking.errors.push(`Rent tracking record: ${error.message}`);
                    }
                }
            }

            // Complete progress
            clearInterval(progressInterval);
            progressBar.style.width = '100%';
            progressText.textContent = '100%';

            // Calculate totals
            const totalImported = results.properties.imported + results.tenants.imported + 
                                results.maintenance.imported + results.financial.imported + results.rentTracking.imported;
            const totalErrors = results.properties.errors.length + results.tenants.errors.length + 
                              results.maintenance.errors.length + results.financial.errors.length + results.rentTracking.errors.length;

            // Show results
            let resultMessage = `Successfully imported ${totalImported} items!`;
            if (totalErrors > 0) {
                resultMessage += ` ${totalErrors} errors occurred.`;
            }

            messageDiv.innerHTML = `<i class=\"fas fa-check-circle\"></i> ${resultMessage}`;
            messageDiv.className = 'upload-message success';

            // Show detailed results
            if (totalImported > 0) {
                showMessage(resultMessage, 'success');
                
                // Refresh dashboard after successful import
                setTimeout(() => {
                    loadDashboard();
                }, 1000);
            }

            // Show detailed error summary if any
            if (totalErrors > 0) {
                console.log('Import errors:', results);
            }

        } catch (error) {
            clearInterval(progressInterval);
            messageDiv.innerHTML = `<i class=\"fas fa-exclamation-circle\"></i> Error processing file: ${error.message}`;
            messageDiv.className = 'upload-message error';
            showMessage('Failed to process exported Excel file', 'error');
        }
    };

    reader.onerror = function() {
        clearInterval(progressInterval);
        messageDiv.innerHTML = '<i class=\"fas fa-exclamation-circle\"></i> Error reading file';
        messageDiv.className = 'upload-message error';
        showMessage('Failed to read file', 'error');
    };

    reader.readAsArrayBuffer(file);
}

 