# Render Environment Variables Setup

## Important: DO NOT Upload .env Files

**Never upload `.env` files to Render or commit them to your repository.** Instead, set environment variables directly in Render's dashboard.

## Environment Variables to Set in Render Dashboard

Go to your Render service dashboard → Environment → Environment Variables and add these:

### Required Variables:

| Variable Name | Value | Description |
|---------------|-------|-------------|
| `NODE_ENV` | `production` | Environment mode |
| `JWT_SECRET` | `[Generate a random string]` | JWT signing secret |
| `DATABASE_PATH` | `/opt/render/projectroot/property_management.db` | Database file path |
| `ADMIN_USERNAME` | `Admin` | Admin username |
| `ADMIN_PASSWORD` | `[Generate a secure password]` | Admin password |
| `ADMIN_EMAIL` | `admin@yourdomain.com` | Admin email |

### How to Generate Secure Values:

#### JWT_SECRET (32+ characters):
```
openssl rand -base64 32
```
Or use an online generator for a random string like:
```
my-super-secret-jwt-key-2024-property-management-app
```

#### ADMIN_PASSWORD (8+ characters):
Use a strong password like:
```
Admin@Property2024!
```

## Step-by-Step Instructions:

1. **Go to Render Dashboard**
   - Visit https://dashboard.render.com/
   - Select your property management service

2. **Navigate to Environment**
   - Click on your service
   - Go to "Environment" tab
   - Click "Environment Variables"

3. **Add Each Variable**
   - Click "Add Environment Variable"
   - Enter the variable name and value
   - Click "Save Changes"

4. **Redeploy**
   - After adding all variables, click "Manual Deploy"
   - Or wait for automatic redeploy

## Local Development (.env file):

For local development, create a `.env` file in your project root:

```bash
# Server Configuration
PORT=3000
NODE_ENV=development

# Security
JWT_SECRET=dev-secret-key-change-in-production

# Database Configuration
DATABASE_PATH=./property_management.db

# Admin User Configuration
ADMIN_USERNAME=Admin
ADMIN_PASSWORD=Admin@1993
ADMIN_EMAIL=admin@system.com
```

## Security Best Practices:

1. **Never commit .env files** to version control
2. **Use different secrets** for development and production
3. **Generate strong passwords** for admin accounts
4. **Rotate secrets** periodically
5. **Use environment-specific** configurations

## Troubleshooting:

- **Build fails**: Check that all required variables are set
- **Authentication fails**: Verify JWT_SECRET is set correctly
- **Database issues**: Ensure DATABASE_PATH is writable
- **Admin login fails**: Check ADMIN_USERNAME and ADMIN_PASSWORD

## Example Values for Testing:

```
NODE_ENV=production
JWT_SECRET=property-management-jwt-secret-2024-xyz123
DATABASE_PATH=/opt/render/projectroot/property_management.db
ADMIN_USERNAME=Admin
ADMIN_PASSWORD=SecureAdminPass2024!
ADMIN_EMAIL=admin@example.com
```

Remember: These are example values. Generate your own secure values for production! 