require('dotenv').config();
const mongoose = require('mongoose');

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  const User = require('./models/User');

  // Upgrade ALL users with role 'admin' to 'superadmin'
  const result = await User.updateMany({ role: 'admin' }, { $set: { role: 'superadmin' } });
  console.log('✅ Upgraded', result.modifiedCount, 'admin(s) to superadmin');

  // List all staff
  const all = await User.find({ role: { $in: ['admin', 'superadmin', 'doctor', 'assistant'] } })
    .select('email role firstName lastName studentId');
  console.log('\n📋 All staff accounts:');
  all.forEach(s => console.log(' -', s.email, '|', s.role, '|', s.firstName, s.lastName));

  process.exit(0);
}).catch(e => { console.error(e.message); process.exit(1); });

