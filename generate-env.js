#!/usr/bin/env node

const crypto = require('crypto');

console.log('🔐 Property Management App - Environment Variables Generator');
console.log('==========================================================\n');

// Generate JWT Secret
const jwtSecret = crypto.randomBytes(32).toString('base64');

// Generate Admin Password
const adminPassword = crypto.randomBytes(16).toString('hex');

console.log('📋 Copy these values to your Render Environment Variables:\n');

console.log('NODE_ENV=production');
console.log(`JWT_SECRET=${jwtSecret}`);
console.log('DATABASE_PATH=/opt/render/projectroot/property_management.db');
console.log('ADMIN_USERNAME=Admin');
console.log(`ADMIN_PASSWORD=${adminPassword}`);
console.log('ADMIN_EMAIL=admin@yourdomain.com');

console.log('\n🔒 Security Notes:');
console.log('- Keep these values secure and private');
console.log('- Never commit them to version control');
console.log('- Use different values for each environment');
console.log('- Store admin password securely - you\'ll need it to login');

console.log('\n📝 Next Steps:');
console.log('1. Go to your Render service dashboard');
console.log('2. Navigate to Environment → Environment Variables');
console.log('3. Add each variable with the values above');
console.log('4. Save and redeploy your service');

console.log('\n✅ Done! Your app will be secure and ready for production.'); 