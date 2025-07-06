const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./property_management.db');

console.log('Checking database tables...');

db.all("SELECT name FROM sqlite_master WHERE type='table'", (err, rows) => {
    if (err) {
        console.error('Error checking tables:', err);
    } else {
        console.log('Available tables:', rows.map(r => r.name));
        
        // Check if rent_tracking table exists
        const hasRentTracking = rows.some(r => r.name === 'rent_tracking');
        console.log('Rent tracking table exists:', hasRentTracking);
        
        if (hasRentTracking) {
            // Check table structure
            db.all("PRAGMA table_info(rent_tracking)", (err, columns) => {
                if (err) {
                    console.error('Error checking rent_tracking structure:', err);
                } else {
                    console.log('Rent tracking table columns:');
                    columns.forEach(col => {
                        console.log(`  ${col.name} (${col.type})`);
                    });
                }
                db.close();
            });
        } else {
            console.log('Rent tracking table does not exist!');
            db.close();
        }
    }
}); 