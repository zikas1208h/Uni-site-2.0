const mongoose = require('mongoose');
require('dotenv').config();

console.log('========================================');
console.log('University Portal - Setup Verification');
console.log('========================================\n');

// Check Node.js version
console.log('✓ Node.js version:', process.version);

// Check environment variables
console.log('\nEnvironment Variables:');
console.log('  PORT:', process.env.PORT || '(not set, will use default 5000)');
console.log('  MONGODB_URI:', process.env.MONGODB_URI || '(not set!)');
console.log('  JWT_SECRET:', process.env.JWT_SECRET ? '(set)' : '(not set!)');
console.log('  NODE_ENV:', process.env.NODE_ENV || 'development');

// Test MongoDB connection
console.log('\nTesting MongoDB Connection...');
mongoose.connect(process.env.MONGODB_URI, {
  serverSelectionTimeoutMS: 5000
})
.then(() => {
  console.log('✓ MongoDB connection successful!');
  console.log('  Database:', mongoose.connection.name);
  console.log('  Host:', mongoose.connection.host);
  console.log('  Port:', mongoose.connection.port);

  // Check collections
  return mongoose.connection.db.listCollections().toArray();
})
.then(collections => {
  console.log('\nExisting Collections:');
  if (collections.length === 0) {
    console.log('  (none - run "npm run seed" to create sample data)');
  } else {
    collections.forEach(col => {
      console.log('  -', col.name);
    });
  }

  console.log('\n========================================');
  console.log('Setup verification complete!');
  console.log('========================================');
  console.log('\nNext steps:');
  console.log('1. If no collections exist, run: npm run seed');
  console.log('2. Start the server: npm run dev');
  console.log('3. Open frontend and login with credentials from QUICKSTART.md');

  process.exit(0);
})
.catch(err => {
  console.error('\n✗ MongoDB connection failed!');
  console.error('Error:', err.message);
  console.log('\nTroubleshooting:');
  console.log('1. Make sure MongoDB is running');
  console.log('2. Check MONGODB_URI in .env file');
  console.log('3. Default: mongodb://localhost:27017/uni-portal');

  process.exit(1);
});

