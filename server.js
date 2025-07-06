const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const xlsx = require('xlsx');
const fs = require('fs');

// Load environment variables from .env file if it exists (for local development)
if (fs.existsSync('.env')) {
    require('dotenv').config();
}

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

// Database setup - use environment variable for database path or default to local path
const dbPath = process.env.DATABASE_PATH || './property_management.db';
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
    } else {
        console.log(`Connected to SQLite database at: ${dbPath}`);
    }
});

// Initialize database tables
const initDatabase = () => {
    // Properties table
    db.run(`CREATE TABLE IF NOT EXISTS properties (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        address TEXT NOT NULL,
        type TEXT NOT NULL,
        bedrooms INTEGER,
        bathrooms INTEGER,
        square_feet REAL,
        rent_amount REAL,
        currency TEXT DEFAULT 'USD',
        status TEXT DEFAULT 'vacant',
        electricity_number TEXT,
        water_number TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id)
    )`);

    // Tenants table
    db.run(`CREATE TABLE IF NOT EXISTS tenants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        email TEXT NOT NULL,
        phone TEXT,
        nationality TEXT,
        property_id INTEGER,
        lease_start DATE,
        lease_end DATE,
        rent_amount REAL,
        currency TEXT DEFAULT 'USD',
        status TEXT DEFAULT 'active',
        free_month_type TEXT,
        free_month_date TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id),
        FOREIGN KEY (property_id) REFERENCES properties (id)
    )`);

    // Maintenance requests table
    db.run(`CREATE TABLE IF NOT EXISTS maintenance_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        property_id INTEGER,
        tenant_id INTEGER,
        title TEXT NOT NULL,
        description TEXT,
        priority TEXT DEFAULT 'medium',
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        completed_at DATETIME,
        FOREIGN KEY (user_id) REFERENCES users (id),
        FOREIGN KEY (property_id) REFERENCES properties (id),
        FOREIGN KEY (tenant_id) REFERENCES tenants (id)
    )`);

    // Financial records table
    db.run(`CREATE TABLE IF NOT EXISTS financial_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        property_id INTEGER,
        tenant_id INTEGER,
        type TEXT NOT NULL,
        amount REAL NOT NULL,
        currency TEXT DEFAULT 'USD',
        description TEXT,
        date DATE NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id),
        FOREIGN KEY (property_id) REFERENCES properties (id),
        FOREIGN KEY (tenant_id) REFERENCES tenants (id)
    )`);

    // Rent tracking table
    db.run(`CREATE TABLE IF NOT EXISTS rent_tracking (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        property_id INTEGER NOT NULL,
        tenant_id INTEGER NOT NULL,
        rent_month TEXT NOT NULL,
        due_date DATE NOT NULL,
        total_amount REAL NOT NULL,
        currency TEXT DEFAULT 'USD',
        payment_method TEXT NOT NULL,
        payment_amount REAL NOT NULL,
        payment_date DATE NOT NULL,
        
        -- Cash payment details
        cash_received_by TEXT,
        cash_receipt_number TEXT,
        
        -- Cheque payment details
        cheque_number TEXT,
        cheque_bank TEXT,
        cheque_date DATE,
        cheque_status TEXT DEFAULT 'pending',
        
        -- Online payment details
        online_reference TEXT,
        online_bank TEXT,
        
        -- Partial payment details
        partial_reason TEXT,
        partial_balance REAL DEFAULT 0,
        partial_notes TEXT,
        
        -- General notes
        notes TEXT,
        
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id),
        FOREIGN KEY (property_id) REFERENCES properties (id),
        FOREIGN KEY (tenant_id) REFERENCES tenants (id)
    )`);

    // Users table for authentication with enhanced privacy
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        phone TEXT,
        address TEXT,
        preferences TEXT,
        role TEXT DEFAULT 'manager',
        failed_attempts INTEGER DEFAULT 0,
        locked_until DATETIME,
        last_password_change DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_login DATETIME DEFAULT CURRENT_TIMESTAMP,
        expiry_date DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Data shares table for sharing data between accounts
    db.run(`CREATE TABLE IF NOT EXISTS data_shares (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        share_token TEXT UNIQUE NOT NULL,
        recipient_email TEXT,
        data_type TEXT DEFAULT 'all',
        expires_at DATETIME NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id)
    )`);

    // Cheques table for tenant cheque management
    db.run(`CREATE TABLE IF NOT EXISTS cheques (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id INTEGER NOT NULL,
        cheque_number TEXT,
        bank_name TEXT,
        date DATE,
        amount REAL,
        is_security BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE
    )`);
};

// Initialize database
initDatabase();

// Database migration function to add missing columns
const runMigrations = () => {
    console.log('Running database migrations...');
    
    // Add free_month columns to tenants table if they don't exist
    db.get("PRAGMA table_info(tenants)", (err, rows) => {
        if (err) {
            console.error('Error checking tenants table structure:', err);
            return;
        }
        
        db.all("PRAGMA table_info(tenants)", (err, columns) => {
            if (err) {
                console.error('Error getting tenants table columns:', err);
                return;
            }
            
            const columnNames = columns.map(col => col.name);
            
            // Add free_month_type column if it doesn't exist
            if (!columnNames.includes('free_month_type')) {
                console.log('Adding free_month_type column to tenants table...');
                db.run('ALTER TABLE tenants ADD COLUMN free_month_type TEXT', (err) => {
                    if (err) {
                        console.error('Error adding free_month_type column:', err);
                    } else {
                        console.log('✅ Added free_month_type column to tenants table');
                    }
                });
            }
            
            // Add free_month_date column if it doesn't exist
            if (!columnNames.includes('free_month_date')) {
                console.log('Adding free_month_date column to tenants table...');
                db.run('ALTER TABLE tenants ADD COLUMN free_month_date TEXT', (err) => {
                    if (err) {
                        console.error('Error adding free_month_date column:', err);
                    } else {
                        console.log('✅ Added free_month_date column to tenants table');
                    }
                });
            }
        });
    });
};

// Create admin user if not exists
const createAdminUser = async () => {
    const adminUsername = process.env.ADMIN_USERNAME || 'Admin';
    const adminPassword = process.env.ADMIN_PASSWORD || 'Admin@1993';
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@system.com';
    
    // Check if admin user already exists
    db.get('SELECT id FROM users WHERE username = ?', [adminUsername], async (err, user) => {
        if (err) {
            console.error('Error checking admin user:', err);
            return;
        }
        
        if (!user) {
            // Create admin user
            const hashedPassword = await bcrypt.hash(adminPassword, 10);
            db.run(
                'INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)',
                [adminUsername, adminEmail, hashedPassword, 'admin'],
                function(err) {
                    if (err) {
                        console.error('Error creating admin user:', err);
                    } else {
                        console.log('Admin user created successfully');
                    }
                }
            );
        } else {
            console.log('Admin user already exists');
        }
    });
};

// Run migrations and create admin user on startup
runMigrations();
createAdminUser();

// Authentication middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            if (err.name === 'TokenExpiredError') {
                return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
            }
            return res.status(403).json({ error: 'Invalid token' });
        }
        req.user = user;
        next();
    });
};

// Helper function to get current user ID from request
const getCurrentUserId = (req) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        throw new Error('No token provided');
    }
    
    const decoded = jwt.verify(token, JWT_SECRET);
    return decoded.id;
};

// Admin middleware
const requireAdmin = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }
    
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid token' });
        }
        
        // Check if user is admin
        db.get('SELECT role FROM users WHERE id = ?', [user.userId || user.id], (err, dbUser) => {
            if (err) {
                return res.status(500).json({ error: 'Database error' });
            }
            
            if (!dbUser || dbUser.role !== 'admin') {
                return res.status(403).json({ error: 'Admin access required' });
            }
            
            req.user = user;
            next();
        });
    });
};

// Routes

// Serve the main HTML page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Serve the admin HTML page
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Authentication routes
app.post('/api/register', async (req, res) => {
    const { username, email, password } = req.body;
    
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        
        db.run(
            'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)',
            [username, email, hashedPassword],
            function(err) {
                if (err) {
                    if (err.message.includes('UNIQUE constraint failed')) {
                        return res.status(400).json({ error: 'Username or email already exists' });
                    }
                    return res.status(500).json({ error: 'Error creating user' });
                }
                
                const token = jwt.sign({ id: this.lastID, username }, JWT_SECRET, { expiresIn: '24h' });
                res.json({ token, user: { id: this.lastID, username, email } });
            }
        );
    } catch (error) {
        res.status(500).json({ error: 'Error hashing password' });
    }
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    
    db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        try {
            const validPassword = await bcrypt.compare(password, user.password_hash);
            if (!validPassword) {
                return res.status(401).json({ error: 'Invalid credentials' });
            }
            
            const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '24h' });
            res.json({ token, user: { id: user.id, username: user.username, email: user.email } });
        } catch (error) {
            res.status(500).json({ error: 'Error comparing passwords' });
        }
    });
});

// Token refresh endpoint
app.post('/api/refresh-token', authenticateToken, (req, res) => {
    try {
        const userId = getCurrentUserId(req);
        
        db.get('SELECT * FROM users WHERE id = ?', [userId], (err, user) => {
            if (err) {
                return res.status(500).json({ error: 'Database error' });
            }
            
            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }
            
            const newToken = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '24h' });
            res.json({ token: newToken, user: { id: user.id, username: user.username, email: user.email } });
        });
    } catch (error) {
        return res.status(401).json({ error: 'Authentication required' });
    }
});

// Properties routes
app.get('/api/properties', (req, res) => {
    try {
        const userId = getCurrentUserId(req);
        db.all('SELECT * FROM properties WHERE user_id = ? ORDER BY created_at DESC', [userId], (err, rows) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            res.json(rows);
        });
    } catch (error) {
        return res.status(401).json({ error: 'Authentication required' });
    }
});

app.get('/api/properties/:id', (req, res) => {
    try {
        const userId = getCurrentUserId(req);
        const { id } = req.params;
        
        db.get('SELECT * FROM properties WHERE id = ? AND user_id = ?', [id, userId], (err, row) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            if (!row) {
                return res.status(404).json({ error: 'Property not found' });
            }
            res.json(row);
        });
    } catch (error) {
        return res.status(401).json({ error: 'Authentication required' });
    }
});

app.post('/api/properties', (req, res) => {
    try {
        const userId = getCurrentUserId(req);
        const { name, address, type, bedrooms, bathrooms, square_feet, rent_amount, currency, status, electricity_number, water_number } = req.body;
        
        // Validate required fields
        if (!name || !address || !type) {
            return res.status(400).json({ error: 'Name, address, and type are required' });
        }
        
        // Convert numeric values and handle nulls
        const bedroomsValue = bedrooms ? parseInt(bedrooms) : null;
        const bathroomsValue = bathrooms ? parseFloat(bathrooms) : null;
        const squareFeetValue = square_feet ? parseFloat(square_feet) : null;
        const rentAmountValue = rent_amount ? parseFloat(rent_amount) : null;
        
        db.run(
            'INSERT INTO properties (user_id, name, address, type, bedrooms, bathrooms, square_feet, rent_amount, currency, status, electricity_number, water_number) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [userId, name, address, type, bedroomsValue, bathroomsValue, squareFeetValue, rentAmountValue, currency || 'USD', status || 'vacant', electricity_number || null, water_number || null],
            function(err) {
                if (err) {
                    console.error('SQL Error in properties insert:', err);
                    return res.status(500).json({ error: err.message });
                }
                res.json({ id: this.lastID, message: 'Property added successfully' });
            }
        );
    } catch (error) {
        return res.status(401).json({ error: 'Authentication required' });
    }
});

app.put('/api/properties/:id', (req, res) => {
    try {
        const userId = getCurrentUserId(req);
        const { name, address, type, bedrooms, bathrooms, square_feet, rent_amount, currency, status, electricity_number, water_number } = req.body;
        const { id } = req.params;
        
        db.run(
            'UPDATE properties SET name = ?, address = ?, type = ?, bedrooms = ?, bathrooms = ?, square_feet = ?, rent_amount = ?, currency = ?, status = ?, electricity_number = ?, water_number = ? WHERE id = ? AND user_id = ?',
            [name, address, type, bedrooms, bathrooms, square_feet, rent_amount, currency || 'USD', status, electricity_number || null, water_number || null, id, userId],
            function(err) {
                if (err) {
                    return res.status(500).json({ error: err.message });
                }
                if (this.changes === 0) {
                    return res.status(404).json({ error: 'Property not found or access denied' });
                }
                res.json({ message: 'Property updated successfully' });
            }
        );
    } catch (error) {
        return res.status(401).json({ error: 'Authentication required' });
    }
});

// Endpoint to update tenants when property becomes vacant
app.post('/api/properties/:id/update-tenants-vacant', (req, res) => {
    try {
        const userId = getCurrentUserId(req);
        const { id } = req.params;
        
        // Update all tenants associated with this property to expired status
        db.run(
            'UPDATE tenants SET status = ? WHERE property_id = ? AND user_id = ?',
            ['expired', id, userId],
            function(err) {
                if (err) {
                    console.error('Error updating tenants for vacant property:', err);
                    return res.status(500).json({ error: err.message });
                }
                console.log(`Updated ${this.changes} tenants to expired status for property ${id}`);
                res.json({ message: `Updated ${this.changes} tenants to expired status` });
            }
        );
    } catch (error) {
        return res.status(401).json({ error: 'Authentication required' });
    }
});

app.delete('/api/properties/:id', (req, res) => {
    try {
        const userId = getCurrentUserId(req);
        const { id } = req.params;
        
        db.run('DELETE FROM properties WHERE id = ? AND user_id = ?', [id, userId], function(err) {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            if (this.changes === 0) {
                return res.status(404).json({ error: 'Property not found or access denied' });
            }
            res.json({ message: 'Property deleted successfully' });
        });
    } catch (error) {
        return res.status(401).json({ error: 'Authentication required' });
    }
});

// Tenants routes
app.get('/api/tenants', (req, res) => {
    try {
        const userId = getCurrentUserId(req);
        db.all(`
            SELECT t.*, p.name as property_name, p.address as property_address 
            FROM tenants t 
            LEFT JOIN properties p ON t.property_id = p.id 
            WHERE t.user_id = ?
            ORDER BY t.created_at DESC
        `, [userId], (err, rows) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            
            // Get cheques for each tenant
            const tenantsWithCheques = rows.map(tenant => {
                return new Promise((resolve) => {
                    db.all('SELECT * FROM cheques WHERE tenant_id = ? ORDER BY id', [tenant.id], (err, cheques) => {
                        if (err) {
                            console.error('Error fetching cheques for tenant:', tenant.id, err);
                            tenant.cheques = [];
                        } else {
                            tenant.cheques = cheques || [];
                        }
                        resolve(tenant);
                    });
                });
            });
            
            Promise.all(tenantsWithCheques).then(tenants => {
                console.log('Retrieved tenants with free month data and cheques:', tenants.map(t => ({ 
                    id: t.id, 
                    name: `${t.first_name} ${t.last_name}`,
                    free_month_type: t.free_month_type, 
                    free_month_date: t.free_month_date,
                    cheque_count: t.cheques.length
                })));
                res.json(tenants);
            });
        });
    } catch (error) {
        return res.status(401).json({ error: 'Authentication required' });
    }
});

app.get('/api/tenants/:id', (req, res) => {
    try {
        const userId = getCurrentUserId(req);
        const { id } = req.params;
        
        db.get('SELECT * FROM tenants WHERE id = ? AND user_id = ?', [id, userId], (err, row) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            if (!row) {
                return res.status(404).json({ error: 'Tenant not found' });
            }
            
            // Get cheques for this tenant
            db.all('SELECT * FROM cheques WHERE tenant_id = ? ORDER BY id', [id], (err, cheques) => {
                if (err) {
                    console.error('Error fetching cheques for tenant:', id, err);
                    row.cheques = [];
                } else {
                    row.cheques = cheques || [];
                }
                res.json(row);
            });
        });
    } catch (error) {
        return res.status(401).json({ error: 'Authentication required' });
    }
});

app.post('/api/tenants', (req, res) => {
    try {
        const userId = getCurrentUserId(req);
        const { first_name, last_name, email, phone, nationality, property_id, lease_start, lease_end, rent_amount, currency, free_month_type, free_month_date, cheques } = req.body;
        
        // Validate required fields
        if (!first_name || !last_name || !email) {
            return res.status(400).json({ error: 'First name, last name, and email are required' });
        }
        
        // Convert numeric values and handle nulls
        const propertyIdValue = property_id ? parseInt(property_id) : null;
        const rentAmountValue = rent_amount ? parseFloat(rent_amount) : null;
        
        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ error: 'Invalid email format' });
        }
        
        // Verify property belongs to user if property_id is provided
        if (propertyIdValue) {
            db.get('SELECT id FROM properties WHERE id = ? AND user_id = ?', [propertyIdValue, userId], (err, property) => {
                if (err) {
                    return res.status(500).json({ error: 'Database error checking property' });
                }
                if (!property) {
                    return res.status(400).json({ error: 'Property not found or access denied' });
                }
                
                // Insert tenant after property verification
                insertTenant();
            });
        } else {
            insertTenant();
        }
        
        function insertTenant() {
            console.log('Inserting tenant with free month data:', { free_month_type, free_month_date });
            db.run(
                'INSERT INTO tenants (user_id, first_name, last_name, email, phone, nationality, property_id, lease_start, lease_end, rent_amount, currency, free_month_type, free_month_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [userId, first_name, last_name, email, phone || null, nationality || null, propertyIdValue, lease_start || null, lease_end || null, rentAmountValue, currency || 'USD', free_month_type || null, free_month_date || null],
                function(err) {
                    if (err) {
                        console.error('SQL Error in tenants insert:', err);
                        return res.status(500).json({ error: err.message });
                    }
                    
                    const tenantId = this.lastID;
                    console.log('Tenant inserted successfully with ID:', tenantId);
                    
                    // Insert cheques if provided
                    if (cheques && cheques.length > 0) {
                        insertCheques(tenantId, cheques, () => {
                            res.json({ id: tenantId, message: 'Tenant added successfully with cheques' });
                        });
                    } else {
                        res.json({ id: tenantId, message: 'Tenant added successfully' });
                    }
                }
            );
        }
        
        function insertCheques(tenantId, cheques, callback) {
            const stmt = db.prepare('INSERT INTO cheques (tenant_id, cheque_number, bank_name, date, amount, is_security) VALUES (?, ?, ?, ?, ?, ?)');
            
            cheques.forEach((cheque, index) => {
                stmt.run([
                    tenantId,
                    cheque.cheque_number || null,
                    cheque.bank_name || null,
                    cheque.date || null,
                    cheque.amount || null,
                    cheque.is_security ? 1 : 0
                ], function(err) {
                    if (err) {
                        console.error('Error inserting cheque:', err);
                    }
                    
                    if (index === cheques.length - 1) {
                        stmt.finalize();
                        callback();
                    }
                });
            });
        }
    } catch (error) {
        return res.status(401).json({ error: 'Authentication required' });
    }
});

app.put('/api/tenants/:id', (req, res) => {
    try {
        const userId = getCurrentUserId(req);
        const { first_name, last_name, email, phone, nationality, property_id, lease_start, lease_end, rent_amount, currency, free_month_type, free_month_date, cheques } = req.body;
        const { id } = req.params;
        
        // Validate required fields
        if (!first_name || !last_name || !email) {
            return res.status(400).json({ error: 'First name, last name, and email are required' });
        }
        
        // Convert numeric values and handle nulls
        const propertyIdValue = property_id ? parseInt(property_id) : null;
        const rentAmountValue = rent_amount ? parseFloat(rent_amount) : null;
        
        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ error: 'Invalid email format' });
        }
        
        console.log('Updating tenant with free month data:', { id, free_month_type, free_month_date });
        db.run(
            'UPDATE tenants SET first_name = ?, last_name = ?, email = ?, phone = ?, nationality = ?, property_id = ?, lease_start = ?, lease_end = ?, rent_amount = ?, currency = ?, free_month_type = ?, free_month_date = ? WHERE id = ? AND user_id = ?',
            [first_name, last_name, email, phone || null, nationality || null, propertyIdValue, lease_start || null, lease_end || null, rentAmountValue, currency || 'USD', free_month_type || null, free_month_date || null, id, userId],
            function(err) {
                if (err) {
                    console.error('SQL Error in tenants update:', err);
                    return res.status(500).json({ error: err.message });
                }
                if (this.changes === 0) {
                    return res.status(404).json({ error: 'Tenant not found or access denied' });
                }
                console.log('Tenant updated successfully, changes:', this.changes);
                
                // Update cheques if provided
                if (cheques && cheques.length >= 0) {
                    updateCheques(id, cheques, () => {
                        res.json({ message: 'Tenant updated successfully with cheques' });
                    });
                } else {
                    res.json({ message: 'Tenant updated successfully' });
                }
            }
        );
        
        function updateCheques(tenantId, cheques, callback) {
            // First, delete existing cheques for this tenant
            db.run('DELETE FROM cheques WHERE tenant_id = ?', [tenantId], function(err) {
                if (err) {
                    console.error('Error deleting existing cheques:', err);
                    callback();
                    return;
                }
                
                // If no new cheques provided, just callback
                if (cheques.length === 0) {
                    callback();
                    return;
                }
                
                // Insert new cheques
                const stmt = db.prepare('INSERT INTO cheques (tenant_id, cheque_number, bank_name, date, amount, is_security) VALUES (?, ?, ?, ?, ?, ?)');
                
                cheques.forEach((cheque, index) => {
                    stmt.run([
                        tenantId,
                        cheque.cheque_number || null,
                        cheque.bank_name || null,
                        cheque.date || null,
                        cheque.amount || null,
                        cheque.is_security ? 1 : 0
                    ], function(err) {
                        if (err) {
                            console.error('Error inserting cheque:', err);
                        }
                        
                        if (index === cheques.length - 1) {
                            stmt.finalize();
                            callback();
                        }
                    });
                });
            });
        }
    } catch (error) {
        return res.status(401).json({ error: 'Authentication required' });
    }
});

app.delete('/api/tenants/:id', (req, res) => {
    try {
        const userId = getCurrentUserId(req);
        const { id } = req.params;
        
        db.run('DELETE FROM tenants WHERE id = ? AND user_id = ?', [id, userId], function(err) {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            if (this.changes === 0) {
                return res.status(404).json({ error: 'Tenant not found or access denied' });
            }
            res.json({ message: 'Tenant deleted successfully' });
        });
    } catch (error) {
        return res.status(401).json({ error: 'Authentication required' });
    }
});

// Maintenance requests routes
app.get('/api/maintenance', (req, res) => {
    try {
        const userId = getCurrentUserId(req);
        db.all(`
            SELECT mr.*, p.name as property_name, t.first_name, t.last_name 
            FROM maintenance_requests mr 
            LEFT JOIN properties p ON mr.property_id = p.id 
            LEFT JOIN tenants t ON mr.tenant_id = t.id 
            WHERE mr.user_id = ?
            ORDER BY mr.created_at DESC
        `, [userId], (err, rows) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            res.json(rows);
        });
    } catch (error) {
        return res.status(401).json({ error: 'Authentication required' });
    }
});

app.post('/api/maintenance', (req, res) => {
    try {
        const userId = getCurrentUserId(req);
        const { property_id, tenant_id, title, description, priority } = req.body;
        
        // Validate required fields
        if (!title) {
            return res.status(400).json({ error: 'Title is required' });
        }
        
        // Convert numeric values and handle nulls
        const propertyIdValue = property_id ? parseInt(property_id) : null;
        const tenantIdValue = tenant_id ? parseInt(tenant_id) : null;
        
        // Verify property belongs to user if property_id is provided
        if (propertyIdValue) {
            db.get('SELECT id FROM properties WHERE id = ? AND user_id = ?', [propertyIdValue, userId], (err, property) => {
                if (err) {
                    return res.status(500).json({ error: 'Database error checking property' });
                }
                if (!property) {
                    return res.status(400).json({ error: 'Property not found or access denied' });
                }
                
                // Verify tenant belongs to user if tenant_id is provided
                if (tenantIdValue) {
                    db.get('SELECT id FROM tenants WHERE id = ? AND user_id = ?', [tenantIdValue, userId], (err, tenant) => {
                        if (err) {
                            return res.status(500).json({ error: 'Database error checking tenant' });
                        }
                        if (!tenant) {
                            return res.status(400).json({ error: 'Tenant not found or access denied' });
                        }
                        
                        insertMaintenance();
                    });
                } else {
                    insertMaintenance();
                }
            });
        } else {
            insertMaintenance();
        }
        
        function insertMaintenance() {
            db.run(
                'INSERT INTO maintenance_requests (user_id, property_id, tenant_id, title, description, priority) VALUES (?, ?, ?, ?, ?, ?)',
                [userId, propertyIdValue, tenantIdValue, title, description || null, priority || 'medium'],
                function(err) {
                    if (err) {
                        console.error('SQL Error in maintenance insert:', err);
                        return res.status(500).json({ error: err.message });
                    }
                    res.json({ id: this.lastID, message: 'Maintenance request created successfully' });
                }
            );
        }
    } catch (error) {
        return res.status(401).json({ error: 'Authentication required' });
    }
});

app.put('/api/maintenance/:id', (req, res) => {
    try {
        const userId = getCurrentUserId(req);
        const { status, completed_at } = req.body;
        const { id } = req.params;
        
        db.run(
            'UPDATE maintenance_requests SET status = ?, completed_at = ? WHERE id = ? AND user_id = ?',
            [status, completed_at, id, userId],
            function(err) {
                if (err) {
                    return res.status(500).json({ error: err.message });
                }
                if (this.changes === 0) {
                    return res.status(404).json({ error: 'Maintenance request not found or access denied' });
                }
                res.json({ message: 'Maintenance request updated successfully' });
            }
        );
    } catch (error) {
        return res.status(401).json({ error: 'Authentication required' });
    }
});

app.delete('/api/maintenance/:id', (req, res) => {
    console.log('=== DELETE MAINTENANCE REQUEST ===');
    console.log('Request headers:', req.headers);
    console.log('Request params:', req.params);
    console.log('Request body:', req.body);
    
    try {
        const userId = getCurrentUserId(req);
        const { id } = req.params;
        
        console.log('DELETE maintenance request - User ID:', userId, 'Maintenance ID:', id);
        
        if (!userId) {
            console.log('No user ID found - authentication failed');
            return res.status(401).json({ error: 'Authentication required' });
        }
        
        if (!id || isNaN(parseInt(id))) {
            console.log('Invalid maintenance ID:', id);
            return res.status(400).json({ error: 'Valid maintenance ID is required' });
        }
        
        // First check if the maintenance request is completed
        db.get('SELECT status FROM maintenance_requests WHERE id = ? AND user_id = ?', [id, userId], (err, row) => {
            if (err) {
                console.error('Database error checking maintenance request:', err);
                return res.status(500).json({ error: err.message });
            }
            
            console.log('Maintenance request found:', row);
            
            if (!row) {
                console.log('Maintenance request not found or access denied');
                return res.status(404).json({ error: 'Maintenance request not found or access denied' });
            }
            
            // Only allow deletion of completed maintenance requests
            if (row.status !== 'completed') {
                console.log('Attempted to delete non-completed maintenance request. Status:', row.status);
                return res.status(400).json({ error: 'Only completed maintenance requests can be deleted' });
            }
            
            console.log('Proceeding with deletion of completed maintenance request');
            
            // Delete the maintenance request
            db.run('DELETE FROM maintenance_requests WHERE id = ? AND user_id = ?', [id, userId], function(err) {
                if (err) {
                    console.error('Database error deleting maintenance request:', err);
                    return res.status(500).json({ error: err.message });
                }
                
                console.log('Delete operation completed. Changes:', this.changes);
                
                if (this.changes === 0) {
                    console.log('No maintenance request was deleted');
                    return res.status(404).json({ error: 'Maintenance request not found or access denied' });
                }
                
                console.log('Maintenance request deleted successfully');
                res.json({ message: 'Maintenance request deleted successfully' });
            });
        });
    } catch (error) {
        console.error('Authentication error in DELETE maintenance:', error);
        return res.status(401).json({ error: 'Authentication required' });
    }
});

// Financial records routes
app.get('/api/financial', (req, res) => {
    try {
        const userId = getCurrentUserId(req);
        db.all(`
            SELECT fr.*, p.name as property_name, t.first_name, t.last_name 
            FROM financial_records fr 
            LEFT JOIN properties p ON fr.property_id = p.id 
            LEFT JOIN tenants t ON fr.tenant_id = t.id 
            WHERE fr.user_id = ?
            ORDER BY fr.date DESC
        `, [userId], (err, rows) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            res.json(rows);
        });
    } catch (error) {
        return res.status(401).json({ error: 'Authentication required' });
    }
});

app.post('/api/financial', (req, res) => {
    try {
        const userId = getCurrentUserId(req);
        const { property_id, tenant_id, type, amount, currency, description, date } = req.body;
        
        // Validate required fields
        if (!type || !amount || !date) {
            return res.status(400).json({ error: 'Type, amount, and date are required' });
        }
        
        // Convert numeric values and handle nulls
        const propertyIdValue = property_id ? parseInt(property_id) : null;
        const tenantIdValue = tenant_id ? parseInt(tenant_id) : null;
        const amountValue = parseFloat(amount);
        
        // Validate amount
        if (isNaN(amountValue) || amountValue <= 0) {
            return res.status(400).json({ error: 'Amount must be a positive number' });
        }
        
        // Validate date format
        if (!Date.parse(date)) {
            return res.status(400).json({ error: 'Invalid date format' });
        }
        
        // Verify property belongs to user if property_id is provided
        if (propertyIdValue) {
            db.get('SELECT id FROM properties WHERE id = ? AND user_id = ?', [propertyIdValue, userId], (err, property) => {
                if (err) {
                    return res.status(500).json({ error: 'Database error checking property' });
                }
                if (!property) {
                    return res.status(400).json({ error: 'Property not found or access denied' });
                }
                
                // Verify tenant belongs to user if tenant_id is provided
                if (tenantIdValue) {
                    db.get('SELECT id FROM tenants WHERE id = ? AND user_id = ?', [tenantIdValue, userId], (err, tenant) => {
                        if (err) {
                            return res.status(500).json({ error: 'Database error checking tenant' });
                        }
                        if (!tenant) {
                            return res.status(400).json({ error: 'Tenant not found or access denied' });
                        }
                        
                        insertFinancial();
                    });
                } else {
                    insertFinancial();
                }
            });
        } else {
            insertFinancial();
        }
        
        function insertFinancial() {
            db.run(
                'INSERT INTO financial_records (user_id, property_id, tenant_id, type, amount, currency, description, date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                [userId, propertyIdValue, tenantIdValue, type, amountValue, currency || 'USD', description || null, date],
                function(err) {
                    if (err) {
                        console.error('SQL Error in financial insert:', err);
                        return res.status(500).json({ error: err.message });
                    }
                    res.json({ id: this.lastID, message: 'Financial record added successfully' });
                }
            );
        }
    } catch (error) {
        return res.status(401).json({ error: 'Authentication required' });
    }
});

// Update financial record
app.put('/api/financial/:id', (req, res) => {
    try {
        const userId = getCurrentUserId(req);
        const { id } = req.params;
        const { property_id, tenant_id, type, amount, currency, description, date } = req.body;
        
        // Validate required fields
        if (!type || !amount || !date) {
            return res.status(400).json({ error: 'Type, amount, and date are required' });
        }
        
        // Convert numeric values and handle nulls
        const propertyIdValue = property_id ? parseInt(property_id) : null;
        const tenantIdValue = tenant_id ? parseInt(tenant_id) : null;
        const amountValue = parseFloat(amount);
        
        // Validate amount
        if (isNaN(amountValue) || amountValue <= 0) {
            return res.status(400).json({ error: 'Amount must be a positive number' });
        }
        
        // Validate date format
        if (!Date.parse(date)) {
            return res.status(400).json({ error: 'Invalid date format' });
        }
        
        db.run(
            'UPDATE financial_records SET property_id = ?, tenant_id = ?, type = ?, amount = ?, currency = ?, description = ?, date = ? WHERE id = ? AND user_id = ?',
            [propertyIdValue, tenantIdValue, type, amountValue, currency || 'USD', description || null, date, id, userId],
            function(err) {
                if (err) {
                    console.error('SQL Error in financial update:', err);
                    return res.status(500).json({ error: err.message });
                }
                if (this.changes === 0) {
                    return res.status(404).json({ error: 'Financial record not found or access denied' });
                }
                res.json({ message: 'Financial record updated successfully' });
            }
        );
    } catch (error) {
        return res.status(401).json({ error: 'Authentication required' });
    }
});

// Delete financial record
app.delete('/api/financial/:id', (req, res) => {
    try {
        const userId = getCurrentUserId(req);
        console.log('DELETE request received for financial record ID:', req.params.id);
        const { id } = req.params;
        
        if (!id || isNaN(parseInt(id))) {
            console.log('Invalid ID provided:', id);
            return res.status(400).json({ error: 'Valid ID is required' });
        }
        
        console.log('Attempting to delete financial record with ID:', id);
        db.run('DELETE FROM financial_records WHERE id = ? AND user_id = ?', [id, userId], function(err) {
            if (err) {
                console.error('SQL Error in financial delete:', err);
                return res.status(500).json({ error: err.message });
            }
            
            console.log('Delete operation completed. Changes:', this.changes);
            
            if (this.changes === 0) {
                console.log('No record found with ID:', id);
                return res.status(404).json({ error: 'Financial record not found or access denied' });
            }
            
            console.log('Financial record deleted successfully');
            res.json({ message: 'Financial record deleted successfully' });
        });
    } catch (error) {
        return res.status(401).json({ error: 'Authentication required' });
    }
});

// Dashboard statistics
app.get('/api/dashboard', (req, res) => {
    try {
        let userId;
        
        // Handle test token for development
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];
        
        if (token === 'test') {
            // For testing, use admin user ID (usually 1)
            userId = 1;
        } else {
            userId = getCurrentUserId(req);
        }
        
        const stats = {};
        
        // Get total properties
        db.get('SELECT COUNT(*) as count FROM properties WHERE user_id = ?', [userId], (err, row) => {
            if (err) return res.status(500).json({ error: err.message });
            stats.totalProperties = row.count;
            
            // Get occupied properties (properties with active tenants)
            db.get(`
                SELECT COUNT(DISTINCT p.id) as count 
                FROM properties p
                INNER JOIN tenants t ON p.id = t.property_id
                WHERE p.user_id = ? AND t.status = 'active'
            `, [userId], (err, row) => {
                if (err) return res.status(500).json({ error: err.message });
                stats.occupiedProperties = row.count;
                
                // Get vacant properties (properties without active tenants)
                db.get(`
                    SELECT COUNT(*) as count 
                    FROM properties p
                    WHERE p.user_id = ? AND p.id NOT IN (
                        SELECT DISTINCT property_id 
                        FROM tenants 
                        WHERE status = 'active'
                    )
                `, [userId], (err, row) => {
                    if (err) return res.status(500).json({ error: err.message });
                    stats.vacantProperties = row.count;
                    
                    // Get total tenants
                    db.get('SELECT COUNT(*) as count FROM tenants WHERE status = "active" AND user_id = ?', [userId], (err, row) => {
                        if (err) return res.status(500).json({ error: err.message });
                        stats.activeTenants = row.count;
                        
                        // Get pending maintenance requests
                        db.get('SELECT COUNT(*) as count FROM maintenance_requests WHERE status = "pending" AND user_id = ?', [userId], (err, row) => {
                            if (err) return res.status(500).json({ error: err.message });
                            stats.pendingMaintenance = row.count;
                            
                            // Get pending rent properties (properties with active tenants but no rent payment for current month)
                            const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM format
                            db.all(`
                                SELECT DISTINCT p.id, p.name, p.address, p.rent_amount, p.currency, 
                                       t.first_name, t.last_name, t.email, t.phone
                                FROM properties p
                                INNER JOIN tenants t ON p.id = t.property_id
                                WHERE p.user_id = ? AND p.status = 'occupied' AND t.status = 'active'
                                AND p.id NOT IN (
                                    SELECT DISTINCT property_id 
                                    FROM rent_tracking 
                                    WHERE user_id = ? AND rent_month = ?
                                )
                                ORDER BY p.name
                            `, [userId, userId, currentMonth], (err, rows) => {
                                if (err) return res.status(500).json({ error: err.message });
                                stats.pendingRentProperties = rows;
                                
                                // Get rent paid properties (properties with rent payment for current month)
                                db.all(`
                                    SELECT DISTINCT p.id, p.name, p.address, p.rent_amount, p.currency,
                                           t.first_name, t.last_name, t.email, t.phone,
                                           rt.payment_date, rt.payment_amount, rt.payment_method
                                    FROM properties p
                                    INNER JOIN tenants t ON p.id = t.property_id
                                    INNER JOIN rent_tracking rt ON p.id = rt.property_id
                                    WHERE p.user_id = ? AND p.status = 'occupied' AND t.status = 'active'
                                    AND rt.rent_month = ?
                                    ORDER BY rt.payment_date DESC
                                `, [userId, currentMonth], (err, rows) => {
                                    if (err) return res.status(500).json({ error: err.message });
                                    stats.rentPaidProperties = rows;
                                    
                                    // Get vacant properties list (properties without active tenants)
                                    db.all(`
                                        SELECT p.id, p.name, p.address, p.rent_amount, p.currency, p.type, p.bedrooms, p.bathrooms
                                        FROM properties p
                                        WHERE p.user_id = ? AND p.id NOT IN (
                                            SELECT DISTINCT property_id 
                                            FROM tenants 
                                            WHERE status = 'active'
                                        )
                                        ORDER BY p.name
                                    `, [userId], (err, rows) => {
                                        if (err) return res.status(500).json({ error: err.message });
                                        stats.vacantPropertiesList = rows;
                                        
                                        res.json(stats);
                                    });
                                });
                            });
                        });
                    });
                });
            });
        });
    } catch (error) {
        return res.status(401).json({ error: 'Authentication required' });
    }
});

// Sample data creation endpoint (for testing)
app.post('/api/sample-data', (req, res) => {
    try {
        let userId;
        
        // Handle test token for development
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];
        
        if (token === 'test') {
            // For testing, use admin user ID (usually 1)
            userId = 1;
        } else {
            userId = getCurrentUserId(req);
        }
        
        const sampleProperties = [
            {
                name: 'Sunset Villa',
                address: '123 Sunset Blvd, Los Angeles, CA 90210',
                type: 'villa',
                bedrooms: 3,
                bathrooms: 2.5,
                square_feet: 2500,
                rent_amount: 3500,
                currency: 'USD',
                status: 'occupied'
            },
            {
                name: 'Downtown Apartment',
                address: '456 Main St, New York, NY 10001',
                type: 'apartment',
                bedrooms: 2,
                bathrooms: 1,
                square_feet: 1200,
                rent_amount: 2800,
                currency: 'USD',
                status: 'vacant'
            },
            {
                name: 'Garden House',
                address: '789 Oak Ave, Chicago, IL 60601',
                type: 'house',
                bedrooms: 4,
                bathrooms: 3,
                square_feet: 3200,
                rent_amount: 4200,
                currency: 'USD',
                status: 'vacant'
            },
            {
                name: 'Beach Condo',
                address: '321 Ocean Dr, Miami, FL 33139',
                type: 'condo',
                bedrooms: 2,
                bathrooms: 2,
                square_feet: 1500,
                rent_amount: 3200,
                currency: 'USD',
                status: 'occupied'
            }
        ];

        let insertedCount = 0;
        let errorCount = 0;
        const totalCount = sampleProperties.length;

        // Check if properties already exist for this user
        db.get('SELECT COUNT(*) as count FROM properties WHERE user_id = ?', [userId], (err, row) => {
            if (err) {
                return res.status(500).json({ error: 'Database error checking existing properties' });
            }
            
            if (row.count > 0) {
                return res.status(400).json({ error: 'Properties already exist for this user. Please clear the database first.' });
            }

            sampleProperties.forEach((property, index) => {
                db.run(
                    'INSERT INTO properties (user_id, name, address, type, bedrooms, bathrooms, square_feet, rent_amount, currency, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    [userId, property.name, property.address, property.type, property.bedrooms, property.bathrooms, property.square_feet, property.rent_amount, property.currency, property.status],
                    function(err) {
                        if (err) {
                            console.error('Error inserting sample property:', err);
                            errorCount++;
                        } else {
                            insertedCount++;
                        }
                        
                        if (insertedCount + errorCount === totalCount) {
                            if (errorCount > 0) {
                                res.status(500).json({ error: `Failed to create ${errorCount} properties. ${insertedCount} created successfully.` });
                            } else {
                                res.json({ message: `Successfully created ${insertedCount} sample properties` });
                            }
                        }
                    }
                );
            });
        });
    } catch (error) {
        return res.status(401).json({ error: 'Authentication required' });
    }
});

// Database reset endpoint (for testing)
app.post('/api/reset-database', (req, res) => {
    try {
        let userId;
        
        // Handle test token for development
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];
        
        if (token === 'test') {
            // For testing, use admin user ID (usually 1)
            userId = 1;
        } else {
            userId = getCurrentUserId(req);
        }
        const tables = ['rent_tracking', 'financial_records', 'maintenance_requests', 'tenants', 'properties'];
        let completedCount = 0;
        
        tables.forEach(table => {
            if (table === 'properties') {
                db.run(`DELETE FROM ${table} WHERE user_id = ?`, [userId], (err) => {
                    if (err) {
                        console.error(`Error clearing table ${table}:`, err);
                    }
                    completedCount++;
                    
                    if (completedCount === tables.length) {
                        res.json({ message: 'Database reset successfully for this user' });
                    }
                });
            } else {
                db.run(`DELETE FROM ${table} WHERE user_id = ?`, [userId], (err) => {
                    if (err) {
                        console.error(`Error clearing table ${table}:`, err);
                    }
                    completedCount++;
                    
                    if (completedCount === tables.length) {
                        res.json({ message: 'Database reset successfully for this user' });
                    }
                });
            }
        });
    } catch (error) {
        return res.status(401).json({ error: 'Authentication required' });
    }
});

// Rent tracking routes
app.get('/api/rent-tracking', (req, res) => {
    try {
        const userId = getCurrentUserId(req);
        db.all(`
            SELECT rt.*, p.name as property_name, t.first_name, t.last_name 
            FROM rent_tracking rt 
            LEFT JOIN properties p ON rt.property_id = p.id 
            LEFT JOIN tenants t ON rt.tenant_id = t.id 
            WHERE rt.user_id = ?
            ORDER BY rt.payment_date DESC
        `, [userId], (err, rows) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            res.json(rows);
        });
    } catch (error) {
        return res.status(401).json({ error: 'Authentication required' });
    }
});

app.post('/api/rent-tracking', (req, res) => {
    try {
        const userId = getCurrentUserId(req);
        const {
            property_id, tenant_id, rent_month, due_date, total_amount, currency,
            payment_method, payment_amount, payment_date,
            cash_received_by, cash_receipt_number,
            cheque_number, cheque_bank, cheque_date, cheque_status,
            online_reference, online_bank,
            partial_reason, partial_balance, partial_notes,
            notes
        } = req.body;
        
        // Validate required fields
        if (!property_id || !tenant_id || !rent_month || !due_date || !total_amount || 
            !payment_method || !payment_amount || !payment_date) {
            return res.status(400).json({ error: 'Missing required fields' });
        }
        
        // Convert numeric values
        const propertyIdValue = parseInt(property_id);
        const tenantIdValue = parseInt(tenant_id);
        const totalAmountValue = parseFloat(total_amount);
        const paymentAmountValue = parseFloat(payment_amount);
        const partialBalanceValue = partial_balance ? parseFloat(partial_balance) : 0;
        
        // Validate amounts
        if (isNaN(totalAmountValue) || totalAmountValue <= 0) {
            return res.status(400).json({ error: 'Total amount must be a positive number' });
        }
        
        if (isNaN(paymentAmountValue) || paymentAmountValue <= 0) {
            return res.status(400).json({ error: 'Payment amount must be a positive number' });
        }
        
        // Validate payment amount doesn't exceed total amount
        if (paymentAmountValue > totalAmountValue) {
            return res.status(400).json({ error: 'Payment amount cannot exceed total amount' });
        }
        
        // Validate dates
        if (!Date.parse(due_date) || !Date.parse(payment_date)) {
            return res.status(400).json({ error: 'Invalid date format' });
        }
        
        // Verify property belongs to user
        db.get('SELECT id FROM properties WHERE id = ? AND user_id = ?', [propertyIdValue, userId], (err, property) => {
            if (err) {
                return res.status(500).json({ error: 'Database error checking property' });
            }
            if (!property) {
                return res.status(400).json({ error: 'Property not found or access denied' });
            }
            
            // Verify tenant belongs to user
            db.get('SELECT id FROM tenants WHERE id = ? AND user_id = ?', [tenantIdValue, userId], (err, tenant) => {
                if (err) {
                    return res.status(500).json({ error: 'Database error checking tenant' });
                }
                if (!tenant) {
                    return res.status(400).json({ error: 'Tenant not found or access denied' });
                }
                
                insertRentTracking();
            });
        });
        
        function insertRentTracking() {
            db.run(`
                INSERT INTO rent_tracking (
                    user_id, property_id, tenant_id, rent_month, due_date, total_amount, currency,
                    payment_method, payment_amount, payment_date,
                    cash_received_by, cash_receipt_number,
                    cheque_number, cheque_bank, cheque_date, cheque_status,
                    online_reference, online_bank,
                    partial_reason, partial_balance, partial_notes,
                    notes
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                userId, propertyIdValue, tenantIdValue, rent_month, due_date, totalAmountValue, currency || 'USD',
                payment_method, paymentAmountValue, payment_date,
                cash_received_by || null, cash_receipt_number || null,
                cheque_number || null, cheque_bank || null, cheque_date || null, cheque_status || 'pending',
                online_reference || null, online_bank || null,
                partial_reason || null, partialBalanceValue, partial_notes || null,
                notes || null
            ], function(err) {
                if (err) {
                    console.error('SQL Error in rent tracking insert:', err);
                    return res.status(500).json({ error: err.message });
                }
                
                // Also create a financial record for this payment
                const financialType = payment_method === 'partial' ? 'partial_rent' : 'rent';
                const financialDescription = `${payment_method.charAt(0).toUpperCase() + payment_method.slice(1)} payment for ${rent_month}`;
                
                db.run(
                    'INSERT INTO financial_records (user_id, property_id, tenant_id, type, amount, currency, description, date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                    [userId, propertyIdValue, tenantIdValue, financialType, paymentAmountValue, currency || 'USD', financialDescription, payment_date],
                    function(financialErr) {
                        if (financialErr) {
                            console.error('Error creating financial record:', financialErr);
                        }
                        res.json({ id: this.lastID, message: 'Rent payment tracked successfully' });
                    }
                );
            });
        }
    } catch (error) {
        return res.status(401).json({ error: 'Authentication required' });
    }
});

app.get('/api/rent-tracking/:id', (req, res) => {
    try {
        const userId = getCurrentUserId(req);
        const { id } = req.params;
        
        db.get(`
            SELECT rt.*, p.name as property_name, t.first_name, t.last_name 
            FROM rent_tracking rt 
            LEFT JOIN properties p ON rt.property_id = p.id 
            LEFT JOIN tenants t ON rt.tenant_id = t.id 
            WHERE rt.id = ? AND rt.user_id = ?
        `, [id, userId], (err, row) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            if (!row) {
                return res.status(404).json({ error: 'Rent tracking record not found or access denied' });
            }
            res.json(row);
        });
    } catch (error) {
        return res.status(401).json({ error: 'Authentication required' });
    }
});

// Update rent tracking record
app.put('/api/rent-tracking/:id', (req, res) => {
    try {
        const userId = getCurrentUserId(req);
        const { id } = req.params;
        const {
            property_id, tenant_id, rent_month, due_date, total_amount, currency,
            payment_method, payment_amount, payment_date,
            cash_received_by, cash_receipt_number,
            cheque_number, cheque_bank, cheque_date, cheque_status,
            online_reference, online_bank,
            partial_reason, partial_balance, partial_notes,
            notes
        } = req.body;
        
        // Validate required fields
        if (!property_id || !tenant_id || !rent_month || !due_date || !total_amount || 
            !payment_method || !payment_amount || !payment_date) {
            return res.status(400).json({ error: 'Missing required fields' });
        }
        
        // Convert numeric values
        const propertyIdValue = parseInt(property_id);
        const tenantIdValue = parseInt(tenant_id);
        const totalAmountValue = parseFloat(total_amount);
        const paymentAmountValue = parseFloat(payment_amount);
        const partialBalanceValue = partial_balance ? parseFloat(partial_balance) : 0;
        
        // Validate amounts
        if (isNaN(totalAmountValue) || totalAmountValue <= 0) {
            return res.status(400).json({ error: 'Total amount must be a positive number' });
        }
        
        if (isNaN(paymentAmountValue) || paymentAmountValue <= 0) {
            return res.status(400).json({ error: 'Payment amount must be a positive number' });
        }
        
        // Validate payment amount doesn't exceed total amount
        if (paymentAmountValue > totalAmountValue) {
            return res.status(400).json({ error: 'Payment amount cannot exceed total amount' });
        }
        
        // Validate dates
        if (!Date.parse(due_date) || !Date.parse(payment_date)) {
            return res.status(400).json({ error: 'Invalid date format' });
        }
        
        db.run(`
            UPDATE rent_tracking SET 
                property_id = ?, tenant_id = ?, rent_month = ?, due_date = ?, total_amount = ?, currency = ?,
                payment_method = ?, payment_amount = ?, payment_date = ?,
                cash_received_by = ?, cash_receipt_number = ?,
                cheque_number = ?, cheque_bank = ?, cheque_date = ?, cheque_status = ?,
                online_reference = ?, online_bank = ?,
                partial_reason = ?, partial_balance = ?, partial_notes = ?,
                notes = ?
            WHERE id = ? AND user_id = ?
        `, [
            propertyIdValue, tenantIdValue, rent_month, due_date, totalAmountValue, currency || 'USD',
            payment_method, paymentAmountValue, payment_date,
            cash_received_by || null, cash_receipt_number || null,
            cheque_number || null, cheque_bank || null, cheque_date || null, cheque_status || 'pending',
            online_reference || null, online_bank || null,
            partial_reason || null, partialBalanceValue, partial_notes || null,
            notes || null, id, userId
        ], function(err) {
            if (err) {
                console.error('SQL Error in rent tracking update:', err);
                return res.status(500).json({ error: err.message });
            }
            if (this.changes === 0) {
                return res.status(404).json({ error: 'Rent tracking record not found or access denied' });
            }
            res.json({ message: 'Rent tracking record updated successfully' });
        });
    } catch (error) {
        return res.status(401).json({ error: 'Authentication required' });
    }
});

// Profile update endpoint with enhanced privacy protection
app.put('/api/profile/update', (req, res) => {
    const { currentPassword, newPassword, email, phone, address, preferences } = req.body;
    
    // Enhanced authentication with rate limiting check
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const userId = decoded.id;
        
        // Verify current password with enhanced security
        db.get('SELECT password_hash, email, last_password_change, failed_attempts, locked_until FROM users WHERE id = ?', [userId], async (err, user) => {
            if (err) {
                return res.status(500).json({ error: 'Database error' });
            }
            
            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }
            
            // Check if account is temporarily locked
            if (user.locked_until && new Date() < new Date(user.locked_until)) {
                return res.status(423).json({ error: 'Account temporarily locked due to multiple failed attempts' });
            }
            
            // Verify current password
            const isValidPassword = await bcrypt.compare(currentPassword, user.password_hash);
            if (!isValidPassword) {
                // Increment failed attempts
                const failedAttempts = (user.failed_attempts || 0) + 1;
                let lockedUntil = null;
                
                if (failedAttempts >= 5) {
                    // Lock account for 15 minutes after 5 failed attempts
                    lockedUntil = new Date(Date.now() + 15 * 60 * 1000);
                }
                
                db.run('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?', 
                    [failedAttempts, lockedUntil, userId]);
                
                return res.status(400).json({ error: 'Current password is incorrect' });
            }
            
            // Reset failed attempts on successful login
            db.run('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?', [userId]);
            
            // Check if email is being changed and if it already exists
            if (email && email !== user.email) {
                db.get('SELECT id FROM users WHERE email = ? AND id != ?', [email, userId], (err, existingUser) => {
                    if (err) {
                        return res.status(500).json({ error: 'Database error checking email' });
                    }
                    
                    if (existingUser) {
                        return res.status(400).json({ error: 'Email already exists' });
                    }
                    
                    // Update user data with enhanced privacy
                    updateUserProfileEnhanced(userId, email, newPassword, phone, address, preferences, res);
                });
            } else {
                // Update user data without email change
                updateUserProfileEnhanced(userId, email, newPassword, phone, address, preferences, res);
            }
        });
        
    } catch (error) {
        return res.status(401).json({ error: 'Invalid token' });
    }
});

// Get user profile data (private to user)
app.get('/api/profile', (req, res) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const userId = decoded.id;
        
        // Only return user's own data
        db.get('SELECT id, username, email, phone, address, preferences, created_at, last_login FROM users WHERE id = ?', [userId], (err, user) => {
            if (err) {
                return res.status(500).json({ error: 'Database error' });
            }
            
            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }
            
            // Remove sensitive data before sending
            delete user.password_hash;
            delete user.failed_attempts;
            delete user.locked_until;
            
            res.json(user);
        });
        
    } catch (error) {
        return res.status(401).json({ error: 'Invalid token' });
    }
});

// Enhanced helper function to update user profile with privacy protection
function updateUserProfileEnhanced(userId, email, newPassword, phone, address, preferences, res) {
    let updateQuery = 'UPDATE users SET ';
    let updateParams = [];
    
    if (email) {
        updateQuery += 'email = ?';
        updateParams.push(email);
    }
    
    if (phone !== undefined) {
        if (updateParams.length > 0) updateQuery += ', ';
        updateQuery += 'phone = ?';
        updateParams.push(phone);
    }
    
    if (address !== undefined) {
        if (updateParams.length > 0) updateQuery += ', ';
        updateQuery += 'address = ?';
        updateParams.push(address);
    }
    
    if (preferences !== undefined) {
        if (updateParams.length > 0) updateQuery += ', ';
        updateQuery += 'preferences = ?';
        updateParams.push(JSON.stringify(preferences));
    }
    
    if (newPassword) {
        if (updateParams.length > 0) updateQuery += ', ';
        updateQuery += 'password_hash = ?, last_password_change = CURRENT_TIMESTAMP';
        updateParams.push(newPassword);
    }
    
    if (updateParams.length === 0) {
        return res.status(400).json({ error: 'No changes to update' });
    }
    
    updateQuery += ' WHERE id = ?';
    updateParams.push(userId);
    
    // Hash new password if provided
    if (newPassword) {
        bcrypt.hash(newPassword, 12, (err, hashedPassword) => {
            if (err) {
                return res.status(500).json({ error: 'Error hashing password' });
            }
            
            // Replace the password in params with hashed version
            const finalParams = updateParams.map(param => 
                param === newPassword ? hashedPassword : param
            );
            
            db.run(updateQuery, finalParams, function(err) {
                if (err) {
                    return res.status(500).json({ error: 'Error updating profile' });
                }
                
                res.json({ message: 'Profile updated successfully' });
            });
        });
    } else {
        // No password change, just update other fields
        db.run(updateQuery, updateParams, function(err) {
            if (err) {
                return res.status(500).json({ error: 'Error updating profile' });
            }
            
            res.json({ message: 'Profile updated successfully' });
        });
    }
}

// Admin routes
app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required' });
    }
    db.get('SELECT * FROM users WHERE username = ?', [username], (err, user) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        if (!user || user.role !== 'admin') {
            return res.status(401).json({ error: 'Invalid admin credentials' });
        }
        bcrypt.compare(password, user.password_hash, (err, result) => {
            if (err) {
                return res.status(500).json({ error: 'Error checking password' });
            }
            if (!result) {
                return res.status(401).json({ error: 'Invalid admin credentials' });
            }
            // Generate JWT token
            const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '8h' });
            res.json({ token, user: { id: user.id, username: user.username, email: user.email, role: user.role } });
        });
    });
});

// Admin dashboard - shows system statistics
app.get('/api/admin/dashboard', requireAdmin, (req, res) => {
    const stats = {};
    
    // Get total users (excluding admin)
    db.get('SELECT COUNT(*) as count FROM users WHERE role != "admin"', (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        stats.totalUsers = row.count;
        
        // Get total properties across all users
        db.get('SELECT COUNT(*) as count FROM properties', (err, row) => {
            if (err) return res.status(500).json({ error: err.message });
            stats.totalProperties = row.count;
            
            // Get total tenants across all users
            db.get('SELECT COUNT(*) as count FROM tenants', (err, row) => {
                if (err) return res.status(500).json({ error: err.message });
                stats.totalTenants = row.count;
                
                // Get total maintenance requests
                db.get('SELECT COUNT(*) as count FROM maintenance_requests', (err, row) => {
                    if (err) return res.status(500).json({ error: err.message });
                    stats.totalMaintenance = row.count;
                    
                    // Get total financial records
                    db.get('SELECT COUNT(*) as count FROM financial_records', (err, row) => {
                        if (err) return res.status(500).json({ error: err.message });
                        stats.totalFinancial = row.count;
                        
                        // Get total rent tracking records
                        db.get('SELECT COUNT(*) as count FROM rent_tracking', (err, row) => {
                            if (err) return res.status(500).json({ error: err.message });
                            stats.totalRentTracking = row.count;
                            
                            res.json(stats);
                        });
                    });
                });
            });
        });
    });
});

// Reset database - Admin only
app.post('/api/admin/reset-database', requireAdmin, (req, res) => {
    const { confirm } = req.body;
    
    if (confirm !== 'RESET_ALL_DATA') {
        return res.status(400).json({ error: 'Confirmation required. Send "RESET_ALL_DATA" to confirm.' });
    }
    
    // Delete all data from all tables (except admin user)
    const tables = ['properties', 'tenants', 'maintenance_requests', 'financial_records', 'rent_tracking'];
    let completedTables = 0;
    let hasError = false;
    
    tables.forEach(table => {
        db.run(`DELETE FROM ${table}`, function(err) {
            if (err) {
                console.error(`Error deleting from ${table}:`, err);
                hasError = true;
            }
            
            completedTables++;
            
            if (completedTables === tables.length) {
                if (hasError) {
                    return res.status(500).json({ error: 'Error occurred while resetting database' });
                }
                
                res.json({ 
                    message: 'Database reset successfully. All user data has been deleted.',
                    deletedTables: tables,
                    adminUserPreserved: true
                });
            }
        });
    });
});

// Get all users - Admin only
app.get('/api/admin/users', requireAdmin, (req, res) => {
    db.all('SELECT id, username, email, role, created_at, last_login, expiry_date FROM users ORDER BY created_at DESC', (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json(rows);
    });
});

// Update user username - Admin only
app.put('/api/admin/users/:id/username', requireAdmin, (req, res) => {
    const { id } = req.params;
    const { username } = req.body;
    
    if (!username) {
        return res.status(400).json({ error: 'Username is required' });
    }
    
    // Prevent editing Admin username
    db.get('SELECT username FROM users WHERE id = ?', [id], (err, user) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        if (user.username === 'Admin') {
            return res.status(403).json({ error: 'Admin username cannot be modified' });
        }
        
        // Check if username already exists
        db.get('SELECT id FROM users WHERE username = ? AND id != ?', [username, id], (err, existingUser) => {
            if (err) {
                return res.status(500).json({ error: 'Database error' });
            }
            
            if (existingUser) {
                return res.status(400).json({ error: 'Username already exists' });
            }
            
            // Update username
            db.run('UPDATE users SET username = ? WHERE id = ?', [username, id], function(err) {
                if (err) {
                    return res.status(500).json({ error: err.message });
                }
                if (this.changes === 0) {
                    return res.status(404).json({ error: 'User not found' });
                }
                res.json({ message: 'Username updated successfully' });
            });
        });
    });
});

// Update user details - Admin only
app.put('/api/admin/users/:id', requireAdmin, (req, res) => {
    const { id } = req.params;
    const { username, email, role, password, expiry_date } = req.body;
    
    if (!username || !email || !role) {
        return res.status(400).json({ error: 'Username, email, and role are required' });
    }
    
    // Prevent editing Admin user
    db.get('SELECT username FROM users WHERE id = ?', [id], (err, user) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        if (user.username === 'Admin') {
            return res.status(403).json({ error: 'Admin user cannot be modified' });
        }
        
        // Allow multiple admin users now
        continueWithUpdate();
        
        function continueWithUpdate() {
            // Check if username already exists
            db.get('SELECT id FROM users WHERE username = ? AND id != ?', [username, id], (err, existingUser) => {
                if (err) {
                    return res.status(500).json({ error: 'Database error' });
                }
                
                if (existingUser) {
                    return res.status(400).json({ error: 'Username already exists' });
                }
                
                // Check if email already exists
                db.get('SELECT id FROM users WHERE email = ? AND id != ?', [email, id], (err, existingEmail) => {
                    if (err) {
                        return res.status(500).json({ error: 'Database error' });
                    }
                    
                    if (existingEmail) {
                        return res.status(400).json({ error: 'Email already exists' });
                    }
                    
                    // Prepare update query
                    let updateQuery = 'UPDATE users SET username = ?, email = ?, role = ?';
                    let updateParams = [username, email, role];
                    
                    // Add password if provided
                    if (password) {
                        updateQuery += ', password_hash = ?, last_password_change = CURRENT_TIMESTAMP';
                        updateParams.push(password); // Will be hashed below
                    }
                    
                    // Add expiry date if provided
                    if (expiry_date && expiry_date.trim() !== '') {
                        console.log('Processing expiry date:', expiry_date);
                        updateQuery += ', expiry_date = ?';
                        try {
                            // Convert datetime-local format to SQLite datetime format
                            const sqliteDate = new Date(expiry_date).toISOString().replace('T', ' ').replace('Z', '');
                            console.log('Converted to SQLite format:', sqliteDate);
                            updateParams.push(sqliteDate);
                        } catch (error) {
                            console.error('Error formatting expiry date:', error);
                            return res.status(400).json({ error: 'Invalid expiry date format' });
                        }
                    } else {
                        console.log('No expiry date provided - setting to NULL');
                        updateQuery += ', expiry_date = NULL';
                    }
                    
                    updateQuery += ' WHERE id = ?';
                    updateParams.push(id);
                    
                    // Hash password if provided
                    if (password) {
                        bcrypt.hash(password, 12, (err, hashedPassword) => {
                            if (err) {
                                return res.status(500).json({ error: 'Error hashing password' });
                            }
                            
                            // Replace password in params with hashed version
                            const finalParams = updateParams.map(param => 
                                param === password ? hashedPassword : param
                            );
                            
                            // Update user
                            db.run(updateQuery, finalParams, function(err) {
                                if (err) {
                                    return res.status(500).json({ error: err.message });
                                }
                                if (this.changes === 0) {
                                    return res.status(404).json({ error: 'User not found' });
                                }
                                res.json({ message: 'User updated successfully' });
                            });
                        });
                    } else {
                        // Update user without password change
                        db.run(updateQuery, updateParams, function(err) {
                            if (err) {
                                return res.status(500).json({ error: err.message });
                            }
                            if (this.changes === 0) {
                                return res.status(404).json({ error: 'User not found' });
                            }
                            res.json({ message: 'User updated successfully' });
                        });
                    }
                });
            });
        }
    });
});

// Reset user data - Admin only
app.post('/api/admin/users/:id/reset-data', requireAdmin, (req, res) => {
    const { id } = req.params;
    const { confirm } = req.body;
    
    if (confirm !== 'RESET_USER_DATA') {
        return res.status(400).json({ error: 'Confirmation required. Send "RESET_USER_DATA" to confirm.' });
    }
    
    // Delete all data for this user
    const tables = ['properties', 'tenants', 'maintenance_requests', 'financial_records', 'rent_tracking'];
    let completedTables = 0;
    let hasError = false;
    
    tables.forEach(table => {
        db.run(`DELETE FROM ${table} WHERE user_id = ?`, [id], function(err) {
            if (err) {
                console.error(`Error deleting from ${table}:`, err);
                hasError = true;
            }
            
            completedTables++;
            
            if (completedTables === tables.length) {
                if (hasError) {
                    return res.status(500).json({ error: 'Error occurred while resetting user data' });
                }
                
                res.json({ 
                    message: 'User data reset successfully.',
                    deletedTables: tables,
                    userId: id
                });
            }
        });
    });
});

// Delete user account - Admin only
app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
    const { id } = req.params;
    
    // First delete all user data
    const tables = ['properties', 'tenants', 'maintenance_requests', 'financial_records', 'rent_tracking'];
    let completedTables = 0;
    let hasError = false;
    
    tables.forEach(table => {
        db.run(`DELETE FROM ${table} WHERE user_id = ?`, [id], function(err) {
            if (err) {
                console.error(`Error deleting from ${table}:`, err);
                hasError = true;
            }
            
            completedTables++;
            
            if (completedTables === tables.length) {
                // Then delete the user account
                db.run('DELETE FROM users WHERE id = ?', [id], function(err) {
                    if (err) {
                        return res.status(500).json({ error: err.message });
                    }
                    if (this.changes === 0) {
                        return res.status(404).json({ error: 'User not found' });
                    }
                    
                    res.json({ 
                        message: 'User account and all data deleted successfully.',
                        deletedTables: tables,
                        userId: id
                    });
                });
            }
        });
    });
});

// Get system info - Admin only
app.get('/api/admin/system-info', requireAdmin, (req, res) => {
    const info = {
        serverTime: new Date().toISOString(),
        databasePath: dbPath,
        totalTables: 6,
        adminUser: 'Admin',
        version: '1.0.0'
    };
    
    res.json(info);
});

// Multer configuration for file uploads
const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    },
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || 
            file.mimetype === 'application/vnd.ms-excel') {
            cb(null, true);
        } else {
            cb(new Error('Only Excel files are allowed'), false);
        }
    }
});

// Bulk Upload Properties
app.post('/api/bulk-upload/properties', authenticateToken, upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    try {
        const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data = xlsx.utils.sheet_to_json(worksheet, { header: 1 });

        if (data.length < 2) {
            return res.status(400).json({ error: 'File must contain at least a header row and one data row' });
        }

        const headers = data[0];
        const rows = data.slice(1);
        const userId = getCurrentUserId(req);
        let successCount = 0;
        let errorCount = 0;
        const errors = [];

        // Expected columns
        const expectedColumns = ['Name', 'Address', 'Type', 'Status', 'Bedrooms', 'Bathrooms', 'Electricity Number', 'Water Number', 'Square Feet', 'Rent Amount', 'Currency'];

        // Validate headers
        for (let i = 0; i < expectedColumns.length; i++) {
            if (headers[i] !== expectedColumns[i]) {
                return res.status(400).json({ 
                    error: `Invalid header at column ${i + 1}. Expected "${expectedColumns[i]}", got "${headers[i]}"` 
                });
            }
        }

        rows.forEach((row, index) => {
            if (row.length < 11) {
                errors.push(`Row ${index + 2}: Insufficient data`);
                errorCount++;
                return;
            }

            const [name, address, type, status, bedrooms, bathrooms, electricityNumber, waterNumber, squareFeet, rentAmount, currency] = row;

            if (!name || !address || !type) {
                errors.push(`Row ${index + 2}: Name, Address, and Type are required`);
                errorCount++;
                return;
            }

            // Check for duplicates based on name, electricity number, and water number
            const duplicateCheckQuery = `
                SELECT id FROM properties 
                WHERE user_id = ? AND name = ? 
                AND (electricity_number = ? OR water_number = ?)
                AND (electricity_number IS NOT NULL OR water_number IS NOT NULL)
            `;
            
            db.get(duplicateCheckQuery, [userId, name, electricityNumber || null, waterNumber || null], (err, existingProperty) => {
                if (err) {
                    errors.push(`Row ${index + 2}: Database error checking duplicates`);
                    errorCount++;
                    return;
                }
                
                if (existingProperty) {
                    errors.push(`Row ${index + 2}: Duplicate property found. Property with name "${name}" and same electricity/water number already exists.`);
                    errorCount++;
                    return;
                }

                const insertQuery = `
                    INSERT INTO properties (user_id, name, address, type, status, bedrooms, bathrooms, electricity_number, water_number, square_feet, rent_amount, currency)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `;

                db.run(insertQuery, [
                    userId,
                    name,
                    address,
                    type,
                    status || 'vacant',
                    bedrooms || null,
                    bathrooms || null,
                    electricityNumber || null,
                    waterNumber || null,
                    squareFeet || null,
                    rentAmount || null,
                    currency || 'USD'
                ], function(err) {
                    if (err) {
                        errors.push(`Row ${index + 2}: ${err.message}`);
                        errorCount++;
                    } else {
                        successCount++;
                    }

                    // Check if this is the last row
                    if (successCount + errorCount === rows.length) {
                        res.json({
                            message: `Upload completed. ${successCount} properties imported successfully.`,
                            successCount,
                            errorCount,
                            errors: errors.length > 0 ? errors : undefined
                        });
                    }
                });
            });
        });

        if (rows.length === 0) {
            res.json({ message: 'No data rows found in file' });
        }

    } catch (error) {
        console.error('Error processing Excel file:', error);
        res.status(500).json({ error: 'Error processing Excel file' });
    }
});

// Bulk Upload Tenants
app.post('/api/bulk-upload/tenants', authenticateToken, upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    try {
        const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data = xlsx.utils.sheet_to_json(worksheet, { header: 1 });

        if (data.length < 2) {
            return res.status(400).json({ error: 'File must contain at least a header row and one data row' });
        }

        const headers = data[0];
        const rows = data.slice(1);
        const userId = getCurrentUserId(req);
        let successCount = 0;
        let errorCount = 0;
        const errors = [];

        // Expected columns
        const expectedColumns = ['First Name', 'Last Name', 'Email', 'Phone', 'Property Name', 'Rent Amount', 'Currency', 'Lease Start Date', 'Lease End Date'];

        // Validate headers
        for (let i = 0; i < expectedColumns.length; i++) {
            if (headers[i] !== expectedColumns[i]) {
                return res.status(400).json({ 
                    error: `Invalid header at column ${i + 1}. Expected "${expectedColumns[i]}", got "${headers[i]}"` 
                });
            }
        }

        rows.forEach((row, index) => {
            if (row.length < 9) {
                errors.push(`Row ${index + 2}: Insufficient data`);
                errorCount++;
                return;
            }

            const [firstName, lastName, email, phone, propertyName, rentAmount, currency, leaseStart, leaseEnd] = row;

            if (!firstName || !email) {
                errors.push(`Row ${index + 2}: First Name and Email are required`);
                errorCount++;
                return;
            }

            // Validate property exists by name
            db.get('SELECT id FROM properties WHERE name = ? AND user_id = ?', [propertyName, userId], (err, property) => {
                if (err) {
                    errors.push(`Row ${index + 2}: Database error`);
                    errorCount++;
                    return;
                }

                if (!property) {
                    errors.push(`Row ${index + 2}: Property "${propertyName}" not found`);
                    errorCount++;
                    return;
                }

                const insertQuery = `
                    INSERT INTO tenants (user_id, first_name, last_name, email, phone, property_id, rent_amount, currency, lease_start, lease_end, status)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `;

                db.run(insertQuery, [
                    userId,
                    firstName,
                    lastName || null, // Make last name optional
                    email,
                    phone || null,
                    property.id, // Use the property ID we found
                    rentAmount || null,
                    currency || 'USD',
                    leaseStart || null,
                    leaseEnd || null,
                    'active'
                ], function(err) {
                    if (err) {
                        errors.push(`Row ${index + 2}: ${err.message}`);
                        errorCount++;
                    } else {
                        successCount++;
                    }

                    // Check if this is the last row
                    if (successCount + errorCount === rows.length) {
                        res.json({
                            message: `Upload completed. ${successCount} tenants imported successfully.`,
                            successCount,
                            errorCount,
                            errors: errors.length > 0 ? errors : undefined
                        });
                    }
                });
            });
        });

        if (rows.length === 0) {
            res.json({ message: 'No data rows found in file' });
        }

    } catch (error) {
        console.error('Error processing Excel file:', error);
        res.status(500).json({ error: 'Error processing Excel file' });
    }
});

// Combined Bulk Upload - Properties and Tenants in one Excel file
app.post('/api/bulk-upload/combined', authenticateToken, upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    try {
        const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
        const userId = getCurrentUserId(req);
        
        const results = {
            properties: { successCount: 0, errorCount: 0, errors: [], imported: [] },
            tenants: { successCount: 0, errorCount: 0, errors: [], imported: [] }
        };

        // Process combined sheet with both properties and tenants
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data = xlsx.utils.sheet_to_json(worksheet, { header: 1 });

        if (data.length < 2) {
            return res.status(400).json({ error: 'File must contain at least a header row and one data row' });
        }

        const headers = data[0];
        const rows = data.slice(1);

        // Expected columns for combined sheet
        const expectedColumns = [
            'Property Name', 'Property Address', 'Property Type', 'Property Status', 'Bedrooms', 'Bathrooms', 
            'Electricity Number', 'Water Number', 'Square Feet', 'Property Rent Amount', 'Property Currency',
            'Tenant First Name', 'Tenant Last Name', 'Tenant Email', 'Tenant Phone', 
            'Tenant Rent Amount', 'Lease Start Date', 'Lease End Date'
        ];

        // Validate headers
        let headerValid = true;
        for (let i = 0; i < expectedColumns.length; i++) {
            if (headers[i] !== expectedColumns[i]) {
                return res.status(400).json({ 
                    error: `Invalid header at column ${i + 1}. Expected "${expectedColumns[i]}", got "${headers[i]}"` 
                });
            }
        }

        let processedRows = 0;
        rows.forEach((row, index) => {
            if (row.length < 18) {
                results.properties.errors.push(`Row ${index + 2}: Insufficient data`);
                results.tenants.errors.push(`Row ${index + 2}: Insufficient data`);
                results.properties.errorCount++;
                results.tenants.errorCount++;
                processedRows++;
                return;
            }

            const [
                propertyName, propertyAddress, propertyType, propertyStatus, bedrooms, bathrooms,
                electricityNumber, waterNumber, squareFeet, propertyRentAmount, propertyCurrency,
                tenantFirstName, tenantLastName, tenantEmail, tenantPhone,
                tenantRentAmount, leaseStart, leaseEnd
            ] = row;

            // Validate required property fields
            if (!propertyName || !propertyAddress || !propertyType) {
                results.properties.errors.push(`Row ${index + 2}: Property Name, Address, and Type are required`);
                results.properties.errorCount++;
            }

            // Validate required tenant fields (if tenant data is provided)
            const hasTenantData = tenantFirstName || tenantEmail;
            if (hasTenantData && (!tenantFirstName || !tenantEmail)) {
                results.tenants.errors.push(`Row ${index + 2}: Tenant First Name and Email are required when tenant data is provided`);
                results.tenants.errorCount++;
            }

            // Process property first
            if (propertyName && propertyAddress && propertyType) {
                // Check for duplicate property
                const duplicateCheckQuery = `
                    SELECT id FROM properties 
                    WHERE user_id = ? AND name = ? 
                    AND (electricity_number = ? OR water_number = ?)
                    AND (electricity_number IS NOT NULL OR water_number IS NOT NULL)
                `;
                
                db.get(duplicateCheckQuery, [userId, propertyName, electricityNumber || null, waterNumber || null], (err, existingProperty) => {
                    if (err) {
                        results.properties.errors.push(`Row ${index + 2}: Database error checking duplicates`);
                        results.properties.errorCount++;
                    } else if (existingProperty) {
                        results.properties.errors.push(`Row ${index + 2}: Duplicate property found. Property with name "${propertyName}" and same electricity/water number already exists.`);
                        results.properties.errorCount++;
                    } else {
                        // Insert property
                        const insertPropertyQuery = `
                            INSERT INTO properties (user_id, name, address, type, status, bedrooms, bathrooms, electricity_number, water_number, square_feet, rent_amount, currency)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        `;

                        db.run(insertPropertyQuery, [
                            userId,
                            propertyName,
                            propertyAddress,
                            propertyType,
                            propertyStatus || 'vacant',
                            bedrooms || null,
                            bathrooms || null,
                            electricityNumber || null,
                            waterNumber || null,
                            squareFeet || null,
                            propertyRentAmount || null,
                            propertyCurrency || 'USD'
                        ], function(err) {
                            if (err) {
                                results.properties.errors.push(`Row ${index + 2}: ${err.message}`);
                                results.properties.errorCount++;
                            } else {
                                results.properties.successCount++;
                                const propertyId = this.lastID;
                                
                                // Store imported property details
                                results.properties.imported.push({
                                    id: propertyId,
                                    name: propertyName,
                                    address: propertyAddress,
                                    type: propertyType,
                                    status: propertyStatus || 'vacant',
                                    bedrooms: bedrooms || null,
                                    bathrooms: bathrooms || null,
                                    electricityNumber: electricityNumber || null,
                                    waterNumber: waterNumber || null,
                                    squareFeet: squareFeet || null,
                                    rentAmount: propertyRentAmount || null,
                                    currency: propertyCurrency || 'USD'
                                });

                                // Process tenant if tenant data is provided
                                if (hasTenantData && tenantFirstName && tenantEmail) {
                                    const insertTenantQuery = `
                                        INSERT INTO tenants (user_id, first_name, last_name, email, phone, property_id, rent_amount, currency, lease_start, lease_end, status)
                                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                                    `;

                                    db.run(insertTenantQuery, [
                                        userId,
                                        tenantFirstName,
                                        tenantLastName || null,
                                        tenantEmail,
                                        tenantPhone || null,
                                        propertyId,
                                        tenantRentAmount || null,
                                        propertyCurrency || 'USD', // Use property currency for tenant
                                        leaseStart || null,
                                        leaseEnd || null,
                                        'active'
                                    ], function(err) {
                                        if (err) {
                                            results.tenants.errors.push(`Row ${index + 2}: ${err.message}`);
                                            results.tenants.errorCount++;
                                        } else {
                                            results.tenants.successCount++;
                                            // Store imported tenant details
                                            results.tenants.imported.push({
                                                id: this.lastID,
                                                firstName: tenantFirstName,
                                                lastName: tenantLastName || null,
                                                email: tenantEmail,
                                                phone: tenantPhone || null,
                                                propertyId: propertyId,
                                                propertyName: propertyName,
                                                rentAmount: tenantRentAmount || null,
                                                currency: propertyCurrency || 'USD', // Use property currency
                                                leaseStart: leaseStart || null,
                                                leaseEnd: leaseEnd || null,
                                                status: 'active'
                                            });
                                        }
                                    });
                                }
                            }
                        });
                    }
                    
                    processedRows++;
                    if (processedRows === rows.length) {
                        sendFinalResponse();
                    }
                });
            } else {
                processedRows++;
                if (processedRows === rows.length) {
                    sendFinalResponse();
                }
            }
        });



        function sendFinalResponse() {
            const totalSuccess = results.properties.successCount + results.tenants.successCount;
            const totalErrors = results.properties.errorCount + results.tenants.errorCount;
            
            let message = `Combined upload completed. `;
            if (results.properties.successCount > 0) {
                message += `${results.properties.successCount} properties imported. `;
            }
            if (results.tenants.successCount > 0) {
                message += `${results.tenants.successCount} tenants imported. `;
            }
            if (totalErrors > 0) {
                message += `${totalErrors} errors occurred.`;
            }

            // Create a summary of imported data
            const summary = {
                properties: results.properties.imported.map(prop => ({
                    name: prop.name,
                    address: prop.address,
                    type: prop.type,
                    status: prop.status,
                    rentAmount: prop.rentAmount,
                    currency: prop.currency
                })),
                tenants: results.tenants.imported.map(tenant => ({
                    name: `${tenant.firstName} ${tenant.lastName || ''}`.trim(),
                    email: tenant.email,
                    propertyName: tenant.propertyName,
                    rentAmount: tenant.rentAmount,
                    currency: tenant.currency,
                    leaseStart: tenant.leaseStart,
                    leaseEnd: tenant.leaseEnd
                }))
            };

            res.json({
                message,
                results,
                summary,
                totalSuccess,
                totalErrors
            });
        }

    } catch (error) {
        console.error('Error processing combined Excel file:', error);
        res.status(500).json({ error: 'Error processing Excel file' });
    }
});

// ===== DATA SHARING ENDPOINTS =====

// Create share token and store shared data
app.post('/api/share-data', authenticateToken, async (req, res) => {
    try {
        const userId = getCurrentUserId(req);
        const { recipientEmail, dataType, expiresIn } = req.body;
        
        // Generate unique share token
        const shareToken = generateShareToken();
        const expiresAt = new Date(Date.now() + (expiresIn || 7 * 24 * 60 * 60 * 1000)); // Default 7 days
        
        // Store share data in database
        const insertShareQuery = `
            INSERT INTO data_shares (user_id, share_token, recipient_email, data_type, expires_at, created_at)
            VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `;
        
        db.run(insertShareQuery, [userId, shareToken, recipientEmail || null, dataType || 'all', expiresAt.toISOString()], function(err) {
            if (err) {
                console.error('Error creating share:', err);
                return res.status(500).json({ error: 'Failed to create share' });
            }
            
            res.json({
                shareToken,
                shareLink: `${req.protocol}://${req.get('host')}?share=${shareToken}`,
                expiresAt: expiresAt.toISOString()
            });
        });
        
    } catch (error) {
        console.error('Error creating share:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get shared data by token
app.get('/api/shared-data/:token', async (req, res) => {
    try {
        const { token } = req.params;
        
        // Get share data from database
        const getShareQuery = `
            SELECT * FROM data_shares 
            WHERE share_token = ? AND expires_at > CURRENT_TIMESTAMP
        `;
        
        db.get(getShareQuery, [token], (err, shareData) => {
            if (err) {
                console.error('Error getting share data:', err);
                return res.status(500).json({ error: 'Failed to get share data' });
            }
            
            if (!shareData) {
                return res.status(404).json({ error: 'Share not found or expired' });
            }
            
            // Get the actual data based on data_type
            const userId = shareData.user_id;
            const dataType = shareData.data_type;
            
            if (dataType === 'all' || dataType === 'properties') {
                db.all('SELECT * FROM properties WHERE user_id = ?', [userId], (err, properties) => {
                    if (err) {
                        console.error('Error getting properties:', err);
                        return res.status(500).json({ error: 'Failed to get properties' });
                    }
                    
                    if (dataType === 'properties') {
                        return res.json({ properties });
                    }
                    
                    // Get other data types
                    db.all('SELECT * FROM tenants WHERE user_id = ?', [userId], (err, tenants) => {
                        if (err) {
                            console.error('Error getting tenants:', err);
                            return res.status(500).json({ error: 'Failed to get tenants' });
                        }
                        
                        db.all('SELECT * FROM maintenance_requests WHERE user_id = ?', [userId], (err, maintenance) => {
                            if (err) {
                                console.error('Error getting maintenance:', err);
                                return res.status(500).json({ error: 'Failed to get maintenance' });
                            }
                            
                            db.all('SELECT * FROM financial_records WHERE user_id = ?', [userId], (err, financial) => {
                                if (err) {
                                    console.error('Error getting financial:', err);
                                    return res.status(500).json({ error: 'Failed to get financial' });
                                }
                                
                                res.json({
                                    properties,
                                    tenants,
                                    maintenance,
                                    financial,
                                    sharedBy: shareData.user_id,
                                    expiresAt: shareData.expires_at
                                });
                            });
                        });
                    });
                });
            } else {
                // Handle specific data type
                const tableMap = {
                    'tenants': 'tenants',
                    'maintenance': 'maintenance_requests',
                    'financial': 'financial_records'
                };
                
                const tableName = tableMap[dataType];
                if (!tableName) {
                    return res.status(400).json({ error: 'Invalid data type' });
                }
                
                db.all(`SELECT * FROM ${tableName} WHERE user_id = ?`, [userId], (err, data) => {
                    if (err) {
                        console.error(`Error getting ${dataType}:`, err);
                        return res.status(500).json({ error: `Failed to get ${dataType}` });
                    }
                    
                    res.json({ [dataType]: data });
                });
            }
        });
        
    } catch (error) {
        console.error('Error getting shared data:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Import shared data
app.post('/api/import-shared-data', authenticateToken, async (req, res) => {
    try {
        const userId = getCurrentUserId(req);
        const { shareToken } = req.body;
        
        // Get shared data
        const response = await fetch(`${req.protocol}://${req.get('host')}/api/shared-data/${shareToken}`);
        const sharedData = await response.json();
        
        if (!response.ok) {
            return res.status(response.status).json(sharedData);
        }
        
        let importedCount = 0;
        let errors = [];
        
        // Import properties
        if (sharedData.properties && sharedData.properties.length > 0) {
            for (const property of sharedData.properties) {
                const insertQuery = `
                    INSERT INTO properties (user_id, name, address, type, status, bedrooms, bathrooms, 
                    square_feet, rent_amount, currency, electricity_number, water_number)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `;
                
                db.run(insertQuery, [
                    userId, property.name, property.address, property.type, property.status,
                    property.bedrooms, property.bathrooms, property.square_feet, property.rent_amount,
                    property.currency, property.electricity_number, property.water_number
                ], function(err) {
                    if (err) {
                        errors.push(`Property ${property.name}: ${err.message}`);
                    } else {
                        importedCount++;
                    }
                });
            }
        }
        
        // Import tenants
        if (sharedData.tenants && sharedData.tenants.length > 0) {
            for (const tenant of sharedData.tenants) {
                const insertQuery = `
                    INSERT INTO tenants (user_id, first_name, last_name, email, phone, nationality,
                    rent_amount, currency, lease_start, lease_end, status)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `;
                
                db.run(insertQuery, [
                    userId, tenant.first_name, tenant.last_name, tenant.email, tenant.phone,
                    tenant.nationality, tenant.rent_amount, tenant.currency, tenant.lease_start,
                    tenant.lease_end, tenant.status
                ], function(err) {
                    if (err) {
                        errors.push(`Tenant ${tenant.first_name} ${tenant.last_name}: ${err.message}`);
                    } else {
                        importedCount++;
                    }
                });
            }
        }
        
        // Import maintenance
        if (sharedData.maintenance && sharedData.maintenance.length > 0) {
            for (const maintenance of sharedData.maintenance) {
                const insertQuery = `
                    INSERT INTO maintenance_requests (user_id, title, description, priority, status)
                    VALUES (?, ?, ?, ?, ?)
                `;
                
                db.run(insertQuery, [
                    userId, maintenance.title, maintenance.description,
                    maintenance.priority, maintenance.status
                ], function(err) {
                    if (err) {
                        errors.push(`Maintenance ${maintenance.title}: ${err.message}`);
                    } else {
                        importedCount++;
                    }
                });
            }
        }
        
        // Import financial records
        if (sharedData.financial && sharedData.financial.length > 0) {
            for (const financial of sharedData.financial) {
                const insertQuery = `
                    INSERT INTO financial_records (user_id, type, amount, currency, description, date)
                    VALUES (?, ?, ?, ?, ?, ?)
                `;
                
                db.run(insertQuery, [
                    userId, financial.type, financial.amount, financial.currency,
                    financial.description, financial.date
                ], function(err) {
                    if (err) {
                        errors.push(`Financial record: ${err.message}`);
                    } else {
                        importedCount++;
                    }
                });
            }
        }
        
        res.json({
            message: `Successfully imported ${importedCount} items`,
            importedCount,
            errors: errors.length > 0 ? errors : undefined
        });
        
    } catch (error) {
        console.error('Error importing shared data:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Generate share token utility function
function generateShareToken() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 16; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

// Start server
app.listen(PORT, () => {
    console.log(`Property Management Server running on port ${PORT}`);
    console.log(`Open http://localhost:${PORT} in your browser`);
}); 