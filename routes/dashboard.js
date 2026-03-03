const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Course = require('../models/Course');
const Material = require('../models/Material');
const { auth, isAdmin, isSuperAdmin } = require('../middleware/auth');
const { sendError } = require('../utils/errorResponse');
router.get('/stats', auth, isAdmin, async (req, res) => {
  try {
    const user = req.user;
    const isSA = isSuperAdmin(user);
    if (isSA) {
      const [studentCount, recentStudents, courseStats, matCount, staffList, enrollSum, staffCounts] = await Promise.all([
        User.countDocuments({ role: 'student' }),
        User.find({ role: 'student' }).sort({ createdAt: -1 }).limit(6).select('firstName lastName major year enrolledCourses _id').lean(),
        Course.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
        Material.countDocuments(),
        User.find({ role: { $in: ['doctor','assistant','superadmin'] } }).sort({ role: 1, lastName: 1 }).limit(6).select('firstName lastName email role _id').lean(),
        User.aggregate([{ $match: { role: 'student' } }, { $project: { count: { $size: { $ifNull: ['$enrolledCourses',[]] } } } }, { $group: { _id: null, total: { $sum: '$count' } } }]),
        User.aggregate([{ $match: { role: { $in: ['doctor','assistant','superadmin'] } } }, { $group: { _id: '$role', count: { $sum: 1 } } }]),
      ]);
      const courseCounts = { active: 0, completed: 0, total: 0 };
      courseStats.forEach(s => { courseCounts[s._id] = s.count; courseCounts.total += s.count; });
      const staffByRole = {};
      staffCounts.forEach(s => { staffByRole[s._id] = s.count; });
      return res.json({ role: 'superadmin', studentCount, recentStudents, courseCounts, matCount, staffPreview: staffList, staffByRole, totalEnrollments: enrollSum[0]?.total || 0 });
    }
    const assignedIds = (user.assignedCourses || []).map(c => (c._id || c).toString());
    const [myCourses, studentCount, recentStudents, matCount] = await Promise.all([
      assignedIds.length > 0 ? Course.find({ _id: { $in: assignedIds } }).select('courseCode courseName credits status _id').lean() : Promise.resolve([]),
      User.countDocuments({ role: 'student' }),
      User.find({ role: 'student' }).sort({ createdAt: -1 }).limit(6).select('firstName lastName major year _id').lean(),
      assignedIds.length > 0 ? Material.countDocuments({ course: { $in: assignedIds } }) : Material.countDocuments(),
    ]);
    return res.json({ role: user.role, myCourses, studentCount, recentStudents, matCount });
  } catch (error) {
    return sendError(res, 500, 'Error fetching dashboard stats', error);
  }
});
module.exports = router;
