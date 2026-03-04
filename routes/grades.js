const express = require('express');
const router  = express.Router();
const Grade   = require('../models/Grade');
const Course  = require('../models/Course');
const User    = require('../models/User');
const { auth, isAdmin, requireSuperAdmin, isSuperAdmin, getEffectiveCourseIds } = require('../middleware/auth');
const { sendError } = require('../utils/errorResponse');
const sc = require('../utils/serverCache');

const { calcLetterGradeFromTotal, applyRetakeCap } = require('../models/Grade');

const canAccessCourse = (req, courseId) => {
  if (isSuperAdmin(req.user)) return true;
  const ids = getEffectiveCourseIds(req.user).map(id => id.toString());
  return ids.includes(courseId?.toString());
};

// ── Grade statistics (superadmin) ─────────────────────────────────────────────
router.get('/statistics', auth, requireSuperAdmin, async (req, res) => {
  try {
    const courseStats = await Grade.aggregate([
      { $match: { 'semesterGrade.isFinalized': true } },
      { $group: {
          _id: '$course',
          averageGradePoint: { $avg: '$semesterGrade.gradePoint' },
          totalStudents: { $sum: 1 },
          grades: { $push: '$semesterGrade.grade' },
      }},
      { $lookup: { from: 'courses', localField: '_id', foreignField: '_id', as: 'courseInfo' } },
      { $unwind: '$courseInfo' },
      { $project: { courseCode: '$courseInfo.courseCode', courseName: '$courseInfo.courseName', averageGradePoint: { $round: ['$averageGradePoint', 2] }, totalStudents: 1, grades: 1 } },
      { $sort: { courseCode: 1 } },
    ]);
    const majorStats = await Grade.aggregate([
      { $match: { 'semesterGrade.isFinalized': true } },
      { $lookup: { from: 'users', localField: 'student', foreignField: '_id', as: 'studentInfo' } },
      { $unwind: '$studentInfo' },
      { $group: { _id: '$studentInfo.major', averageGradePoint: { $avg: '$semesterGrade.gradePoint' }, totalStudents: { $addToSet: '$student' }, totalGrades: { $sum: 1 } } },
      { $project: { major: '$_id', averageGradePoint: { $round: ['$averageGradePoint', 2] }, totalStudents: { $size: '$totalStudents' }, totalGrades: 1 } },
      { $sort: { major: 1 } },
    ]);
    res.json({ courseStatistics: courseStats, majorStatistics: majorStats });
  } catch (e) { return sendError(res, 500, 'Error fetching statistics', e); }
});

// ── Grade statistics for assigned courses (doctor / assistant / superadmin) ───
router.get('/statistics/my-courses', auth, isAdmin, async (req, res) => {
  try {
    let scopedCourseIds = null;
    if (!isSuperAdmin(req.user)) {
      scopedCourseIds = getEffectiveCourseIds(req.user);
      if (!scopedCourseIds.length) return res.json({ courseStatistics: [], majorStatistics: [], gradeDistribution: [] });
    }
    const baseMatch = {
      'semesterGrade.isFinalized': true,
      ...(scopedCourseIds ? { course: { $in: scopedCourseIds } } : {}),
    };

    const courseQuery = scopedCourseIds ? { _id: { $in: scopedCourseIds } } : {};
    const allCourses  = await Course.find(courseQuery).select('_id courseCode courseName major year semester status').lean();

    const gradeAggRaw = await Grade.aggregate([
      { $match: baseMatch },
      { $group: {
          _id: '$course',
          averageGradePoint: { $avg: '$semesterGrade.gradePoint' },
          totalStudents: { $sum: 1 },
          grades: { $push: '$semesterGrade.grade' },
          passCount: { $sum: { $cond: [{ $gte: ['$semesterGrade.gradePoint', 1.0] }, 1, 0] } },
          failCount: { $sum: { $cond: [{ $lt:  ['$semesterGrade.gradePoint', 1.0] }, 1, 0] } },
      }},
    ]);
    const gradeMap = new Map(gradeAggRaw.map(g => [g._id.toString(), g]));
    const courseStats = allCourses.map(c => {
      const g = gradeMap.get(c._id.toString());
      return { _id: c._id, courseCode: c.courseCode, courseName: c.courseName, major: c.major, year: c.year, semester: c.semester,
        averageGradePoint: g ? parseFloat(g.averageGradePoint.toFixed(2)) : 0,
        totalStudents: g ? g.totalStudents : 0, passCount: g ? g.passCount : 0, failCount: g ? g.failCount : 0, grades: g ? g.grades : [],
      };
    }).sort((a, b) => (a.courseCode || '').localeCompare(b.courseCode || ''));

    const gradeDist = await Grade.aggregate([
      { $match: baseMatch },
      { $group: { _id: '$semesterGrade.grade', count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]);
    const majorStats = await Grade.aggregate([
      { $match: baseMatch },
      { $lookup: { from: 'users', localField: 'student', foreignField: '_id', as: 'studentInfo' } },
      { $unwind: '$studentInfo' },
      { $group: { _id: '$studentInfo.major', averageGradePoint: { $avg: '$semesterGrade.gradePoint' }, totalStudents: { $addToSet: '$student' }, totalGrades: { $sum: 1 } } },
      { $project: { major: '$_id', averageGradePoint: { $round: ['$averageGradePoint', 2] }, totalStudents: { $size: '$totalStudents' }, totalGrades: 1 } },
      { $sort: { major: 1 } },
    ]);
    res.json({ courseStatistics: courseStats, majorStatistics: majorStats, gradeDistribution: gradeDist });
  } catch (e) { return sendError(res, 500, 'Error fetching statistics', e); }
});

// ── Student's own grades ───────────────────────────────────────────────────────
router.get('/student', auth, async (req, res) => {
  try {
    const grades = await Grade.find({ student: req.userId })
      .populate('course', 'courseCode courseName credits')
      .sort({ year: -1, semester: 1 })
      .lean();
    res.json(grades);
  } catch (e) { return sendError(res, 500, 'Error fetching grades', e); }
});

// ── GPA (only finalized semester grades count) ────────────────────────────────
router.get('/gpa', auth, async (req, res) => {
  try {
    const uid = req.userId.toString();
    const result = await sc.getOrSet(`gpa:${uid}`, async () => {
      const grades = await Grade.find({ student: uid }).populate('course', 'credits').lean();
      if (!grades.length) return { gpa: 0, totalCredits: 0, pendingCount: 0 };
      let totalPoints = 0, totalCredits = 0, pendingCount = 0;
      grades.forEach(g => {
        if (!g.course?.credits) return;
        if (!g.semesterGrade?.isFinalized) { pendingCount++; return; }
        totalPoints  += g.semesterGrade.gradePoint * g.course.credits;
        totalCredits += g.course.credits;
      });
      return { gpa: totalCredits > 0 ? parseFloat((totalPoints / totalCredits).toFixed(2)) : 0, totalCredits, pendingCount };
    }, sc.TTL.GPA);
    res.json(result);
  } catch (e) { return sendError(res, 500, 'Error calculating GPA', e); }
});

// ── Grade by course (student) ─────────────────────────────────────────────────
router.get('/course/:courseId', auth, async (req, res) => {
  try {
    const grade = await Grade.findOne({ student: req.userId, course: req.params.courseId })
      .populate('course', 'courseCode courseName');
    if (!grade) return res.status(404).json({ message: 'Grade not found' });
    res.json(grade);
  } catch (e) { return sendError(res, 500, 'Error fetching grade', e); }
});

// ── Set semester grade (midterm or final) — staff only ────────────────────────
// POST /grades/semester  { student, course, semester, year, midtermScore?, midtermMaxScore?, finalScore?, finalMaxScore? }
router.post('/semester', auth, isAdmin, async (req, res) => {
  try {
    const { student, course, semester, year, midtermScore, midtermMaxScore, finalScore, finalMaxScore } = req.body;

    if (req.user.permissions?.canManageGrades === false)
      return res.status(403).json({ message: 'No permission to manage grades' });
    if (!canAccessCourse(req, course))
      return res.status(403).json({ message: 'You do not have access to this course' });
    if (!student || !course) return res.status(400).json({ message: 'student and course are required' });

    let gradeDoc = await Grade.findOne({ student, course });
    if (!gradeDoc) {
      gradeDoc = new Grade({ student, course, semester, year });
    }

    const sg = gradeDoc.semesterGrade || {};

    // Update only the fields sent
    if (midtermScore  != null) sg.midtermScore    = Number(midtermScore);
    if (midtermMaxScore != null) sg.midtermMaxScore = Number(midtermMaxScore);
    if (finalScore    != null) {
      // Final can be graded once; after that, only edits allowed (checked on client,
      // but we allow it here since the route IS the edit route too)
      sg.finalScore    = Number(finalScore);
    }
    if (finalMaxScore != null) sg.finalMaxScore = Number(finalMaxScore);

    gradeDoc.semesterGrade = sg;
    gradeDoc.semester = semester || gradeDoc.semester;
    gradeDoc.year     = year     ? Number(year) : gradeDoc.year;

    await gradeDoc.save();

    // If finalized, remove from enrolled (course completed for student)
    if (gradeDoc.semesterGrade.isFinalized) {
      await User.findByIdAndUpdate(student, { $pull: { enrolledCourses: course } });
      await Course.findByIdAndUpdate(course, { $pull: { enrolledStudents: student } });
    }

    sc.del(`gpa:${student.toString()}`);
    sc.del(`dashboard:student:${student.toString()}`);

    res.status(201).json(gradeDoc);
  } catch (e) { return sendError(res, 500, 'Error saving semester grade', e); }
});

// ── Grade a classwork entry (assignment/quiz) for a student ───────────────────
// PATCH /grades/classwork/:assignmentId/student/:studentId  { score }
router.patch('/classwork/:assignmentId/student/:studentId', auth, isAdmin, async (req, res) => {
  try {
    const { assignmentId, studentId } = req.params;
    const { score } = req.body;

    if (score == null) return res.status(400).json({ message: 'score is required' });

    // Find the grade doc; it should already exist with the classwork entry auto-added
    const gradeDoc = await Grade.findOne({ student: studentId, 'classwork.assignmentId': assignmentId });
    if (!gradeDoc) return res.status(404).json({ message: 'Classwork entry not found. Assignment may not be linked to this student yet.' });

    if (!canAccessCourse(req, gradeDoc.course.toString()))
      return res.status(403).json({ message: 'You do not have access to this course' });

    const entry = gradeDoc.classwork.find(e => e.assignmentId?.toString() === assignmentId);
    if (!entry) return res.status(404).json({ message: 'Classwork entry not found' });

    if (Number(score) < 0 || Number(score) > entry.maxScore)
      return res.status(400).json({ message: `Score must be between 0 and ${entry.maxScore}` });

    entry.score    = Number(score);
    entry.isGraded = true;
    entry.gradedAt = new Date();
    entry.gradedBy = req.userId;

    gradeDoc.markModified('classwork');
    await gradeDoc.save();

    res.json({ message: 'Classwork score saved', entry });
  } catch (e) { return sendError(res, 500, 'Error saving classwork score', e); }
});

// ── Delete grade (superadmin only) ────────────────────────────────────────────
router.delete('/:id', auth, requireSuperAdmin, async (req, res) => {
  try {
    const grade = await Grade.findByIdAndDelete(req.params.id);
    if (!grade) return res.status(404).json({ message: 'Grade not found' });
    res.json({ message: 'Grade deleted successfully' });
  } catch (e) { return sendError(res, 500, 'Error deleting grade', e); }
});

// ── Get grades for a specific student (staff) ─────────────────────────────────
router.get('/admin/student/:studentId', auth, isAdmin, async (req, res) => {
  try {
    const grades = await Grade.find({ student: req.params.studentId })
      .populate('course', 'courseCode courseName credits')
      .sort({ year: -1, semester: 1 });

    const filteredGrades = isSuperAdmin(req.user)
      ? grades
      : grades.filter(g => canAccessCourse(req, g.course?._id || g.course));

    const finalizedGrades = filteredGrades.filter(g => g.semesterGrade?.isFinalized);
    const totalWP  = finalizedGrades.reduce((s, g) => s + ((g.semesterGrade.gradePoint || 0) * (g.course?.credits || 1)), 0);
    const totalCr  = finalizedGrades.reduce((s, g) => s + (g.course?.credits || 1), 0);
    const cgpa     = totalCr > 0 ? parseFloat((totalWP / totalCr).toFixed(2)) : 0;
    const pendingCount = filteredGrades.filter(g => !g.semesterGrade?.isFinalized).length;

    res.json({ grades: filteredGrades, cgpa, totalGrades: filteredGrades.length, pendingCount });
  } catch (e) { return sendError(res, 500, 'Error fetching student grades', e); }
});

// ── (Legacy compat) POST /grades — keep working for old manual grade entries ──
router.post('/', auth, isAdmin, async (req, res) => {
  try {
    const { student, course, semester, year, grade: manualGrade, gradePoint: manualGradePoint, finalScore } = req.body;
    if (!canAccessCourse(req, course)) return res.status(403).json({ message: 'No access to this course' });
    if (!student || !course) return res.status(400).json({ message: 'student and course are required' });

    let gradeDoc = await Grade.findOne({ student, course });
    if (!gradeDoc) gradeDoc = new Grade({ student, course, semester, year });

    if (finalScore != null) {
      // Treated as a full semester final grade entry
      gradeDoc.semesterGrade = {
        ...gradeDoc.semesterGrade,
        finalScore: Number(finalScore),
        finalMaxScore: gradeDoc.semesterGrade?.finalMaxScore || 60,
      };
    } else if (manualGrade) {
      // Pure manual override — set directly on semesterGrade, mark finalized
      gradeDoc.semesterGrade = {
        midtermScore: gradeDoc.semesterGrade?.midtermScore ?? null,
        midtermMaxScore: gradeDoc.semesterGrade?.midtermMaxScore ?? 40,
        finalScore: gradeDoc.semesterGrade?.finalScore ?? null,
        finalMaxScore: gradeDoc.semesterGrade?.finalMaxScore ?? 60,
        grade: manualGrade,
        gradePoint: manualGradePoint ?? 0,
        isFinalized: true,
      };
    }
    gradeDoc.semester = semester || gradeDoc.semester;
    gradeDoc.year     = year ? Number(year) : gradeDoc.year;
    await gradeDoc.save();
    sc.del(`gpa:${student.toString()}`);
    res.status(201).json(gradeDoc);
  } catch (e) { return sendError(res, 500, 'Error saving grade', e); }
});

module.exports = router;


