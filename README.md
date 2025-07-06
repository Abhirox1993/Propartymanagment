# Property Management System

A comprehensive web-based property management application built with Node.js, Express, SQLite, and modern HTML/CSS/JavaScript.

## Features

### 🏠 Property Management
- Add, edit, and delete properties
- Track property details (bedrooms, bathrooms, square footage, rent amount)
- Property status tracking (available, occupied, under maintenance)
- Property type categorization (apartment, house, condo, townhouse)

### 👥 Tenant Management
- Complete tenant profiles with contact information
- Lease tracking with start and end dates
- Property assignment and rent amount tracking
- Tenant status management (active/inactive)

### 🔧 Maintenance Requests
- Create and track maintenance requests
- Priority levels (low, medium, high)
- Status tracking (pending, in-progress, completed)
- Link requests to specific properties and tenants

### 💰 Financial Tracking
- Record income and expenses
- Track rent payments, deposits, fees, and expenses
- Link financial records to properties and tenants
- Comprehensive financial reporting

### 📊 Dashboard
- Real-time statistics and overview
- Recent properties and maintenance requests
- Quick access to key metrics
- Visual data representation

### 🔐 User Authentication
- Secure user registration and login
- JWT-based authentication
- Password hashing with bcrypt
- Session management

## Technology Stack

- **Backend**: Node.js, Express.js
- **Database**: SQLite3
- **Frontend**: HTML5, CSS3, Vanilla JavaScript
- **Authentication**: JWT, bcryptjs
- **Styling**: Custom CSS with modern design
- **Icons**: Font Awesome

## Installation & Setup

### Prerequisites
- Node.js (v14 or higher)
- npm (comes with Node.js)

### Step 1: Clone or Download
```bash
# If using git
git clone <repository-url>
cd property-management-app

# Or download and extract the files
```

### Step 2: Install Dependencies
```bash
npm install
```

### Step 3: Start the Application
```bash
# Start the server
npm start

# Or for development with auto-restart
npm run dev
```

### Step 4: Access the Application
Open your web browser and navigate to:
```
http://localhost:3000
```

## Database Setup

The application automatically creates the SQLite database and tables on first run. The database file (`property_management.db`) will be created in the root directory.

### Database Schema

#### Properties Table
- `id` - Primary key
- `name` - Property name
- `address` - Property address
- `type` - Property type (apartment, house, condo, townhouse)
- `bedrooms` - Number of bedrooms
- `bathrooms` - Number of bathrooms
- `square_feet` - Property size
- `rent_amount` - Monthly rent
- `status` - Property status (available, occupied, maintenance)
- `created_at` - Creation timestamp

#### Tenants Table
- `id` - Primary key
- `first_name` - Tenant first name
- `last_name` - Tenant last name
- `email` - Email address (unique)
- `phone` - Phone number
- `property_id` - Foreign key to properties
- `lease_start` - Lease start date
- `lease_end` - Lease end date
- `rent_amount` - Monthly rent amount
- `status` - Tenant status (active, inactive)
- `created_at` - Creation timestamp

#### Maintenance Requests Table
- `id` - Primary key
- `property_id` - Foreign key to properties
- `tenant_id` - Foreign key to tenants
- `title` - Request title
- `description` - Request description
- `priority` - Priority level (low, medium, high)
- `status` - Request status (pending, in-progress, completed)
- `created_at` - Creation timestamp
- `completed_at` - Completion timestamp

#### Financial Records Table
- `id` - Primary key
- `property_id` - Foreign key to properties
- `tenant_id` - Foreign key to tenants
- `type` - Record type (rent, expense, deposit, fee)
- `amount` - Transaction amount
- `description` - Transaction description
- `date` - Transaction date
- `created_at` - Creation timestamp

#### Users Table
- `id` - Primary key
- `username` - Username (unique)
- `email` - Email address (unique)
- `password_hash` - Hashed password
- `role` - User role (manager)
- `created_at` - Creation timestamp

## Usage Guide

### Getting Started
1. **Register/Login**: Create a new account or log in with existing credentials
2. **Dashboard**: View overview statistics and recent activities
3. **Add Properties**: Start by adding your properties to the system
4. **Add Tenants**: Assign tenants to properties
5. **Track Maintenance**: Create and manage maintenance requests
6. **Financial Records**: Track income and expenses

### Property Management
- Click "Add Property" to create new property listings
- Edit property details by clicking the "Edit" button
- Delete properties using the "Delete" button
- Use the search and filter options to find specific properties

### Tenant Management
- Add new tenants and assign them to properties
- Track lease information and rent amounts
- Update tenant status as needed
- View tenant details in the table format

### Maintenance Requests
- Create new maintenance requests for properties
- Set priority levels and track status
- Update request status as work progresses
- Link requests to specific tenants when applicable

### Financial Tracking
- Record all financial transactions
- Categorize transactions by type
- Link transactions to properties and tenants
- View financial history in table format

## API Endpoints

### Authentication
- `POST /api/register` - User registration
- `POST /api/login` - User login

### Properties
- `GET /api/properties` - Get all properties
- `POST /api/properties` - Create new property
- `PUT /api/properties/:id` - Update property
- `DELETE /api/properties/:id` - Delete property

### Tenants
- `GET /api/tenants` - Get all tenants
- `POST /api/tenants` - Create new tenant

### Maintenance
- `GET /api/maintenance` - Get all maintenance requests
- `POST /api/maintenance` - Create new maintenance request
- `PUT /api/maintenance/:id` - Update maintenance request

### Financial
- `GET /api/financial` - Get all financial records
- `POST /api/financial` - Create new financial record

### Dashboard
- `GET /api/dashboard` - Get dashboard statistics

## Security Features

- **Password Hashing**: All passwords are hashed using bcrypt
- **JWT Authentication**: Secure token-based authentication
- **Input Validation**: Server-side validation for all inputs
- **SQL Injection Protection**: Parameterized queries
- **CORS Protection**: Cross-origin resource sharing protection

## Customization

### Styling
- Modify `public/styles.css` to customize the appearance
- The app uses CSS Grid and Flexbox for responsive design
- Color scheme can be adjusted in the CSS variables

### Database
- The app uses SQLite for simplicity
- Can be easily migrated to PostgreSQL, MySQL, or other databases
- Database schema can be modified in `server.js`

### Features
- Add new features by extending the API endpoints
- Modify the frontend JavaScript to add new functionality
- Add new data tables as needed

## Troubleshooting

### Common Issues

1. **Port Already in Use**
   ```bash
   # Change the port in server.js
   const PORT = process.env.PORT || 3001;
   ```

2. **Database Errors**
   - Delete the `property_management.db` file and restart the server
   - Check file permissions in the project directory

3. **Module Not Found Errors**
   ```bash
   # Reinstall dependencies
   npm install
   ```

4. **Authentication Issues**
   - Clear browser localStorage
   - Check JWT_SECRET in server.js
   - Ensure proper token handling

### Development Tips

- Use `npm run dev` for development with auto-restart
- Check browser console for JavaScript errors
- Monitor server logs for API errors
- Use browser developer tools for debugging

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

This project is licensed under the MIT License.

## Support

For support and questions:
- Check the troubleshooting section
- Review the API documentation
- Examine the source code for implementation details

---

**Note**: This is a development version. For production use, consider:
- Using a production database (PostgreSQL, MySQL)
- Implementing proper environment variables
- Adding comprehensive error handling
- Setting up proper logging
- Implementing backup strategies
- Adding rate limiting and additional security measures 