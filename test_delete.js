const fetch = require('node-fetch');

// Test configuration
const BASE_URL = 'http://localhost:3000';
let authToken = null;

async function testLogin() {
    try {
        const response = await fetch(`${BASE_URL}/api/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                username: 'testuser',
                password: 'testpass123'
            })
        });
        
        const data = await response.json();
        if (response.ok) {
            authToken = data.token;
            console.log('Login successful, token:', authToken);
            return true;
        } else {
            console.log('Login failed:', data.error);
            return false;
        }
    } catch (error) {
        console.error('Login error:', error);
        return false;
    }
}

async function createTestMaintenance() {
    try {
        const response = await fetch(`${BASE_URL}/api/maintenance`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({
                title: 'Test Delete Maintenance',
                description: 'This is a test maintenance request for deletion',
                priority: 'low'
            })
        });
        
        const data = await response.json();
        if (response.ok) {
            console.log('Created test maintenance request:', data);
            return data.id;
        } else {
            console.log('Failed to create maintenance request:', data.error);
            return null;
        }
    } catch (error) {
        console.error('Create maintenance error:', error);
        return null;
    }
}

async function completeMaintenance(id) {
    try {
        const response = await fetch(`${BASE_URL}/api/maintenance/${id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({
                status: 'completed',
                completed_at: new Date().toISOString()
            })
        });
        
        const data = await response.json();
        if (response.ok) {
            console.log('Completed maintenance request:', data);
            return true;
        } else {
            console.log('Failed to complete maintenance request:', data.error);
            return false;
        }
    } catch (error) {
        console.error('Complete maintenance error:', error);
        return false;
    }
}

async function deleteMaintenance(id) {
    try {
        const response = await fetch(`${BASE_URL}/api/maintenance/${id}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });
        
        const data = await response.json();
        if (response.ok) {
            console.log('Successfully deleted maintenance request:', data);
            return true;
        } else {
            console.log('Failed to delete maintenance request:', data.error);
            return false;
        }
    } catch (error) {
        console.error('Delete maintenance error:', error);
        return false;
    }
}

async function listMaintenance() {
    try {
        const response = await fetch(`${BASE_URL}/api/maintenance`, {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });
        
        const data = await response.json();
        if (response.ok) {
            console.log('Current maintenance requests:', data);
            return data;
        } else {
            console.log('Failed to list maintenance requests:', data.error);
            return [];
        }
    } catch (error) {
        console.error('List maintenance error:', error);
        return [];
    }
}

async function runTest() {
    console.log('Starting delete maintenance test...');
    
    // Step 1: Login
    const loginSuccess = await testLogin();
    if (!loginSuccess) {
        console.log('Cannot proceed without login');
        return;
    }
    
    // Step 2: List current maintenance requests
    console.log('\n--- Current maintenance requests ---');
    await listMaintenance();
    
    // Step 3: Create a test maintenance request
    console.log('\n--- Creating test maintenance request ---');
    const maintenanceId = await createTestMaintenance();
    if (!maintenanceId) {
        console.log('Cannot proceed without creating maintenance request');
        return;
    }
    
    // Step 4: Complete the maintenance request
    console.log('\n--- Completing maintenance request ---');
    const completed = await completeMaintenance(maintenanceId);
    if (!completed) {
        console.log('Cannot proceed without completing maintenance request');
        return;
    }
    
    // Step 5: List maintenance requests again to see the completed one
    console.log('\n--- Maintenance requests after completion ---');
    await listMaintenance();
    
    // Step 6: Delete the completed maintenance request
    console.log('\n--- Deleting completed maintenance request ---');
    const deleted = await deleteMaintenance(maintenanceId);
    if (deleted) {
        console.log('✅ Delete test PASSED');
    } else {
        console.log('❌ Delete test FAILED');
    }
    
    // Step 7: List maintenance requests again to confirm deletion
    console.log('\n--- Maintenance requests after deletion ---');
    await listMaintenance();
}

// Run the test
runTest().catch(console.error); 