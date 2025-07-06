# Property Management App - Deployment Guide

## Deploying to Render

This guide will help you deploy the Property Management App to Render.

### Prerequisites

1. A GitHub account with your code repository
2. A Render account (free tier available)

### Step 1: Prepare Your Repository

1. Make sure your code is pushed to a GitHub repository
2. Ensure all files are committed, including:
   - `server.js`
   - `package.json`
   - `render.yaml`
   - `.gitignore`
   - All files in the `public/` directory

### Step 2: Deploy on Render

#### Option A: Using render.yaml (Recommended)

1. Go to [Render Dashboard](https://dashboard.render.com/)
2. Click "New +" and select "Blueprint"
3. Connect your GitHub repository
4. Render will automatically detect the `render.yaml` file and configure the service
5. Click "Apply" to deploy

#### Option B: Manual Configuration

1. Go to [Render Dashboard](https://dashboard.render.com/)
2. Click "New +" and select "Web Service"
3. Connect your GitHub repository
4. Configure the service:
   - **Name**: `property-management-app`
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: Free

5. Add Environment Variables:
   - `NODE_ENV`: `production`
   - `JWT_SECRET`: Generate a secure random string
   - `DATABASE_PATH`: `/opt/render/projectroot/property_management.db`
   - `ADMIN_USERNAME`: `Admin` (or your preferred username)
   - `ADMIN_PASSWORD`: Generate a secure password
   - `ADMIN_EMAIL`: `admin@system.com` (or your email)

6. Click "Create Web Service"

### Step 3: Access Your Application

1. Once deployment is complete, Render will provide a URL (e.g., `https://your-app-name.onrender.com`)
2. The application will be accessible at that URL
3. Use the admin credentials you set in the environment variables to log in

### Step 4: Database Management

- The SQLite database will be automatically created on first run
- The database file will be stored in the Render filesystem
- **Important**: Data will be lost if you redeploy or the service restarts
- For production use, consider migrating to a persistent database service

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | 3000 |
| `JWT_SECRET` | JWT signing secret | Auto-generated |
| `DATABASE_PATH` | SQLite database path | `/opt/render/projectroot/property_management.db` |
| `ADMIN_USERNAME` | Admin username | `Admin` |
| `ADMIN_PASSWORD` | Admin password | Auto-generated |
| `ADMIN_EMAIL` | Admin email | `admin@system.com` |

### Troubleshooting

1. **Build fails**: Check that all dependencies are in `package.json`
2. **Application crashes**: Check Render logs for error messages
3. **Database issues**: Ensure the database path is writable
4. **Authentication fails**: Verify JWT_SECRET is set correctly

### Security Notes

- Change default admin credentials in production
- Use strong, unique passwords
- Consider using environment-specific JWT secrets
- Regularly update dependencies

### Local Development

To run locally:

```bash
npm install
npm start
```

The app will be available at `http://localhost:3000`

### Support

For issues with:
- Render deployment: Check Render documentation
- Application functionality: Check the application logs
- Database issues: Verify environment variables are set correctly 