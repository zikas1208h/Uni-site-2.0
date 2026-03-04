const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Course = require('../models/Course');
const Material = require('../models/Material');
const Grade = require('../models/Grade');
const { auth, isAdmin, isSuperAdmin } = require('../middleware/auth');
const { sendError } = require('../utils/errorResponse');
const sc = require('../utils/serverCache');

// ── GET /api/dashboard/student-stats ─────────────────────────────────────────
router.get('/student-stats', auth, async (req, res) => {
  try {
    const userId = req.userId.toString();
    const data = await sc.getOrSet(`dashboard:student:${userId}`, async () => {
      // All queries fire in parallel — one round-trip to MongoDB
      const [user, grades] = await Promise.all([
        User.findById(userId)
          .select('enrolledCourses')
          .populate('enrolledCourses', 'courseCode courseName credits status _id')
          .lean(),
        Grade.find({ student: userId })
          .populate('course', 'courseCode courseName credits _id')
          .sort({ createdAt: -1 })
          .lean(),
      ]);

      const enrolledCourses = user?.enrolledCourses || [];
      const enrolledIds = enrolledCourses.map(c => c._id);

      const recentMaterials = await Material.find({ course: { $in: enrolledIds } })
        .select('-fileData')
        .sort({ createdAt: -1 })
        .limit(10)
        .populate('course', 'courseCode courseName _id')
        .lean();

      let totalPoints = 0, totalCredits = 0;
      const gradedIds = new Set();
      grades.forEach(g => {
        if (g.course?._id) gradedIds.add(g.course._id.toString());
        if (!g.course?.credits) return;
        if (g.isRetake && g.gradePoint === 0 && g.grade === 'F') return;
        totalPoints  += g.gradePoint * g.course.credits;
        totalCredits += g.course.credits;
      });
      const gpa = totalCredits > 0 ? parseFloat((totalPoints / totalCredits).toFixed(2)) : 0;

      let currentCredits = 0;
      enrolledCourses.forEach(c => {
        if (!gradedIds.has(c._id.toString())) currentCredits += (c.credits || 0);
      });

      const realGradeCount = grades.filter(g => !(g.isRetake && g.gradePoint === 0 && g.grade === 'F')).length;
      const hasNoGrades = realGradeCount === 0;
      const getCreditLimit = (cgpa, noGrades) => {
        if (noGrades)    return 21;
        if (cgpa >= 3.0) return 21;
        if (cgpa >= 2.0) return 15;
        if (cgpa >= 1.0) return 12;
        return 9;
      };
      const creditLimit = getCreditLimit(gpa, hasNoGrades);
      let status = 'Probation';
      if (hasNoGrades)     status = 'First Term';
      else if (gpa >= 3.4) status = 'Good Standing';
      else if (gpa >= 3.0) status = 'Satisfactory';
      else if (gpa >= 2.0) status = 'Pass';
      else if (gpa >= 1.0) status = 'Below Average';

      return {
        gpaData: { gpa, totalCredits },
        grades,
        enrolledCourses,
        materials: recentMaterials,
        creditEligibility: {
          cgpa: gpa, status, creditLimit,
          currentCredits, availableCredits: creditLimit - currentCredits,
          canEnroll: currentCredits < creditLimit,
        },
      };
    }, sc.TTL.DASHBOARD);

    res.json(data);
  } catch (error) {
    return sendError(res, 500, 'Error fetching student dashboard stats', error);
  }
});

router.get('/stats', auth, isAdmin, async (req, res) => {
  try {
    const user = req.user;
    const isSA = isSuperAdmin(user);    if (isSA) {
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
