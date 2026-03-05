const express = require('express');
const router  = express.Router();
const Grade   = require('../models/Grade');
const Course  = require('../models/Course');
const User    = require('../models/User');
const { auth, isAdmin, requireSuperAdmin, isSuperAdmin, getEffectiveCourseIds } = require('../middleware/auth');
const { sendError } = require('../utils/errorResponse');
const sc = require('../utils/serverCache');

const canAccessCourse = (req, courseId) => {
  if (isSuperAdmin(req.user)) return true;
  const ids = getEffectiveCourseIds(req.user).map(id => id.toString());
  return ids.includes(courseId?.toString());
};

// ── Statistics (superadmin) ───────────────────────────────────────────────────
router.get('/statistics', auth, requireSuperAdmin, async (req, res) => {
  try {
    const courseStats = await Grade.aggregate([
      { $match: { 'semesterGrade.isFinalized': true } },
      { $group: { _id: '$course', averageGradePoint: { $avg: '$semesterGrade.gradePoint' }, totalStudents: { $sum: 1 }, grades: { $push: '$semesterGrade.grade' } } },
      { $lookup: { from: 'courses', localField: '_id', foreignField: '_id', as: 'courseInfo' } },
      { $unwind: '$courseInfo' },
      { $project: { courseCode: '$courseInfo.courseCode', courseName: '$courseInfo.courseName', averageGradePoint: { $round: ['$averageGradePoint', 2] }, totalStudents: 1, grades: 1 } },
      { $sort: { courseCode: 1 } },
    ]);
    const majorStats = await Grade.aggregate([
      { $match: { 'semesterGrade.isFinalized': true } },
      { $lookup: { from: 'users', localField: 'student', foreignField: '_id', as: 'si' } },
      { $unwind: '$si' },
      { $group: { _id: '$si.major', averageGradePoint: { $avg: '$semesterGrade.gradePoint' }, totalStudents: { $addToSet: '$student' }, totalGrades: { $sum: 1 } } },
      { $project: { major: '$_id', averageGradePoint: { $round: ['$averageGradePoint', 2] }, totalStudents: { $size: '$totalStudents' }, totalGrades: 1 } },
      { $sort: { major: 1 } },
    ]);
    res.json({ courseStatistics: courseStats, majorStatistics: majorStats });
  } catch (e) { return sendError(res, 500, 'Error fetching statistics', e); }
});

// ── Statistics for my courses (staff) ────────────────────────────────────────
router.get('/statistics/my-courses', auth, isAdmin, async (req, res) => {
  try {
    let scopedCourseIds = null;
    if (!isSuperAdmin(req.user)) {
      scopedCourseIds = getEffectiveCourseIds(req.user);
      if (!scopedCourseIds.length) return res.json({ courseStatistics: [], majorStatistics: [], gradeDistribution: [] });
    }
    const baseMatch = { 'semesterGrade.isFinalized': true, ...(scopedCourseIds ? { course: { $in: scopedCourseIds } } : {}) };
    const allCourses = await Course.find(scopedCourseIds ? { _id: { $in: scopedCourseIds } } : {}).select('_id courseCode courseName major year semester status').lean();
    const gradeAgg = await Grade.aggregate([
      { $match: baseMatch },
      { $group: { _id: '$course', averageGradePoint: { $avg: '$semesterGrade.gradePoint' }, totalStudents: { $sum: 1 }, grades: { $push: '$semesterGrade.grade' }, passCount: { $sum: { $cond: [{ $gte: ['$semesterGrade.gradePoint', 1.0] }, 1, 0] } }, failCount: { $sum: { $cond: [{ $lt: ['$semesterGrade.gradePoint', 1.0] }, 1, 0] } } } },
    ]);
    const gradeMap = new Map(gradeAgg.map(g => [g._id.toString(), g]));
    const courseStats = allCourses.map(c => {
      const g = gradeMap.get(c._id.toString());
      return { _id: c._id, courseCode: c.courseCode, courseName: c.courseName, major: c.major, year: c.year, semester: c.semester, averageGradePoint: g ? parseFloat(g.averageGradePoint.toFixed(2)) : 0, totalStudents: g?.totalStudents || 0, passCount: g?.passCount || 0, failCount: g?.failCount || 0, grades: g?.grades || [] };
    }).sort((a, b) => (a.courseCode || '').localeCompare(b.courseCode || ''));
    const gradeDist = await Grade.aggregate([{ $match: baseMatch }, { $group: { _id: '$semesterGrade.grade', count: { $sum: 1 } } }, { $sort: { _id: 1 } }]);
    const majorStats = await Grade.aggregate([
      { $match: baseMatch },
      { $lookup: { from: 'users', localField: 'student', foreignField: '_id', as: 'si' } },
      { $unwind: '$si' },
      { $group: { _id: '$si.major', averageGradePoint: { $avg: '$semesterGrade.gradePoint' }, totalStudents: { $addToSet: '$student' }, totalGrades: { $sum: 1 } } },
      { $project: { major: '$_id', averageGradePoint: { $round: ['$averageGradePoint', 2] }, totalStudents: { $size: '$totalStudents' }, totalGrades: 1 } },
      { $sort: { major: 1 } },
    ]);
    res.json({ courseStatistics: courseStats, majorStatistics: majorStats, gradeDistribution: gradeDist });
  } catch (e) { return sendError(res, 500, 'Error fetching statistics', e); }
});

// ── Student's own grades ──────────────────────────────────────────────────────
router.get('/student', auth, async (req, res) => {
  try {
    const grades = await Grade.find({ student: req.userId })
      .populate('course', 'courseCode courseName credits hasPractical')
      .sort({ year: -1, semester: 1 }).lean();
    res.json(grades);
  } catch (e) { return sendError(res, 500, 'Error fetching grades', e); }
});

// ── GPA (finalized only) ──────────────────────────────────────────────────────
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
      .populate('course', 'courseCode courseName hasPractical');
    if (!grade) return res.status(404).json({ message: 'Grade not found' });
    res.json(grade);
  } catch (e) { return sendError(res, 500, 'Error fetching grade', e); }
});

// ── Save semester grade (final + optional practical) — staff ─────────────────
// POST /grades/semester
// Body: { student, course, semester, year, finalScore?, finalMaxScore?, practicalScore?, practicalMaxScore? }
router.post('/semester', auth, isAdmin, async (req, res) => {
  try {
    const { student, course, semester, year, finalScore, finalMaxScore, practicalScore, practicalMaxScore, grade: manualGrade, gradePoint: manualGP } = req.body;
    if (req.user.permissions?.canManageGrades === false) return res.status(403).json({ message: 'No permission to manage grades' });
    if (!canAccessCourse(req, course)) return res.status(403).json({ message: 'No access to this course' });
    if (!student || !course) return res.status(400).json({ message: 'student and course are required' });

    let gradeDoc = await Grade.findOne({ student, course });
    if (!gradeDoc) gradeDoc = new Grade({ student, course, semester, year });

    const sg = gradeDoc.semesterGrade || {};

    if (finalScore        != null) sg.finalScore       = Number(finalScore);
    if (finalMaxScore     != null) sg.finalMaxScore     = Number(finalMaxScore);
    if (practicalScore    != null) sg.practicalScore    = Number(practicalScore);
    if (practicalMaxScore != null) sg.practicalMaxScore = Number(practicalMaxScore);

    // Manual override (superadmin)
    if (manualGrade && isSuperAdmin(req.user)) {
      sg.grade = manualGrade; sg.gradePoint = manualGP ?? 0; sg.isFinalized = true;
    }

    gradeDoc.semesterGrade = sg;
    gradeDoc.semester = semester || gradeDoc.semester;
    gradeDoc.year     = year ? Number(year) : gradeDoc.year;
    await gradeDoc.save();

    if (gradeDoc.semesterGrade.isFinalized) {
      await User.findByIdAndUpdate(student, { $pull: { enrolledCourses: course } });
      await Course.findByIdAndUpdate(course, { $pull: { enrolledStudents: student } });
    }
    sc.del(`gpa:${student.toString()}`);
    sc.del(`dashboard:student:${student.toString()}`);
    res.status(201).json(gradeDoc);
  } catch (e) { return sendError(res, 500, 'Error saving semester grade', e); }
});

// ── Grade a classwork entry (assignment/quiz/midterm) ─────────────────────────
// PATCH /grades/classwork/:assignmentId/student/:studentId  { score }
// assignmentId = MongoDB ObjectId of the assignment, OR a special string key for manual entries
router.patch('/classwork/:assignmentId/student/:studentId', auth, isAdmin, async (req, res) => {
  try {
    const { assignmentId, studentId } = req.params;
    const { score } = req.body;
    if (score == null) return res.status(400).json({ message: 'score is required' });

    // Find grade doc — search by assignmentId in classwork array
    const gradeDoc = await Grade.findOne({ student: studentId, 'classwork.assignmentId': assignmentId });
    if (!gradeDoc) return res.status(404).json({ message: 'Classwork entry not found.' });
    if (!canAccessCourse(req, gradeDoc.course.toString())) return res.status(403).json({ message: 'No access to this course' });

    const entry = gradeDoc.classwork.find(e => e.assignmentId?.toString() === assignmentId);
    if (!entry) return res.status(404).json({ message: 'Classwork entry not found' });
    if (Number(score) < 0 || Number(score) > entry.maxScore) return res.status(400).json({ message: `Score must be 0–${entry.maxScore}` });

    entry.score = Number(score); entry.isGraded = true; entry.gradedAt = new Date(); entry.gradedBy = req.userId;
    gradeDoc.markModified('classwork');
    await gradeDoc.save();
    res.json({ message: 'Classwork score saved', entry });
  } catch (e) { return sendError(res, 500, 'Error saving classwork score', e); }
});

// ── Manually add a classwork entry (offline quiz/midterm) — staff ─────────────
// POST /grades/classwork/manual
// Body: { studentId, courseId, name, type, maxScore, score? }
// Used when a quiz or midterm was NOT created as an online assignment post.
router.post('/classwork/manual', auth, isAdmin, async (req, res) => {
  try {
    const { studentId, courseId, name, type, maxScore, score, semester, year } = req.body;
    if (!studentId || !courseId || !name) return res.status(400).json({ message: 'studentId, courseId, and name are required' });
    if (!canAccessCourse(req, courseId)) return res.status(403).json({ message: 'No access to this course' });

    const allowedTypes = ['quiz', 'assignment', 'midterm', 'other'];
    const entryType = allowedTypes.includes(type) ? type : 'other';

    let gradeDoc = await Grade.findOne({ student: studentId, course: courseId });
    if (!gradeDoc) {
      const courseDoc = await Course.findById(courseId).select('semester year').lean();
      gradeDoc = new Grade({ student: studentId, course: courseId, semester: semester || courseDoc?.semester || 'Spring', year: year ? Number(year) : (courseDoc?.year || new Date().getFullYear()) });
    }

    const newEntry = {
      assignmentId: null,
      name,
      type: entryType,
      maxScore: maxScore ? Number(maxScore) : 100,
      score:    score != null ? Number(score) : null,
      isGraded: score != null,
      gradedAt: score != null ? new Date() : null,
      gradedBy: score != null ? req.userId : null,
    };
    gradeDoc.classwork.push(newEntry);
    gradeDoc.markModified('classwork');
    await gradeDoc.save();
    res.status(201).json({ message: 'Manual classwork entry added', entry: newEntry, gradeId: gradeDoc._id });
  } catch (e) { return sendError(res, 500, 'Error adding manual classwork entry', e); }
});

// ── Batch grade classwork for entire course ───────────────────────────────────
// PATCH /grades/classwork/:assignmentId/batch  { scores: [{ studentId, score }] }
router.patch('/classwork/:assignmentId/batch', auth, isAdmin, async (req, res) => {
  try {
    const { assignmentId } = req.params;
    const { scores } = req.body; // [{ studentId, score }]
    if (!Array.isArray(scores) || !scores.length) return res.status(400).json({ message: 'scores array required' });

    const results = await Promise.allSettled(scores.map(async ({ studentId, score }) => {
      const gradeDoc = await Grade.findOne({ student: studentId, 'classwork.assignmentId': assignmentId });
      if (!gradeDoc) return;
      if (!canAccessCourse(req, gradeDoc.course.toString())) return;
      const entry = gradeDoc.classwork.find(e => e.assignmentId?.toString() === assignmentId);
      if (!entry) return;
      entry.score = Number(score); entry.isGraded = true; entry.gradedAt = new Date(); entry.gradedBy = req.userId;
      gradeDoc.markModified('classwork');
      await gradeDoc.save();
    }));

    const failed = results.filter(r => r.status === 'rejected').length;
    res.json({ message: `Batch graded. ${scores.length - failed} saved, ${failed} failed.` });
  } catch (e) { return sendError(res, 500, 'Error batch grading', e); }
});

// ── Get grades for a specific student (staff) ─────────────────────────────────
router.get('/admin/student/:studentId', auth, isAdmin, async (req, res) => {
  try {
    const grades = await Grade.find({ student: req.params.studentId })
      .populate('course', 'courseCode courseName credits hasPractical')
      .sort({ year: -1, semester: 1 });
    const filtered = isSuperAdmin(req.user) ? grades : grades.filter(g => canAccessCourse(req, g.course?._id || g.course));
    const finalized = filtered.filter(g => g.semesterGrade?.isFinalized);
    const totalWP = finalized.reduce((s, g) => s + ((g.semesterGrade.gradePoint || 0) * (g.course?.credits || 1)), 0);
    const totalCr = finalized.reduce((s, g) => s + (g.course?.credits || 1), 0);
    res.json({ grades: filtered, cgpa: totalCr > 0 ? parseFloat((totalWP / totalCr).toFixed(2)) : 0, totalGrades: filtered.length, pendingCount: filtered.filter(g => !g.semesterGrade?.isFinalized).length });
  } catch (e) { return sendError(res, 500, 'Error fetching student grades', e); }
});

// ── Delete grade (superadmin only) ────────────────────────────────────────────
router.delete('/:id', auth, requireSuperAdmin, async (req, res) => {
  try {
    const grade = await Grade.findByIdAndDelete(req.params.id);
    if (!grade) return res.status(404).json({ message: 'Grade not found' });
    res.json({ message: 'Grade deleted' });
  } catch (e) { return sendError(res, 500, 'Error deleting grade', e); }
});

// ── Legacy POST /grades ───────────────────────────────────────────────────────
router.post('/', auth, isAdmin, async (req, res) => {
  try {
    const { student, course, semester, year, grade: manualGrade, gradePoint: manualGP, finalScore } = req.body;
    if (!canAccessCourse(req, course)) return res.status(403).json({ message: 'No access' });
    if (!student || !course) return res.status(400).json({ message: 'student and course required' });
    let gradeDoc = await Grade.findOne({ student, course });
    if (!gradeDoc) gradeDoc = new Grade({ student, course, semester, year });
    if (finalScore != null) {
      gradeDoc.semesterGrade = { ...gradeDoc.semesterGrade, finalScore: Number(finalScore), finalMaxScore: gradeDoc.semesterGrade?.finalMaxScore || 100 };
    } else if (manualGrade) {
      gradeDoc.semesterGrade = { ...gradeDoc.semesterGrade, grade: manualGrade, gradePoint: manualGP ?? 0, isFinalized: true };
    }
    gradeDoc.semester = semester || gradeDoc.semester;
    gradeDoc.year     = year ? Number(year) : gradeDoc.year;
    await gradeDoc.save();
    sc.del(`gpa:${student.toString()}`);
    res.status(201).json(gradeDoc);
  } catch (e) { return sendError(res, 500, 'Error saving grade', e); }
});

module.exports = router;

